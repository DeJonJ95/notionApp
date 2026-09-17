import { act, renderHook } from '@testing-library/react';
import { usePomodoro } from '../components/pomodoro/usePomodoro';

jest.mock('@/components/ui/feedback', () => ({ toast: { success: jest.fn() } }));

describe('usePomodoro', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 8, 17, 9, 0, 0));
    document.title = 'Kove';
  });
  afterEach(() => jest.useRealTimers());

  it('runs a focus session to completion, logs it, and flips to a break', () => {
    const { result } = renderHook(() => usePomodoro());
    act(() => result.current.setSettings({ ...result.current.settings, work: 1 }));
    act(() => result.current.setLabel('Write tests'));
    expect(result.current.timeLeft).toBe(60);

    act(() => result.current.start());
    expect(result.current.isRunning).toBe(true);

    act(() => jest.advanceTimersByTime(30_000));
    expect(result.current.timeLeft).toBe(30);
    expect(document.title).toBe('00:30 · Focus');

    act(() => jest.advanceTimersByTime(31_000));
    expect(result.current.isRunning).toBe(false);
    expect(result.current.state.mode).toBe('shortBreak');
    expect(result.current.today).toMatchObject({ sessions: 1, minutes: 1 });
    expect(result.current.today.entries[0].label).toBe('Write tests');
    expect(document.title).toBe('Kove');
    expect(JSON.parse(localStorage.getItem('pomodoro-log') ?? '[]')).toHaveLength(1);
  });

  it('pauses and resumes from the remaining time', () => {
    const { result } = renderHook(() => usePomodoro());
    act(() => result.current.start());
    act(() => jest.advanceTimersByTime(10_000));
    act(() => result.current.pause());
    act(() => jest.advanceTimersByTime(60_000));
    expect(result.current.timeLeft).toBe(1490);
    act(() => result.current.start());
    act(() => jest.advanceTimersByTime(5_000));
    expect(result.current.timeLeft).toBe(1485);
  });

  it('picks up a deadline that passed while the page was closed', () => {
    localStorage.setItem('pomodoro-state', JSON.stringify({
      mode: 'work', sessionCount: 3, endsAt: Date.now() - 5_000, pausedRemaining: null, label: 'Old',
    }));
    const { result } = renderHook(() => usePomodoro());
    act(() => jest.advanceTimersByTime(0));
    expect(result.current.state.mode).toBe('longBreak');
    expect(result.current.state.sessionCount).toBe(4);
    expect(result.current.today.sessions).toBe(1);
  });
});
