'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/feedback';
import { chime, primeAudio } from './pomodoroAudio';
import {
  DEFAULT_SETTINGS, INITIAL_STATE, KEYS, MODE_LABELS, advance, appendLog, formatTime,
  loadJson, migrateLegacyState, nextModeAfter, parseLog, parseSettings, parseState,
  saveJson, timeLeftOf, todaySummary,
  type LogEntry, type Mode, type Settings, type TimerState,
} from './pomodoroCore';

type Updater<T> = T | ((prev: T) => T);

function useStored<T>(
  key: string,
  fallback: T,
  parse: (raw: unknown) => T | null,
  legacy?: () => T | null,
): [T, (next: Updater<T>) => void, boolean] {
  const [value, setValue] = useState<T>(fallback);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = loadJson(key, parse) ?? legacy?.() ?? null;
    if (stored != null) setValue(stored);
    setHydrated(true);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = useCallback((next: Updater<T>) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      saveJson(key, resolved);
      return resolved;
    });
  }, [key]);

  return [value, set, hydrated];
}

function useClock(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active]);
  return now;
}

function useTabTitle(running: boolean, timeLeft: number, mode: Mode) {
  const original = useRef<string | null>(null);
  useEffect(() => {
    if (!running) return;
    if (original.current == null) original.current = document.title;
    document.title = `${formatTime(timeLeft)} · ${MODE_LABELS[mode]}`;
  }, [running, timeLeft, mode]);
  useEffect(() => {
    if (running || original.current == null) return;
    document.title = original.current;
    original.current = null;
  }, [running]);
}

function requestNotifications() {
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

function announce(entry: LogEntry, sound: boolean) {
  const title = `${MODE_LABELS[entry.mode]} complete`;
  toast.success(entry.label && entry.mode === 'work' ? `${title}: ${entry.label}` : title);
  if (sound) chime();
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { icon: '/icons/icon-192.png', body: entry.label || undefined });
  }
}

export function usePomodoro() {
  const [settings, setSettings] = useStored<Settings>(KEYS.settings, DEFAULT_SETTINGS, parseSettings);
  const [log, setLog] = useStored<LogEntry[]>(KEYS.log, [], parseLog);
  const [state, setState, hydrated] = useStored<TimerState>(KEYS.state, INITIAL_STATE, parseState, migrateLegacyState);

  const isRunning = state.endsAt != null;
  const now = useClock(isRunning);
  const timeLeft = timeLeftOf(state, settings, now);
  useTabTitle(isRunning, timeLeft, state.mode);

  useEffect(() => {
    if (!hydrated || !isRunning || timeLeft > 0) return;
    const { state: next, entry } = advance(state, settings, Date.now());
    setState(next);
    setLog((prev) => appendLog(prev, entry));
    announce(entry, settings.sound);
  }, [hydrated, isRunning, timeLeft, state, settings, setState, setLog]);

  const patch = (p: Partial<TimerState>) => setState((prev) => ({ ...prev, ...p }));
  const stopped = { endsAt: null, pausedRemaining: null };

  return {
    settings,
    setSettings,
    state,
    timeLeft,
    isRunning,
    total: settings[state.mode] * 60,
    today: todaySummary(log, now),
    start: () => {
      primeAudio();
      requestNotifications();
      patch({ endsAt: Date.now() + timeLeft * 1000, pausedRemaining: null });
    },
    pause: () => patch({ endsAt: null, pausedRemaining: timeLeft }),
    reset: () => patch(stopped),
    skip: () => patch({ ...stopped, ...nextModeAfter(state.mode, state.sessionCount, settings) }),
    switchMode: (mode: Mode) => patch({ ...stopped, mode }),
    setLabel: (label: string) => patch({ label }),
    restartCycle: () => patch({ ...stopped, mode: 'work', sessionCount: 0 }),
  };
}

export type Pomodoro = ReturnType<typeof usePomodoro>;
