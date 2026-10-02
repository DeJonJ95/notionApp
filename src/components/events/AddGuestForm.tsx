'use client';

import { useEffect, useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { toast } from '@/components/ui/feedback';
import { fuzzyPeople } from '@/lib/events/fuzzy';
import { channelDefaults } from '@/lib/events/guestRows';
import { api } from './types';

type Known = { id: string; name: string; aliases: string[]; contact: string | null; attended: number; lastAttended: string | null; isPlaceholder: boolean };
type Mode = 'text' | 'dm' | 'walk-in';
type Choice = Known | 'new';

const MODES: [Mode, string][] = [['text', 'Texted'], ['dm', 'DMed'], ['walk-in', 'Walked in']];
const field = 'px-3 py-2 bg-bg text-text border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent';

const describe = (p: Known, listed: boolean) =>
  [
    p.contact,
    p.attended ? `came ${p.attended}×` : 'never came',
    p.lastAttended && `last ${new Date(p.lastAttended).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    listed && 'already on this list',
  ].filter(Boolean).join(' · ');

type MenuProps = { options: Choice[]; highlight: number; name: string; listed: Set<string>; onPick: (c: Choice) => void };

function SuggestionMenu({ options, highlight, name, listed, onPick }: MenuProps) {
  return (
    <ul role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded border border-border bg-bg shadow-lg">
      {options.map((o, i) => (
        <li key={o === 'new' ? 'new' : o.id} role="option" aria-selected={i === highlight}>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onPick(o); }}
            className={`block w-full px-3 py-2 text-left ${i === highlight ? 'bg-surface' : ''} hover:bg-surface`}
          >
            {o === 'new' ? (
              <span className="text-sm text-accent">+ New person &ldquo;{name.trim()}&rdquo;</span>
            ) : (
              <>
                <span className="block text-sm text-text">{o.name}</span>
                <span className="block text-xs text-muted">{describe(o, listed.has(o.id))}</span>
              </>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ModePicker({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="How they were reached">
      {MODES.map(([m, label]) => (
        <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => onChange(m)}
          className={`px-2.5 py-1 rounded-full text-sm border ${mode === m ? 'bg-text text-bg border-text' : 'border-border text-text hover:bg-surface'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Add one person by hand. Typing suggests people seen before, but the last
 *  option always creates someone new, so a second Michael is never forced
 *  onto the first. */
export function AddGuestForm({ eventId, listed, onAdded }: { eventId: string; listed: Set<string>; onAdded: () => void }) {
  const [people, setPeople] = useState<Known[]>([]);
  const [mode, setMode] = useState<Mode>('text');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [picked, setPicked] = useState<Choice | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    api<{ people: Known[] }>('/api/people').then((d) => setPeople(d.people.filter((p) => !p.isPlaceholder))).catch(() => {});
  }, []);
  const options: Choice[] = useMemo(() => (name.trim() ? [...fuzzyPeople(name, people), 'new'] : []), [name, people]);

  const pick = (c: Choice) => {
    setPicked(c);
    setOpen(false);
    if (c !== 'new') { setName(c.name); setContact(c.contact ?? ''); }
  };
  const reset = () => { setName(''); setContact(''); setPicked(null); setHighlight(0); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked && options.length > 1) { setOpen(true); return; }
    const person = picked && picked !== 'new' ? picked : null;
    try {
      await api(`/api/events/${eventId}/guests`, 'POST', {
        rows: [{ name: name.trim(), contact: contact.trim() || undefined, source: mode, ...channelDefaults(mode), personId: person?.id, forceNew: picked === 'new' }],
      });
      toast.success(`${name.trim()} ${mode === 'walk-in' ? 'checked in' : 'added as invited'}`);
      reset();
      onAdded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add');
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open || options.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
    } else if (e.key === 'Enter') { e.preventDefault(); pick(options[highlight]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <ModePicker mode={mode} onChange={setMode} />
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[10rem]">
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setPicked(null); setOpen(true); setHighlight(0); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKey}
            placeholder="Name"
            required
            aria-label="Name"
            aria-autocomplete="list"
            className={`w-full ${field}`}
          />
          {open && options.length > 1 && <SuggestionMenu options={options} highlight={highlight} name={name} listed={listed} onPick={pick} />}
        </div>
        <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Phone or @handle" aria-label="Contact" className={`flex-1 min-w-[8rem] ${field}`} />
        <button type="submit" className="flex items-center gap-1 px-3 py-2 bg-accent text-white rounded text-sm">
          <UserPlus size={14} /> {mode === 'walk-in' ? 'Check in' : 'Add'}
        </button>
      </div>
      {picked && <p className="text-xs text-text">{picked === 'new' ? `Adding a new person named ${name.trim()}.` : `Adding ${picked.name}, seen before.`}</p>}
    </form>
  );
}
