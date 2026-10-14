'use client';
import { useState, type ReactNode } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Download, Loader2 } from 'lucide-react';
import { downloadFile } from '@/lib/jobs/download';
import { slug } from './api';
import type { AtsReport } from './types';

type Files = { atsUrl: string | null; styledUrl: string | null; name: string };

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <li className="flex items-start gap-2">
      <Icon size={15} className={`mt-0.5 shrink-0 ${ok ? 'text-emerald-600' : 'text-red-600'}`} />
      <span>{children}</span>
    </li>
  );
}

function sectionList(s: AtsReport['sections']): string {
  const missing = (['experience', 'education', 'skills'] as const).filter((k) => !s[k]);
  return missing.length ? `No ${missing.join(' or ')} heading found. ATS file content under standard headings.` : 'Experience, Education and Skills headings found';
}

function Checklist({ report }: { report: AtsReport }) {
  const { matched, missing } = report.keywords;
  const total = matched.length + missing.length;
  return (
    <ul className="space-y-1.5 text-sm">
      {total > 0 && (
        <Check ok={missing.length <= total / 4}>
          <strong>{matched.length} of {total}</strong> job keywords present
          {missing.length > 0 && <>. Still missing: {missing.join(', ')}. Add any you genuinely have; the rest are gaps.</>}
        </Check>
      )}
      <Check ok={report.title.found}>
        {report.title.found ? `The title "${report.title.text}" appears in your resume` : `The title "${report.title.text}" does not appear. Recruiters search by title; use it in your headline if it is accurate.`}
      </Check>
      <Check ok={report.contact.email && report.contact.phone}>
        {report.contact.email && report.contact.phone ? 'Email and phone are in the body text' : 'Email or phone missing from the body text'}
      </Check>
      <Check ok={Object.values(report.sections).every(Boolean)}>{sectionList(report.sections)}</Check>
    </ul>
  );
}

function Downloads({ atsUrl, styledUrl, name }: Files) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const get = async (url: string, suffix: string) => {
    setErr(''); setBusy(suffix);
    try { await downloadFile(url, `${name}${suffix}.docx`); } catch { setErr('Download failed. Try again.'); } finally { setBusy(''); }
  };
  const icon = (s: string) => (busy === s ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {atsUrl && (
        <button onClick={() => get(atsUrl, '-ATS')} disabled={!!busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-white text-sm disabled:opacity-50">
          {icon('-ATS')} ATS-safe resume
        </button>
      )}
      {styledUrl && (
        <button onClick={() => get(styledUrl, '')} disabled={!!busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border text-sm hover:border-accent disabled:opacity-50">
          {icon('')} Styled resume
        </button>
      )}
      {err && <span className="text-sm text-red-600">{err}</span>}
    </div>
  );
}

export function AtsReportView({ report, atsUrl, styledUrl, company, title }: { report: AtsReport | null; atsUrl: string | null; styledUrl: string | null; company: string; title: string }) {
  const name = `${slug(company)}-${slug(title)}`;
  return (
    <section className="border border-border rounded p-3 bg-bg space-y-3">
      <h4 className="text-sm font-semibold">ATS check</h4>
      {report ? <Checklist report={report} /> : <p className="text-sm">Tailor again to run the ATS check and get the ATS-safe version.</p>}
      {report && report.hazards.length > 0 && (
        <div className="text-sm space-y-1">
          <p className="font-medium flex items-center gap-1.5 text-amber-700 dark:text-amber-400"><AlertTriangle size={14} /> Your styled resume has layout an ATS can misread</p>
          <ul className="list-disc pl-5 space-y-0.5">{report.hazards.map((h) => <li key={h.id}>{h.label}</li>)}</ul>
        </div>
      )}
      <p className="text-sm">
        Upload the <strong>ATS-safe</strong> version to application portals: one column, standard headings, contact details in the body. Send the styled one to people.
      </p>
      <Downloads atsUrl={atsUrl} styledUrl={styledUrl} name={name} />
    </section>
  );
}
