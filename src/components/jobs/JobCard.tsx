'use client';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { STATUS_COLORS, statusLabel } from '@/lib/jobs/status';
import { MatchBadge, MatchReason } from './MatchBadge';
import { JobDetail } from './JobDetail';
import type { Listing, Resume } from './types';

const fmtK = (n: number) => `$${Math.round(n / 1000)}k`;

function comp(min: number | null, max: number | null): string | null {
  if (!min && !max) return null;
  if (min && max) return `${fmtK(min)}–${fmtK(max)}`;
  return fmtK((min || max)!);
}

export function JobCard({ listing, resumes, onChanged }: { listing: Listing; resumes: Resume[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const app = listing.application;
  const meta = [listing.remote && 'Remote', comp(listing.compMin, listing.compMax), listing.field].filter(Boolean);

  return (
    <div className="border border-border rounded-lg bg-surface">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        {open ? <ChevronDown size={16} className="text-muted shrink-0" /> : <ChevronRight size={16} className="text-muted shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{listing.title}</div>
          <div className="text-xs text-muted truncate">{[listing.company, ...meta].join(' · ')}</div>
          <MatchReason match={listing.match} />
        </div>
        <MatchBadge listing={listing} />
        {app && (
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[app.status as keyof typeof STATUS_COLORS] ?? ''}`}>
            {statusLabel(app.status)}
          </span>
        )}
      </button>
      {open && <JobDetail listing={listing} resumes={resumes} onChanged={onChanged} />}
    </div>
  );
}
