'use client';
import { useState } from 'react';
import { RotateCcw, Settings as SettingsIcon, X } from 'lucide-react';
import { PomodoroSettings } from './PomodoroSettings';
import { MODES, MODE_LABELS, formatTime, type Mode } from './pomodoroCore';
import type { Pomodoro } from './usePomodoro';

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const modeColor = (mode: Mode) => (mode === 'work' ? 'text-accent' : 'text-emerald-500');

function ProgressRing({ progress, mode, timeLeft }: { progress: number; mode: Mode; timeLeft: number }) {
  return (
    <div className="relative w-36 h-36 mx-auto">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="currentColor" className="text-border" strokeWidth="6" />
        <circle
          cx="60" cy="60" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round"
          className={modeColor(mode)}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-3xl font-mono font-bold text-text">{formatTime(timeLeft)}</span>
      </div>
    </div>
  );
}

function ModeTabs({ mode, onChange, disabled }: { mode: Mode; onChange: (m: Mode) => void; disabled: boolean }) {
  return (
    <div className="flex rounded-lg border border-border p-0.5 text-xs">
      {MODES.map((m) => (
        <button
          key={m} type="button" disabled={disabled} onClick={() => onChange(m)}
          className={`flex-1 rounded-md px-2 py-1 transition disabled:opacity-60 ${
            m === mode ? 'bg-accent/15 text-text font-medium' : 'text-muted hover:text-text'
          }`}
        >
          {MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

function Controls({ p }: { p: Pomodoro }) {
  const fresh = p.timeLeft === p.total;
  return (
    <div className="flex items-center justify-center gap-2">
      {p.isRunning ? (
        <button onClick={p.pause} className="px-4 py-2 rounded-lg bg-accent/10 text-accent text-sm font-medium hover:bg-accent/20 transition">
          Pause
        </button>
      ) : (
        <button onClick={p.start} className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 transition">
          {fresh ? 'Start' : 'Resume'}
        </button>
      )}
      <button onClick={p.reset} disabled={fresh && !p.isRunning} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-bg transition disabled:opacity-40">
        Reset
      </button>
      <button onClick={p.skip} className="px-4 py-2 rounded-lg border border-border text-sm text-muted hover:bg-bg transition">
        Skip
      </button>
    </div>
  );
}

function TodaySummary({ p }: { p: Pomodoro }) {
  const { sessions, minutes, entries } = p.today;
  const recent = entries.slice(-4).reverse();
  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">Today</span>
        <span className="font-medium text-text">
          {sessions} focus {sessions === 1 ? 'session' : 'sessions'} · {minutes} min
        </span>
      </div>
      {recent.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {recent.map((e) => (
            <li key={e.endedAt} className="flex justify-between gap-2 text-[11px] text-muted">
              <span className="truncate">{e.label || 'Focus'}</span>
              <span className="shrink-0 font-mono">
                {new Date(e.endedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PomodoroPanel({ p, onClose }: { p: Pomodoro; onClose: () => void }) {
  const [showSettings, setShowSettings] = useState(false);
  const { state, settings } = p;
  const cycleLength = settings.sessionsBeforeLongBreak;
  const position = (state.sessionCount % cycleLength) + (state.mode === 'work' ? 1 : 0);

  return (
    <div className="fixed bottom-24 right-6 z-50 w-80 rounded-xl border border-border bg-surface shadow-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold uppercase tracking-wide ${modeColor(state.mode)}`}>
          {MODE_LABELS[state.mode]}
        </span>
        <div className="flex items-center gap-1 text-muted">
          <button onClick={p.restartCycle} title="Restart cycle" aria-label="Restart cycle" className="p-1 hover:text-text">
            <RotateCcw size={14} />
          </button>
          <button onClick={() => setShowSettings((s) => !s)} aria-label="Settings" className={`p-1 hover:text-text ${showSettings ? 'text-text' : ''}`}>
            <SettingsIcon size={14} />
          </button>
          <button onClick={onClose} aria-label="Close" className="p-1 hover:text-text">
            <X size={16} />
          </button>
        </div>
      </div>

      {showSettings ? (
        <PomodoroSettings settings={settings} onChange={p.setSettings} />
      ) : (
        <>
          <ModeTabs mode={state.mode} onChange={p.switchMode} disabled={p.isRunning} />
          <ProgressRing progress={(p.total - p.timeLeft) / p.total} mode={state.mode} timeLeft={p.timeLeft} />
          <input
            value={state.label}
            onChange={(e) => p.setLabel(e.target.value)}
            placeholder="What are you focusing on?"
            maxLength={80}
            className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text placeholder:text-muted/70"
          />
          <p className="text-center text-xs text-muted">
            Session {Math.min(position || cycleLength, cycleLength)} of {cycleLength}
          </p>
          <Controls p={p} />
          <TodaySummary p={p} />
        </>
      )}
    </div>
  );
}
