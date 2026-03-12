import { ALL_STATUSES, statusLabel, isActive, statusSchema } from '@/lib/jobs/status';

describe('job status helpers', () => {
  it('labels every status', () => {
    for (const s of ALL_STATUSES) {
      expect(statusLabel(s)).toBeTruthy();
      expect(statusLabel(s)).not.toBe(s);
    }
  });

  it('falls back to the raw value for unknown statuses', () => {
    expect(statusLabel('NOPE')).toBe('NOPE');
  });

  it('treats pipeline-but-not-accepted as active', () => {
    expect(isActive('APPLIED')).toBe(true);
    expect(isActive('INTERVIEW')).toBe(true);
    expect(isActive('ACCEPTED')).toBe(false);
    expect(isActive('REJECTED')).toBe(false);
    expect(isActive('GHOSTED')).toBe(false);
  });

  it('validates known statuses and rejects unknown', () => {
    expect(statusSchema.safeParse('OFFER').success).toBe(true);
    expect(statusSchema.safeParse('banana').success).toBe(false);
  });
});
