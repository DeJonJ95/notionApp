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

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function PomodoroTimer() {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('work');
  const [timeLeft, setTimeLeft] = useState(DURATIONS.work);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalTime = DURATIONS[mode];
  const progress = (totalTime - timeLeft) / totalTime;

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const advanceMode = useCallback(() => {
    if (mode === 'work') {
      const next = (sessionCount + 1) % SESSIONS_BEFORE_LONG_BREAK === 0
        ? 'longBreak' : 'shortBreak';
      setSessionCount((c) => c + 1);
      setMode(next);
      setTimeLeft(DURATIONS[next]);
    } else {
      setMode('work');
      setTimeLeft(DURATIONS.work);
    }
    setIsRunning(false);
  }, [mode, sessionCount]);

  const notify = useCallback((title: string) => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title);
    }
  }, []);

  useEffect(() => {
    clearTimer();
    if (!isRunning) return;

    intervalRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearTimer();
          const label = MODE_LABELS[mode];
          notify(`${label} complete!`);
          setTimeout(advanceMode, 0);
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return clearTimer;
  }, [isRunning, clearTimer, advanceMode, mode, notify]);

  const handleStart = () => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    setIsRunning(true);
  };

  const handleReset = () => {
    setIsRunning(false);
    setTimeLeft(DURATIONS[mode]);
  };

  const handleSkip = () => {
    setIsRunning(false);
    advanceMode();
  };

  const currentSession = Math.floor(sessionCount % SESSIONS_BEFORE_LONG_BREAK) + 1;

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
                onClick={() => setIsRunning(false)}
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
