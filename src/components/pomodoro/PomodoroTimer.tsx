'use client';
import { useState } from 'react';
import { Timer } from 'lucide-react';
import { PomodoroPanel } from './PomodoroPanel';
import { formatTime } from './pomodoroCore';
import { usePomodoro } from './usePomodoro';

export function PomodoroTimer() {
  const [isOpen, setIsOpen] = useState(false);
  const p = usePomodoro();
  const onBreak = p.state.mode !== 'work';

  return (
    <>
      <button
        onClick={() => setIsOpen((o) => !o)}
        aria-label="Pomodoro timer"
        className={`fixed bottom-6 right-6 z-50 flex items-center justify-center w-14 h-14 rounded-full text-white shadow-lg hover:opacity-90 transition ${
          onBreak ? 'bg-emerald-500' : 'bg-accent'
        }`}
      >
        {p.isRunning ? (
          <span className="text-xs font-mono font-bold">{formatTime(p.timeLeft)}</span>
        ) : (
          <Timer size={24} />
        )}
      </button>
      {isOpen && <PomodoroPanel p={p} onClose={() => setIsOpen(false)} />}
    </>
  );
}
