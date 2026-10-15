'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Send, RotateCcw, CheckSquare, Sparkles } from 'lucide-react';
import { toast } from '@/components/ui/feedback';
import { todoKey } from '@/lib/assist/todoKey';
import type { AssistResult } from '@/lib/assist/types';
import { useAssist, useStage, type AssistTodo } from './useAssist';
import { insertQuote, insertSteps, markTodoDone } from './assistDoc';
import { DraftView } from './DraftView';
import { PlanView } from './PlanView';
import { StepsView, AnswerView } from './SimpleViews';

const KIND: Record<AssistResult['intent'], string> = { draft: 'Draft', project: 'Project plan', steps: 'Plan', answer: 'Answer' };

type Assist = ReturnType<typeof useAssist>;

function Result({ result, a, todoKeyValue }: { result: AssistResult; a: Assist; todoKeyValue: string }) {
  const placed = (ok: boolean, what: string) => (ok ? toast.success(what) : toast.error('Could not find that to-do in the journal. Was it edited?'));
  if (result.intent === 'draft') return <DraftView draft={result} onInsert={(t) => placed(insertQuote(todoKeyValue, t), 'Added under the to-do')} />;
  if (result.intent === 'steps') return <StepsView result={result} onInsert={(s) => placed(insertSteps(todoKeyValue, s), 'Added as sub-tasks')} />;
  if (result.intent === 'project') return <PlanView plan={result} busy={a.busy === 'applying'} canUndo={!!a.thread?.canUndo} onApply={a.apply} onUndo={a.undo} />;
  return <AnswerView result={result} onInsert={(t) => placed(insertQuote(todoKeyValue, t), 'Added under the to-do')} />;
}

function Composer({ a }: { a: Assist }) {
  const [text, setText] = useState('');
  const result = a.thread?.result;
  const options = result?.question?.options ?? [];
  const send = (msg: string) => { if (!msg.trim() || a.busy) return; a.send(msg.trim()); setText(''); };
  return (
    <div className="border-t border-border p-3 space-y-2">
      {(options.length > 0 || (result?.suggestions.length ?? 0) > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {(options.length ? options : result?.suggestions ?? []).map((s) => (
            <button key={s} onClick={() => send(s)} disabled={!!a.busy} className="text-xs px-2 py-1 rounded-full border border-border hover:border-accent disabled:opacity-50">{s}</button>
          ))}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={options.length ? 'Or type a name…' : 'Ask for a change…'} className="flex-1 min-w-0 px-3 py-2 rounded border border-border bg-bg text-sm" />
        <button type="submit" disabled={!!a.busy || !text.trim()} aria-label="Send" className="px-3 rounded bg-accent text-white disabled:opacity-50"><Send size={14} /></button>
      </form>
    </div>
  );
}

function Body({ a, todoKeyValue }: { a: Assist; todoKeyValue: string }) {
  const stage = useStage(a.busy === 'thinking');
  const result = a.thread?.result;
  const asked = a.thread?.messages.filter((m) => m.role === 'user') ?? [];
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {asked.length > 0 && <p className="text-xs">You asked: {asked.map((m) => `“${m.content}”`).join(', then ')}</p>}
      {a.busy === 'thinking' && (
        <p className="flex items-center gap-2 text-sm"><Loader2 size={14} className="animate-spin" /> {stage}</p>
      )}
      {a.error && <p className="text-sm text-red-600">{a.error}</p>}
      {result && (
        <div className={a.busy === 'thinking' ? 'opacity-50 pointer-events-none' : ''}>
          <Result result={result} a={a} todoKeyValue={todoKeyValue} />
        </div>
      )}
    </div>
  );
}

export function AssistPanel({ todo, onClose }: { todo: AssistTodo; onClose: () => void }) {
  const a = useAssist(todo);
  const key = todoKey(todo.text);
  const intent = a.thread?.result?.intent;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const done = () => (markTodoDone(key) ? toast.success('Marked done') : toast.error('Could not find that to-do in the journal'));

  return createPortal(
    <>
      <div className="md:hidden fixed inset-0 z-[440] bg-black/30" onClick={onClose} />
      <aside role="dialog" aria-label="To-do assistant" className="fixed z-[450] inset-x-0 bottom-0 max-h-[85vh] md:inset-x-auto md:right-0 md:top-0 md:bottom-0 md:max-h-none md:w-[440px] flex flex-col bg-surface border-t md:border-t-0 md:border-l border-border shadow-2xl rounded-t-xl md:rounded-none">
        <header className="flex items-start gap-2 p-4 border-b border-border">
          <Sparkles size={16} className="mt-1 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-snug">{todo.text}</h2>
            {intent && <p className="text-xs text-muted mt-0.5">{KIND[intent]}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-bg"><X size={16} /></button>
        </header>
        <Body a={a} todoKeyValue={key} />
        <div className="flex items-center justify-between px-4 pt-2 text-xs">
          <button onClick={done} className="inline-flex items-center gap-1 hover:text-accent"><CheckSquare size={13} /> Mark to-do done</button>
          <button onClick={a.restart} disabled={!!a.busy} className="inline-flex items-center gap-1 hover:text-accent disabled:opacity-50"><RotateCcw size={13} /> Start over</button>
        </div>
        <Composer a={a} />
      </aside>
    </>,
    document.body,
  );
}
