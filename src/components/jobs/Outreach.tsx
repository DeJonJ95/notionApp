'use client';
import { useState } from 'react';
import { Loader2, Download, Copy, Check, FileText, Mail, RefreshCw } from 'lucide-react';
import { downloadFile } from '@/lib/jobs/download';
import { postJson, errorText, slug, useCopy } from './api';

function CopyButton({ text }: { text: string }) {
  const [copied, copy] = useCopy();
  return (
    <button onClick={() => copy(text)} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function RecruiterMessage({ text }: { text: string }) {
  return (
    <div className="border border-border rounded p-3 bg-bg space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-1.5"><Mail size={14} /> Recruiter message</h4>
        <CopyButton text={text} />
      </div>
      <p className="text-sm whitespace-pre-wrap">{text}</p>
    </div>
  );
}

type LetterProps = { listingId: string; resumeId: string; savedUrl: string | null; company: string; onChanged: () => void };

// A saved letter is reopened from its stored file, so it survives a reload
// without paying for a new generation.
export function CoverLetterSection({ listingId, resumeId, savedUrl, company, onChanged }: LetterProps) {
  const [busy, setBusy] = useState(false);
  const [letter, setLetter] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(savedUrl);
  const [err, setErr] = useState('');

  const run = async (work: () => Promise<void>, fallback: string) => {
    setErr(''); setBusy(true);
    try { await work(); } catch (e) { setErr(errorText(e, fallback)); } finally { setBusy(false); }
  };

  const generate = () => run(async () => {
    const d = await postJson<{ letterText: string; downloadUrl: string }>(`/api/jobs/${listingId}/coverletter`, { resumeId });
    setLetter(d.letterText);
    setUrl(d.downloadUrl);
    onChanged();
  }, 'Cover letter generation failed');

  const open = () => run(async () => {
    const r = await fetch(url!);
    if (!r.ok) throw new Error('Could not load the saved letter');
    setLetter(await r.text());
  }, 'Could not load the saved letter');

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {url && !letter && (
          <button onClick={open} disabled={busy} className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-border text-sm hover:border-accent disabled:opacity-50">
            <FileText size={14} /> Show cover letter
          </button>
        )}
        <button onClick={generate} disabled={busy || !resumeId} className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-border text-sm hover:border-accent disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : url ? <RefreshCw size={14} /> : <FileText size={14} />}
          {url ? 'Regenerate cover letter' : 'Generate cover letter'}
        </button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {letter && (
        <div className="border border-border rounded p-3 bg-bg space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold flex items-center gap-1.5"><FileText size={14} /> Cover letter</h4>
            <div className="flex items-center gap-3">
              <CopyButton text={letter} />
              {url && (
                <button onClick={() => downloadFile(url, `${slug(company)}-cover-letter.txt`).catch(() => setErr('Download failed'))} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                  <Download size={12} /> Download
                </button>
              )}
            </div>
          </div>
          <p className="text-sm whitespace-pre-wrap max-h-64 overflow-auto">{letter}</p>
        </div>
      )}
    </div>
  );
}
