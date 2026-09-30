'use client';

import { useState } from 'react';
import { Check, Copy, MessageSquare } from 'lucide-react';
import { toast } from '@/components/ui/feedback';
import { contactLink, DEFAULT_INVITE, fillMessage } from '@/lib/events/message';
import { api, type EventDetailData, type Guest } from './types';

const field = 'w-full bg-bg text-text border border-border rounded px-2 py-1.5 text-sm';
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

type Props = { event: EventDetailData; onSent: (g: Guest, sent: boolean) => void; onSaved: () => void };

function SendRow({ g, body, onSent }: { g: Guest; body: string; onSent: Props['onSent'] }) {
  const link = contactLink(g.person.contact, body);
  const copy = () => navigator.clipboard.writeText(body).then(() => toast.success('Message copied'));
  const send = () => {
    if (link?.kind !== 'sms') copy();
    onSent(g, true);
  };
  return (
    <li className="flex items-center gap-2 py-2">
      <span className="flex-1 min-w-0">
        <span className="block text-text truncate">{g.person.name}</span>
        <span className="block text-xs text-muted truncate">{g.person.contact ?? 'No contact: copy and send yourself'}</span>
      </span>
      {g.invitedAt ? (
        <button onClick={() => onSent(g, false)} className="flex items-center gap-1 text-sm text-text" title="Mark as not sent">
          <Check size={14} /> Sent
        </button>
      ) : link ? (
        <a href={link.href} target={link.kind === 'instagram' ? '_blank' : undefined} rel="noreferrer" onClick={send}
          className="flex items-center gap-1 px-2.5 py-1 bg-accent text-white rounded text-sm">
          <MessageSquare size={13} /> {link.kind === 'sms' ? 'Text' : 'DM'}
        </a>
      ) : (
        <button onClick={send} className="flex items-center gap-1 px-2.5 py-1 border border-border rounded text-sm text-text">
          <Copy size={13} /> Copy
        </button>
      )}
    </li>
  );
}

export function InviteSender({ event, onSent, onSaved }: Props) {
  const [template, setTemplate] = useState(event.inviteMessage ?? DEFAULT_INVITE);
  const [link, setLink] = useState(event.link ?? '');
  const [showSent, setShowSent] = useState(false);
  const invited = event.attendances.filter((a) => a.rsvp === 'invited' && !a.person.isPlaceholder);
  const unsent = invited.filter((a) => !a.invitedAt);
  const rows = showSent ? invited : unsent;
  if (invited.length === 0) return null;

  const save = (patch: { link?: string | null; inviteMessage?: string | null }) =>
    api(`/api/events/${event.id}`, 'PATCH', patch).then(onSaved, () => toast.error('Could not save'));
  const bodyFor = (g: Guest) => fillMessage(template, { name: g.person.name, event: event.name, date: dayLabel(event.date), link });

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-text">Send invites</h2>
      <input value={link} onChange={(e) => setLink(e.target.value)} onBlur={() => save({ link: link || null })} placeholder="Partiful link" className={field} />
      <textarea value={template} onChange={(e) => setTemplate(e.target.value)} onBlur={() => save({ inviteMessage: template })} rows={3} className={field} />
      <p className="text-xs text-muted">{'{first}'} {'{name}'} {'{event}'} {'{date}'} {'{link}'} fill in per person.</p>
      <div className="flex items-center justify-between text-sm text-text">
        <span className="tabular-nums">{unsent.length} of {invited.length} still to send</span>
        <button onClick={() => setShowSent((v) => !v)} className="text-accent hover:underline">{showSent ? 'Hide sent' : 'Show sent'}</button>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((g) => <SendRow key={g.id} g={g} body={bodyFor(g)} onSent={onSent} />)}
      </ul>
    </section>
  );
}
