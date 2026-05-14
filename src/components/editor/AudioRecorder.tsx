'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, Square, Loader2, Check, X, RotateCcw } from 'lucide-react';
import type { Editor } from '@tiptap/react';

type Status = 'idle' | 'recording' | 'transcribing' | 'done' | 'error';

// Rotate the MediaRecorder every 2.5 minutes — at 32 kbps Opus that's ~600 KB
// per chunk, well under Vercel's 4.5 MB request-body limit and Groq's 25 MB cap.
const CHUNK_DURATION_MS = 150_000;
// Voice-quality mono Opus. Plenty for speech, ~4× smaller than the default.
const AUDIO_BITRATE = 32_000;

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
  // Ordered list of per-chunk transcripts (null = pending / failed slot kept for ordering)
  const [transcripts, setTranscripts] = useState<(string | null)[]>([]);
  const [chunksTotal, setChunksTotal] = useState(0);
  const [chunksDone, setChunksDone] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  const streamRef = useRef<MediaStream | null>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const rotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkIndexRef = useRef(0);

  // ── Lifecycle ─────────────────────────────────────────────────────────
  useEffect(() => {
    return () => { cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanup = () => {
    if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current);
    if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    rotateTimerRef.current = null;
    durationTimerRef.current = null;
    const mr = mrRef.current;
    if (mr && mr.state === 'recording') {
      try { mr.stop(); } catch {}
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mrRef.current = null;
  };

  // ── Transcribe a single chunk and write it back into its slot ────────
  const transcribeChunk = async (blob: Blob, mime: string, idx: number) => {
    try {
      const fd = new FormData();
      fd.append('audio', blob, `chunk-${idx}.${mimeToExt(mime)}`);
      const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Transcription failed');
      setTranscripts((prev) => {
        const next = [...prev];
        while (next.length <= idx) next.push(null);
        next[idx] = json.text ?? '';
        return next;
      });
      setChunksDone((n) => n + 1);
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Transcription failed');
      setStatus('error');
    }
  };

  // ── Start a fresh MediaRecorder on the stream; rotate after CHUNK_DURATION_MS ──
  const startChunkRecorder = (stream: MediaStream) => {
    const mime = getBestMimeType();
    const mr = new MediaRecorder(stream, {
      mimeType: mime || undefined,
      audioBitsPerSecond: AUDIO_BITRATE,
    });
    const buffer: Blob[] = [];
    const myIdx = chunkIndexRef.current++;
    setChunksTotal((n) => Math.max(n, myIdx + 1));

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) buffer.push(e.data);
    };

    mr.onstop = () => {
      if (buffer.length === 0) {
        // Empty chunk (recorder never received data) — still count it as done
        // so chunksDone can catch up to chunksTotal.
        setChunksDone((n) => n + 1);
        return;
      }
      const blob = new Blob(buffer, { type: mr.mimeType || 'audio/webm' });
      void transcribeChunk(blob, mr.mimeType || 'audio/webm', myIdx);
    };

    mr.start(500);
    mrRef.current = mr;

    rotateTimerRef.current = setTimeout(() => rotateChunk(stream), CHUNK_DURATION_MS);
  };

  // Stop the current MR and immediately start a new one on the same stream.
  // The old MR's onstop fires asynchronously and ships its chunk to Whisper.
  const rotateChunk = (stream: MediaStream) => {
    const old = mrRef.current;
    if (old && old.state === 'recording') {
      try { old.stop(); } catch {}
    }
    startChunkRecorder(stream);
  };

  const startRecording = useCallback(async () => {
    setErrorMsg('');
    setDuration(0);
    setTranscripts([]);
    setChunksTotal(0);
    setChunksDone(0);
    chunkIndexRef.current = 0;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch {
      setErrorMsg('Microphone access denied.');
      return;
    }
    streamRef.current = stream;

    startChunkRecorder(stream);
    setStatus('recording');
    durationTimerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
  }, []);

  const stopRecording = useCallback(() => {
    if (rotateTimerRef.current) {
      clearTimeout(rotateTimerRef.current);
      rotateTimerRef.current = null;
    }
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    const mr = mrRef.current;
    if (mr && mr.state === 'recording') {
      try { mr.stop(); } catch {}
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStatus('transcribing');
  }, []);

  // Flip to 'done' once every chunk has come back.
  useEffect(() => {
    if (status === 'transcribing' && chunksTotal > 0 && chunksDone >= chunksTotal) {
      setStatus('done');
    }
  }, [status, chunksDone, chunksTotal]);

  const fullTranscript = transcripts
    .filter((t): t is string => typeof t === 'string')
    .join(' ')
    .trim();

  const insertTranscript = useCallback(() => {
    if (!fullTranscript) return;
    editor.chain().focus().insertContent(`<p>${fullTranscript}</p>`).run();
    onClose();
  }, [editor, fullTranscript, onClose]);

  const reset = useCallback(() => {
    cleanup();
    setStatus('idle');
    setDuration(0);
    setTranscripts([]);
    setChunksTotal(0);
    setChunksDone(0);
    chunkIndexRef.current = 0;
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
          <span className="text-xs text-muted/70 max-w-xs text-center">
            Long recordings split into 2.5-min chunks and transcribe in parallel.
          </span>
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
            {/* Pulse ring — pointer-events-none so clicks reach the button beneath */}
            <span className="absolute inset-0 rounded-full bg-red-500/30 animate-ping pointer-events-none" />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-mono text-text">{formatDuration(duration)}</span>
          </div>
          {chunksDone > 0 && (
            <span className="text-xs text-muted">
              {chunksDone} chunk{chunksDone !== 1 ? 's' : ''} transcribed in background
            </span>
          )}
          <span className="text-xs text-muted">Tap square to stop</span>
        </div>
      )}

      {status === 'transcribing' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <Loader2 size={32} className="animate-spin text-accent" />
          <span className="text-sm text-muted">
            Transcribing {chunksDone}/{chunksTotal} chunk{chunksTotal !== 1 ? 's' : ''}…
          </span>
        </div>
      )}

      {status === 'done' && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg bg-bg border border-border p-3 text-sm text-text max-h-40 overflow-y-auto">
            {fullTranscript || <span className="text-muted italic">No speech detected</span>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={insertTranscript}
              disabled={!fullTranscript}
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
