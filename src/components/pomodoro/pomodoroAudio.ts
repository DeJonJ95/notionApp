let ctx: AudioContext | null = null;

// Browsers only let audio start from a user gesture, so the context is
// created on Start and reused when the session ends on its own.
export function primeAudio() {
  try {
    if (typeof window === 'undefined' || !('AudioContext' in window)) return;
    ctx = ctx ?? new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {}
}

export function chime() {
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime;
    [660, 880, 1100].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      const at = t0 + i * 0.18;
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx!.destination);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
      osc.start(at);
      osc.stop(at + 0.45);
    });
  } catch {}
}
