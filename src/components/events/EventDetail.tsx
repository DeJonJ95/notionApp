'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { confirmDialog, toast } from '@/components/ui/feedback';
import { GuestTable } from './GuestTable';
import { ImportPanel } from './ImportPanel';
import { CheckInPanel } from './CheckInPanel';
import { InviteBuilder } from './InviteBuilder';
import { AddGuestForm } from './AddGuestForm';
import { InviteSender } from './InviteSender';
import { api, fmtDate, type EventDetailData, type Guest } from './types';

function Stats({ guests }: { guests: Guest[] }) {
  const going = guests.filter((g) => g.rsvp === 'going').length;
  const came = guests.filter((g) => g.attended).length;
  const fromRsvp = guests.filter((g) => g.attended && g.rsvp === 'going').length;
  const items = [
    ['Going', going],
    ['Came', came],
    ['Walk-ins', came - guests.filter((g) => g.attended && g.rsvp).length],
    ['Show rate', going ? `${Math.round((fromRsvp / going) * 100)}%` : '–'],
  ];
  return (
    <dl className="grid grid-cols-4 gap-2 border-y border-border py-3">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
          <dd className="text-xl font-semibold text-text tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EventDetail({ id }: { id: string }) {
  const router = useRouter();
  const [event, setEvent] = useState<EventDetailData | null>(null);
  const load = useCallback(() => {
    api<EventDetailData>(`/api/events/${id}`).then(setEvent).catch(() => toast.error('Could not load event'));
  }, [id]);
  useEffect(load, [load]);

  if (!event) return null;
  const patchGuest = (g: Guest, local: Partial<Guest>, remote: object = local) => {
    setEvent({ ...event, attendances: event.attendances.map((a) => (a.id === g.id ? { ...a, ...local } : a)) });
    api(`/api/events/${id}/guests/${g.id}`, 'PATCH', remote).catch(() => { toast.error('Change failed'); load(); });
  };
  const removeGuest = async (g: Guest) => {
    if (!(await confirmDialog({ message: `Remove ${g.person.name} from this event? They stay in People.`, danger: true }))) return;
    setEvent({ ...event, attendances: event.attendances.filter((a) => a.id !== g.id) });
    api(`/api/events/${id}/guests/${g.id}`, 'DELETE').catch(load);
  };
  const mergeGuest = async (g: Guest, into: { id: string; name: string }) => {
    if (!(await confirmDialog({ message: `Merge "${g.person.name}" into ${into.name}? Their history combines and "${g.person.name}" is remembered as another spelling.` }))) return;
    api('/api/people/merge', 'POST', { keepId: into.id, mergeId: g.person.id }).then(load, () => toast.error('Merge failed'));
  };
  const deleteEvent = async () => {
    if (!(await confirmDialog({ title: `Delete ${event.name}?`, message: 'Its guest list goes too. People stay.', danger: true }))) return;
    await api(`/api/events/${id}`, 'DELETE');
    router.push('/events');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div className="space-y-1">
        <Link href="/events" className="inline-flex items-center gap-1 text-sm text-accent hover:underline"><ArrowLeft size={14} /> Events</Link>
        <h1 className="text-2xl font-semibold text-text">{event.name}</h1>
        <p className="text-sm text-text">{fmtDate(event.date)}{event.venue ? ` · ${event.venue}` : ''}</p>
        <label className="flex items-center gap-2 text-sm text-text" title="Turn off if some guests came without being checked in, so nobody is marked a no-show from this event">
          <input
            type="checkbox"
            checked={event.fullCheckIn}
            onChange={(e) => {
              setEvent({ ...event, fullCheckIn: e.target.checked });
              api(`/api/events/${id}`, 'PATCH', { fullCheckIn: e.target.checked }).catch(load);
            }}
          />
          Everyone was checked in at the door
        </label>
      </div>
      <Stats guests={event.attendances} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <AddGuestForm eventId={id} listed={new Set(event.attendances.map((a) => a.person.id))} onAdded={load} />
          <GuestTable
            guests={event.attendances}
            onToggle={(g) => patchGuest(g, { attended: !g.attended })}
            onRsvp={(g, rsvp) => patchGuest(g, { rsvp })}
            onRemove={removeGuest}
            onMerge={mergeGuest}
            onContact={(g, action) =>
              patchGuest(g, { contactGiven: null, person: action === 'accept' ? { ...g.person, contact: g.contactGiven } : g.person }, { contact: action })
            }
          />
        </div>
        <div className="space-y-8">
          <InviteBuilder eventId={id} onAdded={load} />
          <InviteSender event={event} onSent={(g, sent) => patchGuest(g, { invitedAt: sent ? new Date().toISOString() : null }, { sent })} onSaved={load} />
          <CheckInPanel eventId={id} token={event.checkInToken} open={event.checkInOpen} onChange={load} />
          <ImportPanel eventId={id} onDone={load} />
          <button onClick={deleteEvent} className="text-sm text-red-500 hover:underline">Delete event</button>
        </div>
      </div>
    </div>
  );
}
