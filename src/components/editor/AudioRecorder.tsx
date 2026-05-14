'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, Square, Loader2, Check, X, RotateCcw } from 'lucide-react';
import type { Editor } from '@tiptap/react';

type Status = 'idle' | 'recording' | 'transcribing' | 'done' | 'error';

function getBestMimeType(): string {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

function mimeToExt(mime: string): string {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'mp4';
  return 'webm';
}

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60);
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function AudioRecorder({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [status, setStatus] = useState<Status>('idle');
  const [duration, setDuration] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      timerRef.current && clearInterval(timerRef.current);
      mrRef.current?.state === 'recording' && mrRef.current.stop();
    };
  }, []);

  const startRecording = useCallback(async () => {
    setErrorMsg('');
    setDuration(0);
    chunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErrorMsg('Microphone access denied.');
      return;
    }

    const mime = getBestMimeType();
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mrRef.current = mr;

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
      await runTranscription(blob, mr.mimeType || 'audio/webm');
    };

    mr.start(500);
    setStatus('recording');
    timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
  }, []);

  const stopRecording = useCallback(() => {
    timerRef.current && clearInterval(timerRef.current);
    mrRef.current?.stop();
    setStatus('transcribing');
  }, []);

  const runTranscription = useCallback(async (blob: Blob, mime: string) => {
    const fd = new FormData();
    fd.append('audio', blob, `recording.${mimeToExt(mime)}`);

    try {
      const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Transcription failed');
      setTranscript(json.text ?? '');
      setStatus('done');
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Unknown error');
      setStatus('error');
    }
  }, []);

  const insertTranscript = useCallback(() => {
    if (!transcript) return;
    editor.chain().focus().insertContent(`<p>${transcript}</p>`).run();
    onClose();
  }, [editor, transcript, onClose]);

  const reset = useCallback(() => {
    setStatus('idle');
    setDuration(0);
    setTranscript('');
    setErrorMsg('');
  }, []);

  return (
    <div className="rounded-xl border border-border bg-surface shadow-lg p-4 w-full max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-text flex items-center gap-2">
          <Mic size={14} className="text-accent" />
          Voice to Text
        </span>
        <button onClick={onClose} className="p-1 rounded hover:bg-bg text-muted">
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      {status === 'idle' && (
        <div className="flex flex-col items-center gap-3 py-4">
          <button
            onClick={startRecording}
            className="w-16 h-16 rounded-full bg-accent text-white flex items-center justify-center hover:bg-accent/80 transition-colors shadow-md"
          >
            <Mic size={28} />
          </button>
          <span className="text-sm text-muted">Tap to start recording</span>
          {errorMsg && <p className="text-xs text-red-500 text-center">{errorMsg}</p>}
        </div>
      )}

      {status === 'recording' && (
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="relative">
            <button
              onClick={stopRecording}
              className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors shadow-md"
            >
              <Square size={22} />
            </button>
            {/* Pulse ring */}
            <span className="absolute inset-0 rounded-full bg-red-500/30 animate-ping" />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-mono text-text">{formatDuration(duration)}</span>
          </div>
          <span className="text-xs text-muted">Tap square to stop</span>
        </div>
      )}

      {status === 'transcribing' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <Loader2 size={32} className="animate-spin text-accent" />
          <span className="text-sm text-muted">Transcribing audio…</span>
        </div>
      )}

      {status === 'done' && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg bg-bg border border-border p-3 text-sm text-text max-h-40 overflow-y-auto">
            {transcript || <span className="text-muted italic">No speech detected</span>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={insertTranscript}
              disabled={!transcript}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-40"
            >
              <Check size={14} /> Insert into note
            </button>
            <button
              onClick={reset}
              className="p-2 rounded-lg border border-border hover:bg-bg text-muted transition-colors"
              title="Record again"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center gap-3 py-4">
          <p className="text-sm text-red-500 text-center">{errorMsg}</p>
          <button
            onClick={reset}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-bg text-sm transition-colors"
          >
            <RotateCcw size={13} /> Try again
          </button>
        </div>
      )}
    </div>
  );
}
