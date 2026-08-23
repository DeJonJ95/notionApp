'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, Square, Loader2, X, Sparkles, Check, NotebookPen } from 'lucide-react';
import Link from 'next/link';
import { toast } from '@/components/ui/feedback';
import { htmlToTipTapDoc, textToDoc, type TipTapDoc } from '@/lib/htmlToTipTap';

type Phase = 'idle' | 'recording' | 'transcribing' | 'review' | 'saving' | 'done';

// Cap a single clip so its encoded size stays well under Vercel's 4.5 MB
// body limit (32 kbps mono ≈ 4 KB/s, so 10 min ≈ 2.4 MB).
const MAX_SECONDS = 10 * 60;

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

function localDateIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function clock(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function VoiceCaptureModal({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [tidy, setTidy] = useState(true);
  const [error, setError] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  useEffect(() => () => stopTracks(), [stopTracks]);

  const transcribe = useCallback(async (blob: Blob, ext: string) => {
    setPhase('transcribing');
    setError('');
    try {
      const form = new FormData();
      form.append('audio', blob, `voice-note.${ext}`);
      const res = await fetch('/api/transcribe', { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Transcription failed');
        setPhase('idle');
        return;
      }
      const text = (json.text ?? '').trim();
      if (!text) {
        setError('Nothing was transcribed — try again and speak clearly.');
        setPhase('idle');
        return;
      }
      setTranscript(text);
      setPhase('review');
    } catch {
      setError('Network error while transcribing.');
      setPhase('idle');
    }
  }, []);

  const startRecording = useCallback(async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 32000,
      });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stopTracks();
        const type = rec.mimeType || mimeType || 'audio/webm';
        const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size === 0) {
          setError('No audio captured.');
          setPhase('idle');
          return;
        }
        transcribe(blob, ext);
      };
      recorderRef.current = rec;
      rec.start();
      setSeconds(0);
      setPhase('recording');
      tickRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) {
            recorderRef.current?.state === 'recording' && recorderRef.current.stop();
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      setError('Microphone access denied. Enable it in your browser settings.');
      setPhase('idle');
    }
  }, [stopTracks, transcribe]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const save = useCallback(async () => {
    const text = transcript.trim();
    if (!text) return;
    setPhase('saving');
    setError('');
    try {
      let body: TipTapDoc;
      if (tidy) {
        const res = await fetch('/api/organize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        const json = await res.json().catch(() => ({}));
        // Tidy is best-effort — if it fails, fall back to the raw transcript
        // rather than losing the note.
        body = res.ok && json.html ? htmlToTipTapDoc(json.html) : textToDoc(text);
      } else {
        body = textToDoc(text);
      }

      const stamp = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      const doc: TipTapDoc = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: `🎙️ Voice note — ${stamp}` }] },
          ...body.content,
        ],
      };

      const todayRes = await fetch(`/api/journal/today?date=${localDateIso()}`);
      const todayJson = await todayRes.json().catch(() => ({}));
      if (!todayRes.ok || !todayJson.pageId) {
        setError('Could not open today’s journal.');
        setPhase('review');
        return;
      }

      const blockRes = await fetch('/api/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: todayJson.pageId, type: 'text', content: doc, position: Date.now() }),
      });
      if (!blockRes.ok) {
        setError('Could not save to the journal.');
        setPhase('review');
        return;
      }
      setPhase('done');
      toast.success('Saved to today’s journal');
    } catch {
      setError('Network error while saving.');
      setPhase('review');
    }
  }, [transcript, tidy]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[320] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onMouseDown={onClose}
    >
      <div
        className="bg-bg border border-border rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <span className="font-semibold text-text flex items-center gap-2">
            <Mic size={16} className="text-accent" />
            Voice note
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface text-muted" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

          {phase === 'idle' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <button
                onClick={startRecording}
                className="w-20 h-20 rounded-full bg-accent text-white flex items-center justify-center hover:bg-accent/80 transition-colors shadow-lg"
                aria-label="Start recording"
              >
                <Mic size={30} />
              </button>
              <p className="text-sm text-muted text-center">
                Record a thought and it’s transcribed into today’s journal.
              </p>
            </div>
          )}

          {phase === 'recording' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <button
                onClick={stopRecording}
                className="w-20 h-20 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg animate-pulse"
                aria-label="Stop recording"
              >
                <Square size={26} fill="currentColor" />
              </button>
              <p className="text-lg font-mono tabular-nums text-text">{clock(seconds)}</p>
              <p className="text-xs text-muted">Recording… tap to stop</p>
            </div>
          )}

          {phase === 'transcribing' && (
            <div className="flex flex-col items-center justify-center gap-3 py-10">
              <Loader2 size={24} className="animate-spin text-accent" />
              <span className="text-sm text-muted">Transcribing…</span>
            </div>
          )}

          {(phase === 'review' || phase === 'saving') && (
            <div className="flex flex-col gap-3">
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                disabled={phase === 'saving'}
                rows={7}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-accent resize-y disabled:opacity-60"
              />
              <label className="flex items-center gap-2 text-sm text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={tidy}
                  onChange={(e) => setTidy(e.target.checked)}
                  disabled={phase === 'saving'}
                  className="accent-accent"
                />
                <Sparkles size={14} className="text-accent" />
                Tidy into clean notes with AI
              </label>
            </div>
          )}

          {phase === 'done' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="w-16 h-16 rounded-full bg-green-500/15 text-green-600 flex items-center justify-center">
                <Check size={30} />
              </div>
              <p className="text-sm text-text text-center">Added to today’s journal.</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-border shrink-0">
          {(phase === 'review' || phase === 'saving') && (
            <>
              <button
                onClick={save}
                disabled={phase === 'saving' || !transcript.trim()}
                className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {phase === 'saving' ? <Loader2 size={15} className="animate-spin" /> : <NotebookPen size={15} />}
                Save to journal
              </button>
              <button
                onClick={onClose}
                disabled={phase === 'saving'}
                className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-surface transition-colors disabled:opacity-60"
              >
                Discard
              </button>
            </>
          )}
          {phase === 'done' && (
            <>
              <Link
                href="/journal"
                className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors text-center"
              >
                Open journal
              </Link>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-surface transition-colors"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
