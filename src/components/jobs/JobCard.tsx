'use client';
import { useState } from 'react';
import {
  Sparkles, Loader2, Download, ExternalLink, ChevronDown, ChevronRight,
  CheckCircle2, AlertTriangle, FileText, Wand2, Mail, Copy, Check,
} from 'lucide-react';
import { ALL_STATUSES, STATUS_COLORS, statusLabel } from '@/lib/jobs/status';
import type { Listing, Resume, Tweak, Analysis } from './types';

const fmtK = (n: number) => `$${Math.round(n / 1000)}k`;
function comp(min: number | null, max: number | null): string | null {
  if (!min && !max) return null;
  if (min && max) return `${fmtK(min)}–${fmtK(max)}`;
  return fmtK((min || max)!);
}

export function JobCard({
  listing,
  resumes,
  onChanged,
}: {
  listing: Listing;
  resumes: Resume[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [tailoring, setTailoring] = useState(false);
  const [err, setErr] = useState('');

  const analysis = listing.analysis;
  const app = listing.application;

  // Tailoring state — which tweaks are approved + the chosen base resume.
  const [approved, setApproved] = useState<Set<number>>(
    () => new Set(analysis ? analysis.suggestedTweaks.map((_, i) => i) : []),
  );
  const [resumeId, setResumeId] = useState<string>(
    analysis?.recommendedResumeId || app?.resumeId || resumes[0]?.id || '',
  );
  const [tailorResult, setTailorResult] = useState<{ url: string; applied: number; unmatched: Tweak[]; recruiterMessage: string | null } | null>(null);

  const analyze = async () => {
    setErr(''); setAnalyzing(true);
    try {
      const r = await fetch(`/api/jobs/${listing.id}/analyze`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Analysis failed');
      const a: Analysis = d.analysis;
      setApproved(new Set(a.suggestedTweaks.map((_, i) => i)));
      setResumeId(a.recommendedResumeId || resumes[0]?.id || '');
      onChanged();
    } catch (e: any) { setErr(e.message); }
    finally { setAnalyzing(false); }
  };

  const tailor = async () => {
    if (!analysis || !resumeId) return;
    setErr(''); setTailoring(true);
    try {
      const tweaks = analysis.suggestedTweaks
        .filter((_, i) => approved.has(i))
        .map((t) => ({ original: t.original, rewrite: t.rewrite }));
      const r = await fetch(`/api/jobs/${listing.id}/tailor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeId, tweaks }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Tailoring failed');
      setTailorResult({ url: d.downloadUrl, applied: d.applied, unmatched: d.unmatched ?? [], recruiterMessage: d.recruiterMessage ?? null });
      onChanged();
    } catch (e: any) { setErr(e.message); }
    finally { setTailoring(false); }
  };

  const markApplied = async () => {
    await fetch(`/api/jobs/${listing.id}/apply`, { method: 'POST' });
    onChanged();
  };

  const compStr = comp(listing.compMin, listing.compMax);

  return (
    <div className="border border-border rounded-lg bg-surface">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        {open ? <ChevronDown size={16} className="text-muted shrink-0" /> : <ChevronRight size={16} className="text-muted shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{listing.title}</div>
          <div className="text-xs text-muted truncate">
            {listing.company}
            {listing.remote && ' · Remote'}
            {compStr && ` · ${compStr}`}
            {listing.field && ` · ${listing.field}`}
          </div>
        </div>
        {analysis && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent shrink-0" title="Best resume fit score">
            {Math.max(0, ...analysis.scores.map((s) => s.score))}% fit
          </span>
        )}
        {app && (
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[app.status as keyof typeof STATUS_COLORS] ?? ''}`}>
            {statusLabel(app.status)}
          </span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-border pt-3 space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <a href={listing.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              <ExternalLink size={12} /> Listing
            </a>
            {listing.applyUrl && (
              <a href={listing.applyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                <ExternalLink size={12} /> Apply page
              </a>
            )}
          </div>

          {/* Step 1: analyze */}
          {!analysis ? (
            <button
              onClick={analyze}
              disabled={analyzing || resumes.length === 0}
              className="inline-flex items-center gap-2 px-3 py-2 rounded bg-accent text-white text-sm disabled:opacity-50"
            >
              {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {resumes.length === 0 ? 'Upload a resume first' : 'Analyze fit'}
            </button>
          ) : (
            <div className="space-y-4">
              {/* Scores */}
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted uppercase tracking-wide">Resume fit</div>
                {analysis.scores.map((s) => (
                  <div key={s.resumeId} className="flex items-center gap-2 text-sm">
                    <div className="w-28 truncate">{s.label}</div>
                    <div className="flex-1 h-2 rounded bg-bg overflow-hidden">
                      <div className="h-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, s.score))}%` }} />
                    </div>
                    <div className="w-10 text-right text-xs text-muted">{s.score}%</div>
                  </div>
                ))}
              </div>

              {/* Keywords + gaps */}
              {analysis.keywords.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted uppercase tracking-wide mb-1">ATS keywords</div>
                  <div className="flex flex-wrap gap-1">
                    {analysis.keywords.map((k) => (
                      <span key={k} className="text-xs px-1.5 py-0.5 rounded bg-bg border border-border">{k}</span>
                    ))}
                  </div>
                </div>
              )}
              {analysis.gaps && analysis.gaps.length > 0 && (
                <div className="text-sm">
                  <div className="text-xs font-medium text-amber-600 uppercase tracking-wide mb-1 flex items-center gap-1">
                    <AlertTriangle size={12} /> Gaps (not on any resume)
                  </div>
                  <ul className="list-disc pl-5 text-muted space-y-0.5">
                    {analysis.gaps.map((g, i) => <li key={i}>{g}</li>)}
                  </ul>
                </div>
              )}

              {/* Tweaks — approve before tailoring */}
              {analysis.suggestedTweaks.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
                    Suggested tweaks (approve each — truthful rewordings only)
                  </div>
                  <div className="space-y-2">
                    {analysis.suggestedTweaks.map((t, i) => (
                      <label key={i} className="flex gap-2 text-sm border border-border rounded p-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={approved.has(i)}
                          onChange={(e) => setApproved((prev) => {
                            const n = new Set(prev);
                            if (e.target.checked) n.add(i); else n.delete(i);
                            return n;
                          })}
                          className="mt-1"
                        />
                        <div className="min-w-0">
                          <div className="text-muted line-through truncate">{t.original}</div>
                          <div className="text-text">{t.rewrite}</div>
                          <div className="text-xs text-muted mt-0.5">{t.reason}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {analysis.atsNotes && <p className="text-xs text-muted italic">{analysis.atsNotes}</p>}

              {/* Step 2: tailor */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={resumeId}
                  onChange={(e) => setResumeId(e.target.value)}
                  className="px-2 py-1.5 rounded border border-border bg-bg text-sm"
                >
                  {resumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}{r.id === analysis.recommendedResumeId ? ' (recommended)' : ''}
                    </option>
                  ))}
                </select>
                <button
                  onClick={tailor}
                  disabled={tailoring || !resumeId}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-accent text-white text-sm disabled:opacity-50"
                >
                  {tailoring ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                  Tailor &amp; save
                </button>
                <button onClick={analyze} disabled={analyzing} className="text-xs text-muted hover:text-text">
                  {analyzing ? 'Re-analyzing…' : 'Re-analyze'}
                </button>
              </div>

              {tailorResult && (
                <div className="text-sm border border-border rounded p-3 bg-bg space-y-2">
                  <div className="flex items-center gap-2 text-emerald-600">
                    <CheckCircle2 size={14} /> Applied {tailorResult.applied} tweak{tailorResult.applied === 1 ? '' : 's'}.
                  </div>
                  {tailorResult.unmatched.length > 0 && (
                    <div className="text-xs text-amber-600">
                      {tailorResult.unmatched.length} tweak(s) couldn&apos;t be located in the .docx and were skipped.
                    </div>
                  )}
                  <a href={tailorResult.url} className="inline-flex items-center gap-1 text-accent hover:underline">
                    <Download size={14} /> Download tailored resume
                  </a>
                </div>
              )}

              {/* Recruiter outreach message — generated alongside the resume */}
              {(tailorResult?.recruiterMessage ?? app?.recruiterMessage) && (
                <RecruiterMessage text={(tailorResult?.recruiterMessage ?? app?.recruiterMessage)!} />
              )}
            </div>
          )}

          {err && <p className="text-sm text-red-600">{err}</p>}

          {/* Tracker controls */}
          {app ? (
            <TrackerControls app={app} onChanged={onChanged} />
          ) : (
            <button
              onClick={markApplied}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-border text-sm hover:border-accent"
            >
              <FileText size={14} /> Mark as applied
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RecruiterMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — user can select manually */ }
  };
  return (
    <div className="border border-border rounded p-3 bg-bg space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted uppercase tracking-wide flex items-center gap-1">
          <Mail size={12} /> Recruiter outreach message
        </div>
        <button onClick={copy} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="text-sm whitespace-pre-wrap">{text}</p>
    </div>
  );
}

function TrackerControls({ app, onChanged }: { app: NonNullable<Listing['application']>; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState(app.notes ?? '');
  const [field, setField] = useState(app.field ?? '');
  const [compMin, setCompMin] = useState(app.compOfferMin?.toString() ?? '');
  const [compMax, setCompMax] = useState(app.compOfferMax?.toString() ?? '');

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true);
    await fetch(`/api/applications/${app.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    onChanged();
  };

  return (
    <div className="border-t border-border pt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={app.status}
          onChange={(e) => patch({ status: e.target.value })}
          className={`px-2 py-1 rounded-full text-xs ${STATUS_COLORS[app.status as keyof typeof STATUS_COLORS] ?? ''}`}
        >
          {ALL_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
        <input
          value={field}
          onChange={(e) => setField(e.target.value)}
          onBlur={() => field !== (app.field ?? '') && patch({ field: field || null })}
          placeholder="Field"
          className="px-2 py-1 rounded border border-border bg-bg text-xs w-28"
        />
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted">Offer $</span>
          <input
            value={compMin}
            onChange={(e) => setCompMin(e.target.value.replace(/\D/g, ''))}
            onBlur={() => patch({ compOfferMin: compMin ? Number(compMin) : null })}
            placeholder="min"
            className="px-2 py-1 rounded border border-border bg-bg w-20"
          />
          <span className="text-muted">–</span>
          <input
            value={compMax}
            onChange={(e) => setCompMax(e.target.value.replace(/\D/g, ''))}
            onBlur={() => patch({ compOfferMax: compMax ? Number(compMax) : null })}
            placeholder="max"
            className="px-2 py-1 rounded border border-border bg-bg w-20"
          />
        </div>
        {saving && <Loader2 size={12} className="animate-spin text-muted" />}
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== (app.notes ?? '') && patch({ notes: notes || null })}
        placeholder="Notes (recruiter name, next step, interview feedback…)"
        rows={2}
        className="w-full px-2 py-1.5 rounded border border-border bg-bg text-sm"
      />

      {app.events.length > 0 && (
        <div className="text-xs text-muted space-y-0.5">
          {app.events.map((ev) => (
            <div key={ev.id} className="flex gap-2">
              <span className="shrink-0">{new Date(ev.createdAt).toLocaleDateString()}</span>
              <span>
                {ev.fromStatus ? `${statusLabel(ev.fromStatus)} → ` : ''}{statusLabel(ev.toStatus)}
                {ev.note ? ` · ${ev.note}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
