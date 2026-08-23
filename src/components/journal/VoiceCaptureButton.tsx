'use client';
import { useEffect, useState } from 'react';
import { Mic } from 'lucide-react';
import { VoiceCaptureModal } from './VoiceCaptureModal';

// Opens the voice-note recorder. Records → transcribes → (optionally tidies)
// → appends to today's journal. Also reachable as a PWA app shortcut
// (public/manifest.json) via ?voice=1, handled below.
export function VoiceCaptureButton() {
  const [open, setOpen] = useState(false);

  // Auto-open when launched from the PWA "Voice note" shortcut (/?voice=1),
  // then strip the param so a refresh doesn't reopen it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('voice') === '1') {
      setOpen(true);
      params.delete('voice');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border font-medium hover:bg-surface active:scale-[0.98] transition"
      >
        <Mic size={18} className="text-accent" />
        Voice note
      </button>
      {open && <VoiceCaptureModal onClose={() => setOpen(false)} />}
    </>
  );
}
