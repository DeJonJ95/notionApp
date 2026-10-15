'use client';
import { useEffect, useState } from 'react';
import { ListPlus, CornerDownRight } from 'lucide-react';
import type { AnswerResult, StepsResult } from '@/lib/assist/types';

export function StepsView({ result, onInsert }: { result: StepsResult; onInsert: (steps: string[]) => void }) {
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(result.steps.map((_, i) => i)));
  useEffect(() => { setChosen(new Set(result.steps.map((_, i) => i))); }, [result.steps]);
  const toggle = (i: number) => setChosen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return (
    <div className="space-y-3">
      <ol className="space-y-1.5">
        {result.steps.map((s, i) => (
          <li key={`${i}-${s}`}>
            <label className="flex gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={chosen.has(i)} onChange={() => toggle(i)} className="mt-1 shrink-0" />
              <span>{s}</span>
            </label>
          </li>
        ))}
      </ol>
      <button onClick={() => onInsert(result.steps.filter((_, i) => chosen.has(i)))} disabled={!chosen.size} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-sm disabled:opacity-50">
        <ListPlus size={14} /> Add as sub-tasks
      </button>
    </div>
  );
}

function Lines({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2 text-sm">
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*-\s/.test(l))) {
          return <ul key={i} className="list-disc pl-5 space-y-0.5">{lines.map((l, j) => <li key={j}>{l.replace(/^\s*-\s/, '')}</li>)}</ul>;
        }
        return <p key={i} className="whitespace-pre-wrap">{b}</p>;
      })}
    </div>
  );
}

export function AnswerView({ result, onInsert }: { result: AnswerResult; onInsert: (text: string) => void }) {
  return (
    <div className="space-y-3">
      <Lines text={result.text} />
      {!result.question && result.text && (
        <button onClick={() => onInsert(result.text)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border text-sm hover:border-accent">
          <CornerDownRight size={14} /> Add under the to-do
        </button>
      )}
    </div>
  );
}
