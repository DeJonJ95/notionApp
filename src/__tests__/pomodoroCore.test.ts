import {
  DEFAULT_SETTINGS, INITIAL_STATE, advance, migrateLegacyState, nextModeAfter,
  parseSettings, timeLeftOf, todaySummary, type LogEntry,
} from '../components/pomodoro/pomodoroCore';

describe('nextModeAfter', () => {
  it('alternates focus and short breaks, with a long break every fourth', () => {
    expect(nextModeAfter('work', 0, DEFAULT_SETTINGS)).toEqual({ mode: 'shortBreak', sessionCount: 1 });
    expect(nextModeAfter('shortBreak', 1, DEFAULT_SETTINGS)).toEqual({ mode: 'work', sessionCount: 1 });
    expect(nextModeAfter('work', 3, DEFAULT_SETTINGS)).toEqual({ mode: 'longBreak', sessionCount: 4 });
  });

  it('honours a custom cycle length', () => {
    expect(nextModeAfter('work', 1, { ...DEFAULT_SETTINGS, sessionsBeforeLongBreak: 2 }).mode).toBe('longBreak');
  });
});

describe('advance', () => {
  const now = Date.parse('2026-09-17T10:00:00');

  it('logs the finished session and stops unless auto-start is on', () => {
    const { state, entry } = advance({ ...INITIAL_STATE, endsAt: now, label: 'Budget' }, DEFAULT_SETTINGS, now);
    expect(entry).toEqual({ endedAt: now, mode: 'work', minutes: 25, label: 'Budget' });
    expect(state.mode).toBe('shortBreak');
    expect(state.endsAt).toBeNull();
    expect(state.label).toBe('Budget');
  });

  it('starts the break immediately when autoStartBreaks is set', () => {
    const settings = { ...DEFAULT_SETTINGS, autoStartBreaks: true };
    const { state } = advance({ ...INITIAL_STATE, endsAt: now }, settings, now);
    expect(state.endsAt).toBe(now + 5 * 60 * 1000);
  });
});

describe('timeLeftOf', () => {
  it('derives from the deadline while running and from the pause otherwise', () => {
    const now = 1_000_000;
    expect(timeLeftOf({ ...INITIAL_STATE, endsAt: now + 90_500 }, DEFAULT_SETTINGS, now)).toBe(91);
    expect(timeLeftOf({ ...INITIAL_STATE, endsAt: now - 5 }, DEFAULT_SETTINGS, now)).toBe(0);
    expect(timeLeftOf({ ...INITIAL_STATE, pausedRemaining: 42 }, DEFAULT_SETTINGS, now)).toBe(42);
    expect(timeLeftOf({ ...INITIAL_STATE, mode: 'longBreak' }, DEFAULT_SETTINGS, now)).toBe(900);
  });
});

describe('parseSettings', () => {
  it('fills gaps with defaults and clamps out-of-range numbers', () => {
    expect(parseSettings({ work: 50, sessionsBeforeLongBreak: 99, sound: false })).toEqual({
      ...DEFAULT_SETTINGS, work: 50, sessionsBeforeLongBreak: 12, sound: false,
    });
    expect(parseSettings({ work: -3 })?.work).toBe(25);
    expect(parseSettings('junk')).toBeNull();
  });
});

describe('todaySummary', () => {
  it('counts only focus sessions that ended today', () => {
    const now = new Date(2026, 8, 17, 15).getTime();
    const log: LogEntry[] = [
      { endedAt: new Date(2026, 8, 17, 9).getTime(), mode: 'work', minutes: 25, label: 'a' },
      { endedAt: new Date(2026, 8, 17, 10).getTime(), mode: 'shortBreak', minutes: 5, label: '' },
      { endedAt: new Date(2026, 8, 16, 23).getTime(), mode: 'work', minutes: 25, label: 'old' },
      { endedAt: new Date(2026, 8, 17, 14).getTime(), mode: 'work', minutes: 50, label: 'b' },
    ];
    const s = todaySummary(log, now);
    expect(s.sessions).toBe(2);
    expect(s.minutes).toBe(75);
    expect(s.entries.map((e) => e.label)).toEqual(['a', 'b']);
  });
});

describe('migrateLegacyState', () => {
  it('reads the old four keys once and removes them', () => {
    localStorage.setItem('pomodoro-mode', 'shortBreak');
    localStorage.setItem('pomodoro-sessionCount', '3');
    localStorage.setItem('pomodoro-endsAt', '123456');
    expect(migrateLegacyState()).toEqual({ mode: 'shortBreak', sessionCount: 3, endsAt: 123456, pausedRemaining: null, label: '' });
    expect(localStorage.getItem('pomodoro-mode')).toBeNull();
    expect(migrateLegacyState()).toBeNull();
  });
});
