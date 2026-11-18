// Notification sounds, synthesised with Web Audio so there is no audio file to load or allow in the CSP.

export type ChimeId = 'mellow' | 'droplet' | 'breeze' | 'glass';
export const CHIMES: ChimeId[] = ['mellow', 'droplet', 'breeze', 'glass'];

interface Note {
  /** Frequency in Hz. */
  f: number;
  /** Start offset in seconds. */
  at: number;
  /** Relative loudness, 0–1. */
  gain: number;
  /** Decay time in seconds. */
  decay: number;
  /** Starts this many times higher and glides down to f. */
  glide?: number;
}

const SONGS: Record<ChimeId, Note[]> = {
  // A rising major sixth, like a soft doorbell.
  mellow: [
    { f: 659.25, at: 0, gain: 0.9, decay: 1.5 },
    { f: 1108.73, at: 0.16, gain: 0.7, decay: 1.9 }
  ],
  // One round drop that settles into its note.
  droplet: [
    { f: 880, at: 0, gain: 0.9, decay: 1.1, glide: 1.18 },
    { f: 1760, at: 0.05, gain: 0.12, decay: 0.5 }
  ],
  // Three airy notes from a pentatonic scale.
  breeze: [
    { f: 587.33, at: 0, gain: 0.6, decay: 1.6 },
    { f: 739.99, at: 0.11, gain: 0.55, decay: 1.6 },
    { f: 880, at: 0.22, gain: 0.6, decay: 2.2 }
  ],
  // A falling fifth, like tapping a glass.
  glass: [
    { f: 1318.51, at: 0, gain: 0.55, decay: 1.2 },
    { f: 880, at: 0.13, gain: 0.75, decay: 2 }
  ]
};

let ctx: AudioContext | undefined;

function context(): AudioContext | undefined {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return undefined;
    ctx = new AC();
  }
  return ctx;
}

// Browsers only let a page make sound after a click or key press, so the first one unlocks the audio
// context. After that, chimes also play while the tab or app window is in the background.
export function unlockAudioOnGesture() {
  const unlock = () => {
    const c = context();
    if (c && c.state === 'suspended') c.resume().catch(() => undefined);
    if (c?.state === 'running') {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    }
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

function bell(c: AudioContext, out: AudioNode, n: Note, t0: number) {
  const start = t0 + n.at;
  const env = c.createGain();
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(n.gain, start + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, start + n.decay);
  env.connect(out);
  // A sine with two quiet overtones gives a soft, rounded bell rather than a beep.
  const partials: [number, number][] = [[1, 1], [2, 0.18], [3.01, 0.06]];
  for (const [mult, level] of partials) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    const f = n.f * mult;
    if (n.glide) {
      osc.frequency.setValueAtTime(f * n.glide, start);
      osc.frequency.exponentialRampToValueAtTime(f, start + 0.07);
    } else osc.frequency.setValueAtTime(f, start);
    g.gain.value = level;
    osc.connect(g).connect(env);
    osc.start(start);
    osc.stop(start + n.decay + 0.05);
  }
}

export async function playChime(id: ChimeId, volume = 0.6): Promise<boolean> {
  const c = context();
  if (!c) return false;
  // Without an earlier click or key press, resume() never settles, so don't wait on it for long.
  if (c.state === 'suspended') await Promise.race([c.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 300))]);
  if (c.state !== 'running') return false;
  const t0 = c.currentTime + 0.02;
  const master = c.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume)) * 0.35;
  const tone = c.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 4200;
  master.connect(tone).connect(c.destination);
  // A short, quiet echo adds a little room around the notes.
  const delay = c.createDelay(1);
  delay.delayTime.value = 0.19;
  const feedback = c.createGain();
  feedback.gain.value = 0.22;
  const wet = c.createGain();
  wet.gain.value = 0.2;
  master.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(wet).connect(tone);
  const notes = SONGS[id] ?? SONGS.mellow;
  notes.forEach((n) => bell(c, master, n, t0));
  const end = Math.max(...notes.map((n) => n.at + n.decay)) + 1.2;
  setTimeout(() => {
    master.disconnect();
    delay.disconnect();
    feedback.disconnect();
    wet.disconnect();
  }, end * 1000);
  return true;
}
