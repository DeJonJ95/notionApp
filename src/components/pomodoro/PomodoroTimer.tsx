'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

type Mode = 'work' | 'shortBreak' | 'longBreak';

const DURATIONS: Record<Mode, number> = {
  work: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
};

const MODE_LABELS: Record<Mode, string> = {
  work: 'Focus',
  shortBreak: 'Short Break',
  longBreak: 'Long Break',
};

const SESSIONS_BEFORE_LONG_BREAK = 4;

const LS_ENDS_AT = 'pomodoro-endsAt';
const LS_MODE = 'pomodoro-mode';
const LS_SESSION_COUNT = 'pomodoro-sessionCount';
const LS_PAUSED_REMAINING = 'pomodoro-pausedRemaining';

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function readLS() {
  if (typeof window === 'undefined') return null;
  try {
    const endsAt = localStorage.getItem(LS_ENDS_AT);
    const mode = (localStorage.getItem(LS_MODE) as Mode) || 'work';
    const sessionCount = parseInt(localStorage.getItem(LS_SESSION_COUNT) || '0', 10);
    const pausedRemaining = localStorage.getItem(LS_PAUSED_REMAINING);
    return {
      endsAt: endsAt ? parseInt(endsAt, 10) : null,
      mode,
      sessionCount,
      pausedRemaining: pausedRemaining ? parseInt(pausedRemaining, 10) : null,
    };
  } catch {
    return null;
  }
}

function writeLS(patch: {
  endsAt?: number | null;
  mode?: Mode;
  sessionCount?: number;
  pausedRemaining?: number | null;
}) {
  if (typeof window === 'undefined') return;
  try {
    if ('endsAt' in patch) {
      if (patch.endsAt == null) localStorage.removeItem(LS_ENDS_AT);
      else localStorage.setItem(LS_ENDS_AT, String(patch.endsAt));
    }
    if (patch.mode != null) localStorage.setItem(LS_MODE, patch.mode);
    if (patch.sessionCount != null) localStorage.setItem(LS_SESSION_COUNT, String(patch.sessionCount));
    if ('pausedRemaining' in patch) {
      if (patch.pausedRemaining == null) localStorage.removeItem(LS_PAUSED_REMAINING);
      else localStorage.setItem(LS_PAUSED_REMAINING, String(patch.pausedRemaining));
    }
  } catch {}
}

export function PomodoroTimer() {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('work');
  const [timeLeft, setTimeLeft] = useState(DURATIONS.work);
  // true = actively counting down toward endsAt; false = paused or not started
  const [isRunning, setIsRunning] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Wall-clock deadline — source of truth when running
  const endsAtRef = useRef<number | null>(null);

  const totalTime = DURATIONS[mode];
  const progress = (totalTime - timeLeft) / totalTime;

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const notify = useCallback((title: string) => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { icon: '/icons/icon-192.png' });
    }
  }, []);

  // Compute next mode after a session completes
  const nextModeAfter = useCallback((currentMode: Mode, currentSessionCount: number): { mode: Mode; sessionCount: number } => {
    if (currentMode === 'work') {
      const newCount = currentSessionCount + 1;
      const next: Mode = newCount % SESSIONS_BEFORE_LONG_BREAK === 0 ? 'longBreak' : 'shortBreak';
      return { mode: next, sessionCount: newCount };
    }
    return { mode: 'work', sessionCount: currentSessionCount };
  }, []);

  // Complete the current session: notify, advance mode, persist
  const completeSession = useCallback((currentMode: Mode, currentSessionCount: number) => {
    const label = MODE_LABELS[currentMode];
    const { mode: nextMode, sessionCount: nextCount } = nextModeAfter(currentMode, currentSessionCount);
    notify(`${label} complete!`);
    setMode(nextMode);
    setSessionCount(nextCount);
    setTimeLeft(DURATIONS[nextMode]);
    setIsRunning(false);
    endsAtRef.current = null;
    writeLS({ endsAt: null, mode: nextMode, sessionCount: nextCount, pausedRemaining: null });
  }, [notify, nextModeAfter]);

  // Recompute timeLeft from the wall-clock deadline; complete if past
  const syncFromDeadline = useCallback((currentMode: Mode, currentSessionCount: number) => {
    const ea = endsAtRef.current;
    if (ea == null) return;
    const remaining = Math.round((ea - Date.now()) / 1000);
    if (remaining <= 0) {
      clearTimer();
      completeSession(currentMode, currentSessionCount);
    } else {
      setTimeLeft(remaining);
    }
  }, [clearTimer, completeSession]);

  // Bootstrap from localStorage on mount
  useEffect(() => {
    const saved = readLS();
    if (!saved) return;
    const { endsAt, mode: savedMode, sessionCount: savedCount, pausedRemaining } = saved;
    setMode(savedMode);
    setSessionCount(savedCount);

    if (endsAt != null) {
      const remaining = Math.round((endsAt - Date.now()) / 1000);
      if (remaining <= 0) {
        // Completed while we were away — advance without user seeing it tick
        const { mode: nextMode, sessionCount: nextCount } = nextModeAfter(savedMode, savedCount);
        notify(`${MODE_LABELS[savedMode]} complete!`);
        setMode(nextMode);
        setSessionCount(nextCount);
        setTimeLeft(DURATIONS[nextMode]);
        writeLS({ endsAt: null, mode: nextMode, sessionCount: nextCount, pausedRemaining: null });
      } else {
        endsAtRef.current = endsAt;
        setTimeLeft(remaining);
        setIsRunning(true);
      }
    } else if (pausedRemaining != null) {
      setTimeLeft(pausedRemaining);
    } else {
      setTimeLeft(DURATIONS[savedMode]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Display tick — cosmetic only; source of truth is endsAtRef
  useEffect(() => {
    clearTimer();
    if (!isRunning) return;
    intervalRef.current = setInterval(() => {
      syncFromDeadline(mode, sessionCount);
    }, 1000);
    return clearTimer;
  }, [isRunning, clearTimer, syncFromDeadline, mode, sessionCount]);

  // Catch-up when tab/app becomes visible again (handles iOS background throttle)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && isRunning) {
        syncFromDeadline(mode, sessionCount);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isRunning, syncFromDeadline, mode, sessionCount]);

  const handleStart = () => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    const ea = Date.now() + timeLeft * 1000;
    endsAtRef.current = ea;
    writeLS({ endsAt: ea, pausedRemaining: null });
    setIsRunning(true);
  };

  const handlePause = () => {
    clearTimer();
    setIsRunning(false);
    endsAtRef.current = null;
    writeLS({ endsAt: null, pausedRemaining: timeLeft });
  };

  const handleReset = () => {
    clearTimer();
    setIsRunning(false);
    endsAtRef.current = null;
    setTimeLeft(DURATIONS[mode]);
    writeLS({ endsAt: null, pausedRemaining: null });
  };

  const handleSkip = () => {
    clearTimer();
    endsAtRef.current = null;
    const { mode: nextMode, sessionCount: nextCount } = nextModeAfter(mode, sessionCount);
    setMode(nextMode);
    setSessionCount(nextCount);
    setTimeLeft(DURATIONS[nextMode]);
    setIsRunning(false);
    writeLS({ endsAt: null, mode: nextMode, sessionCount: nextCount, pausedRemaining: null });
  };

  const currentSession = (sessionCount % SESSIONS_BEFORE_LONG_BREAK) + 1;

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 flex items-center justify-center w-14 h-14 rounded-full bg-accent text-white shadow-lg hover:opacity-90 transition"
        aria-label="Pomodoro timer"
      >
        {isRunning ? (
          <span className="text-xs font-mono font-bold">{formatTime(timeLeft)}</span>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        )}
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-72 rounded-xl border border-border bg-surface shadow-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              {MODE_LABELS[mode]}
            </span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-muted hover:text-foreground text-lg leading-none"
              aria-label="Close"
            >
              &times;
            </button>
          </div>

          {/* Progress ring */}
          <div className="flex justify-center mb-4">
            <div className="relative w-36 h-36">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" className="text-border" strokeWidth="6" />
                <circle
                  cx="60" cy="60" r="52"
                  fill="none"
                  stroke="currentColor"
                  className="text-accent"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 52}
                  strokeDashoffset={2 * Math.PI * 52 * (1 - progress)}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-3xl font-mono font-bold">{formatTime(timeLeft)}</span>
              </div>
            </div>
          </div>

          {/* Session counter */}
          <p className="text-center text-xs text-muted mb-4">
            Session {currentSession} of {SESSIONS_BEFORE_LONG_BREAK}
          </p>

          {/* Controls */}
          <div className="flex items-center justify-center gap-2">
            {isRunning ? (
              <button
                onClick={handlePause}
                className="px-4 py-2 rounded-lg bg-accent/10 text-accent text-sm font-medium hover:bg-accent/20 transition"
              >
                Pause
              </button>
            ) : (
              <button
                onClick={handleStart}
                className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 transition"
              >
                {timeLeft < DURATIONS[mode] ? 'Resume' : 'Start'}
              </button>
            )}
            <button
              onClick={handleReset}
              className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-surface transition"
            >
              Reset
            </button>
            <button
              onClick={handleSkip}
              className="px-4 py-2 rounded-lg border border-border text-sm text-muted hover:bg-surface transition"
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </>
  );
}
