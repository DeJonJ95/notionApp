'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy } from 'lucide-react';
import { toast } from '@/components/ui/feedback';
import { api } from './types';

type Props = { eventId: string; token: string; open: boolean; onChange: () => void };

export function CheckInPanel({ eventId, token, open, onChange }: Props) {
  const [qr, setQr] = useState('');
  const [url, setUrl] = useState('');

  useEffect(() => {
    const link = `${window.location.origin}/checkin/${token}`;
    setUrl(link);
    QRCode.toDataURL(link, { width: 480, margin: 1 }).then(setQr).catch(() => setQr(''));
  }, [token]);

  const toggle = async () => {
    try {
      await api(`/api/events/${eventId}`, 'PATCH', { checkInOpen: !open });
      onChange();
    } catch {
      toast.error('Could not change check-in');
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-text">Door check-in</h2>
      <p className="text-sm text-text">
        Print or show this code at the door. Guests scan it, enter their name and number, and land in the list as checked in. It only accepts check-ins while open.
      </p>
      <div className="flex flex-wrap items-start gap-4">
        {qr && (
          // eslint-disable-next-line @next/next/no-img-element -- a data: URL, nothing for next/image to optimise
          <a href={qr} download="checkin-qr.png" title="Download QR code">
            <img src={qr} alt="Check-in QR code" className="w-40 h-40 rounded border border-border bg-white" />
          </a>
        )}
        <div className="space-y-2">
          <button
            onClick={toggle}
            className={`px-3 py-1.5 rounded text-sm ${open ? 'bg-red-500 text-white' : 'bg-accent text-white'}`}
          >
            {open ? 'Close check-in' : 'Open check-in'}
          </button>
          <p className="text-sm text-text">{open ? 'Open: guests can check in now.' : 'Closed.'}</p>
          <button
            onClick={() => navigator.clipboard.writeText(url).then(() => toast.success('Link copied'))}
            className="flex items-center gap-1.5 text-sm text-accent hover:underline"
          >
            <Copy size={13} /> Copy check-in link
          </button>
        </div>
      </div>
    </section>
  );
}
