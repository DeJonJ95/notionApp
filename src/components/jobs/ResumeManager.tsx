'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Upload, Trash2, FileText, Loader2, ArrowLeft, Download, AlertTriangle } from 'lucide-react';
import type { Resume } from './types';

export function ResumeManager() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/resumes')
      .then((r) => (r.ok ? r.json() : { resumes: [] }))
      .then((d) => setResumes(d.resumes ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    if (!file) { setError('Choose a .docx or .pdf file first'); return; }
    setError('');
    setWarning('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('label', label || file.name.replace(/\.(docx|pdf)$/i, ''));
      const r = await fetch('/api/resumes', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Upload failed');
      if (d.warning) setWarning(d.warning);
      setLabel('');
      setFile(null);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this resume?')) return;
    await fetch(`/api/resumes/${id}`, { method: 'DELETE' });
    setResumes((rs) => rs.filter((r) => r.id !== id));
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/jobs" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text mb-4">
        <ArrowLeft size={14} /> Back to jobs
      </Link>
      <h1 className="text-2xl font-semibold mb-1">Base resumes</h1>
      <p className="text-sm text-muted mb-6">
        Upload up to three resumes (.docx or .pdf). ApplyKit scores each against a job and tailors the best fit — truthfully, never inventing experience. Auto-tailoring edits the file in place, which needs a <strong>.docx</strong>; PDFs are scored and get a recruiter message, but you apply tweaks manually.
      </p>

      <div className="border border-border rounded-lg p-4 mb-6 bg-surface">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Label (e.g. Frontend, Full-stack)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="flex-1 px-3 py-2 rounded border border-border bg-bg text-sm"
          />
          <label className="flex items-center gap-2 px-3 py-2 rounded border border-border bg-bg text-sm cursor-pointer hover:border-accent">
            <FileText size={14} />
            <span className="truncate max-w-[160px]">{file ? file.name : 'Choose .docx or .pdf'}</span>
            <input
              type="file"
              accept=".docx,.pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            onClick={upload}
            disabled={uploading || !file}
            className="inline-flex items-center gap-2 px-4 py-2 rounded bg-accent text-white text-sm disabled:opacity-50"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Upload
          </button>
        </div>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        {warning && (
          <p className="text-sm text-amber-600 mt-2 flex items-start gap-1.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {warning}
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12 text-muted"><Loader2 className="animate-spin" /></div>
      ) : resumes.length === 0 ? (
        <p className="text-sm text-muted text-center py-12">No resumes yet. Upload one above to get started.</p>
      ) : (
        <ul className="space-y-2">
          {resumes.map((r) => (
            <li key={r.id} className="flex items-center justify-between border border-border rounded-lg px-4 py-3 bg-surface">
              <div className="flex items-center gap-3 min-w-0">
                <FileText size={18} className="text-muted shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium truncate flex items-center gap-2">
                    {r.label}
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-bg border border-border text-muted">{r.fileType}</span>
                  </div>
                  <div className="text-xs text-muted">{new Date(r.createdAt).toLocaleDateString()}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`/api/files/download?key=${encodeURIComponent(r.r2Key)}`}
                  className="p-2 rounded hover:bg-bg text-muted"
                  title="Download"
                >
                  <Download size={16} />
                </a>
                <button onClick={() => remove(r.id)} className="p-2 rounded hover:bg-bg text-red-500" title="Delete">
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
