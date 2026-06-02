// Client-side shapes mirroring the ApplyKit API responses. Kept loose (the
// JSON columns come back as `any`) but typed enough for the UI.

export type Resume = { id: string; label: string; r2Key: string; createdAt: string };

export type Tweak = { resumeId?: string; original: string; rewrite: string; reason: string };

export type Score = { resumeId: string; label: string; score: number; rationale: string };

export type Analysis = {
  id: string;
  listingId: string;
  keywords: string[];
  requirements: string[];
  recommendedResumeId: string | null;
  scores: Score[];
  suggestedTweaks: Tweak[];
  gaps: string[] | null;
  atsNotes: string | null;
};

export type AppEvent = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: string;
};

export type Application = {
  id: string;
  status: string;
  field: string | null;
  resumeId: string | null;
  tailoredR2Key: string | null;
  compOfferMin: number | null;
  compOfferMax: number | null;
  notes: string | null;
  appliedAt: string | null;
  events: AppEvent[];
};

export type Listing = {
  id: string;
  sourceUrl: string;
  applyUrl: string | null;
  company: string;
  title: string;
  location: string | null;
  remote: boolean;
  description: string;
  compMin: number | null;
  compMax: number | null;
  field: string | null;
  createdAt: string;
  analysis: Analysis | null;
  application: Application | null;
};
