'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Send, Sparkles, Tags, X } from 'lucide-react';
import type { Source } from '@/lib/budgetAssist/assistant';
import { SourcesView } from './SourcesView';
import { MerchantGroupsDialog } from './MerchantGroupsDialog';

type Message = { role: 'user' | 'assistant'; content: string; sources?: Source[] };

export const SUGGESTED_QUESTIONS = [
  'Where did my spending change over the last 3 months?',
  'Did I pay my bills on time last month?',
  'How much did I spend on fast food last month?',
  'Am I on pace with my budget this month?',
];

const STAGES = ['Looking up your numbers…', 'Checking another figure…', 'Still working. The model is slow right now…'];
const HISTORY_TURNS = 10;

function useStage(active: boolean): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) { setI(0); return; }
    const timers = [4000, 15000].map((ms, n) => setTimeout(() => setI(n + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [active]);
  return STAGES[i];
}

async function ask(question: string, history: Message[]): Promise<Message> {
  const r = await fetch('/api/budget/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, history: history.slice(-HISTORY_TURNS).map(({ role, content }) => ({ role, content })) }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error ?? (r.status === 504 ? 'The assistant timed out. Try again.' : 'Something went wrong'));
  return { role: 'assistant', content: d.reply, sources: d.sources };
}

function Conversation({ messages, busy, error, onAsk }: { messages: Message[]; busy: boolean; error: string; onAsk: (q: string) => void }) {
  const stage = useStage(busy);
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages.length, busy]);
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.length === 0 && (
        <div className="space-y-3">
          <p className="text-sm">Ask about your spending, budgets or bills. Every figure comes from your ledger, and each answer shows how it was worked out.</p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button key={q} onClick={() => onAsk(q)} className="text-xs px-2.5 py-1 rounded-full border border-border hover:border-accent text-left">{q}</button>
            ))}
          </div>
        </div>
      )}
      {messages.map((m, i) => m.role === 'user' ? (
        <p key={i} className="ml-8 rounded-lg bg-accent/10 px-3 py-2 text-sm">{m.content}</p>
      ) : (
        <div key={i} className="text-sm">
          <p className="whitespace-pre-wrap">{m.content}</p>
          <SourcesView sources={m.sources ?? []} />
        </div>
      ))}
      {busy && <p className="flex items-center gap-2 text-sm"><Loader2 size={14} className="animate-spin" /> {stage}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div ref={end} />
    </div>
  );
}

export function BudgetAssistantPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [groupsOpen, setGroupsOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !groupsOpen) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, groupsOpen]);

  const send = async (question: string) => {
    if (!question.trim() || busy) return;
    const history = messages;
    setMessages([...history, { role: 'user', content: question.trim() }]);
    setText(''); setError(''); setBusy(true);
    try {
      const reply = await ask(question.trim(), history);
      setMessages((prev) => [...prev, reply]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <>
      <div className="md:hidden fixed inset-0 z-[440] bg-black/30" onClick={onClose} />
      <aside role="dialog" aria-label="Budget assistant" className="fixed z-[450] inset-x-0 bottom-0 max-h-[85vh] md:inset-x-auto md:right-0 md:top-0 md:bottom-0 md:max-h-none md:w-[480px] flex flex-col bg-surface border-t md:border-t-0 md:border-l border-border shadow-2xl rounded-t-xl md:rounded-none">
        <header className="flex items-center gap-2 p-4 border-b border-border">
          <Sparkles size={16} className="shrink-0 text-accent" />
          <h2 className="flex-1 text-base font-semibold">Budget assistant</h2>
          <button onClick={() => setGroupsOpen(true)} className="inline-flex items-center gap-1 text-xs hover:text-accent"><Tags size={13} /> Merchant groups</button>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-bg"><X size={16} /></button>
        </header>
        <Conversation messages={messages} busy={busy} error={error} onAsk={send} />
        <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex gap-2 border-t border-border p-3">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about your budget…" aria-label="Question" className="flex-1 min-w-0 px-3 py-2 rounded border border-border bg-bg text-sm" />
          <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="px-3 rounded bg-accent text-white disabled:opacity-50"><Send size={14} /></button>
        </form>
      </aside>
      {groupsOpen && <MerchantGroupsDialog onClose={() => setGroupsOpen(false)} />}
    </>,
    document.body,
  );
}

export function BudgetAssistantButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-surface" title="Ask about your budget">
        <Sparkles size={14} className="text-accent" /> Ask
      </button>
      {open && <BudgetAssistantPanel onClose={() => setOpen(false)} />}
    </>
  );
}
