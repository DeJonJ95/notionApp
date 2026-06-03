'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Plus, Loader2, FileText, Briefcase, X, Globe } from 'lucide-react';
import { JobCard } from './JobCard';
import { PIPELINE_STATUSES, statusLabel } from '@/lib/jobs/status';
import type { Listing, Resume } from './types';

export function JobsDashboard() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    fetch('/api/jobs')
      .then((r) => (r.ok ? r.json() : { listings: [] }))
      .then((d) => setListings(d.listings ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
    fetch('/api/resumes')
      .then((r) => (r.ok ? r.json() : { resumes: [] }))
      .then((d) => setResumes(d.resumes ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  // Funnel counts across the pipeline stages.
  const counts: Record<string, number> = {};
  for (const l of listings) {
    const s = l.application?.status;
    if (s) counts[s] = (counts[s] ?? 0) + 1;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Briefcase size={22} /> Jobs</h1>
        <div className="flex items-center gap-2">
          <Link href="/jobs/resumes" className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded border border-border hover:border-accent">
            <FileText size={14} /> Resumes ({resumes.length})
          </Link>
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded bg-accent text-white">
            <Plus size={14} /> Add job
          </button>
        </div>
      </div>
      <p className="text-sm text-muted mb-6">
        Capture a hiring.cafe posting, let DeepSeek score your resumes and suggest truthful tweaks, tailor the best fit, and track every application here.
      </p>

      {/* Funnel */}
      {listings.some((l) => l.application) && (
        <div className="flex flex-wrap gap-2 mb-6">
          {PIPELINE_STATUSES.map((s) => (
            <div key={s} className="px-3 py-1.5 rounded border border-border bg-surface text-sm">
              <span className="font-semibold">{counts[s] ?? 0}</span> <span className="text-muted">{statusLabel(s)}</span>
            </div>
          ))}
        </div>
      )}

      {resumes.length === 0 && (
        <div className="border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 rounded-lg px-4 py-3 mb-6 text-sm">
          Upload at least one base resume to enable analysis and tailoring. <Link href="/jobs/resumes" className="text-accent underline">Add resumes →</Link>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12 text-muted"><Loader2 className="animate-spin" /></div>
      ) : listings.length === 0 ? (
        <p className="text-sm text-muted text-center py-12">No jobs yet. Click “Add job” to paste a posting.</p>
      ) : (
        <div className="space-y-2">
          {listings.map((l) => (
            <JobCard key={l.id} listing={l} resumes={resumes} onChanged={load} />
          ))}
        </div>
      )}

      {adding && <AddJobModal onClose={() => setAdding(false)} onAdded={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function AddJobModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [field, setField] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchFromUrl = async () => {
    if (!url.trim()) { setError('Paste a job URL first'); return; }
    setError(''); setFetching(true);
    try {
      const r = await fetch('/api/jobs/ingest-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not fetch that page');
      onAdded();
    } catch (e: any) { setError(e.message); }
    finally { setFetching(false); }
  };

  const submit = async () => {
    setError(''); setSaving(true);
    try {
      const r = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceUrl: sourceUrl.trim(),
          company: company.trim(),
          title: title.trim(),
          field: field.trim() || null,
          description: description.trim(),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not save job');
      onAdded();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-lg w-full max-w-lg p-5 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Add a job</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          {/* Fastest path: paste any job URL — works on most ATS + company pages */}
          <div>
            <label className="text-xs font-medium text-muted">Paste a job link (LinkedIn, Greenhouse, Lever, company page…)</label>
            <div className="flex gap-2 mt-1">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchFromUrl()}
                placeholder="https://…"
                className="flex-1 px-3 py-2 rounded border border-border bg-bg text-sm"
              />
              <button
                onClick={fetchFromUrl}
                disabled={fetching}
                className="inline-flex items-center gap-2 px-3 py-2 rounded bg-accent text-white text-sm disabled:opacity-50 shrink-0"
              >
                {fetching ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />} Fetch
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted">
            <div className="h-px flex-1 bg-border" /> or enter manually <div className="h-px flex-1 bg-border" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Job title" className="px-3 py-2 rounded border border-border bg-bg text-sm" />
            <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" className="px-3 py-2 rounded border border-border bg-bg text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="Listing URL (https://hiring.cafe/…)" className="px-3 py-2 rounded border border-border bg-bg text-sm" />
            <input value={field} onChange={(e) => setField(e.target.value)} placeholder="Field (optional)" className="px-3 py-2 rounded border border-border bg-bg text-sm" />
          </div>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Paste the full job description here…" rows={8} className="w-full px-3 py-2 rounded border border-border bg-bg text-sm" />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-3 py-2 rounded border border-border text-sm">Cancel</button>
            <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded bg-accent text-white text-sm disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Save job
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
