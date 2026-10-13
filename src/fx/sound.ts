/** Tiny WebAudio synth — no audio assets needed. */
let ctx: AudioContext | null = null;
let muted = localStorage.getItem("minority-muted") === "1";

export function isMuted() {
  return muted;
}
export function setMuted(m: boolean) {
  muted = m;
  localStorage.setItem("minority-muted", m ? "1" : "0");
}

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, durMs: number, type: OscillatorType, gain = 0.12, when = 0, slideTo?: number) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + durMs / 1000);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + durMs / 1000 + 0.02);
}

export const sfx = {
  click() {
    tone(660, 60, "square", 0.06);
  },
  vote() {
    tone(220, 120, "sawtooth", 0.1, 0, 440);
  },
  tick() {
    tone(880, 50, "square", 0.05);
  },
  countdown() {
    tone(990, 90, "square", 0.08);
  },
  revealDrum() {
    for (let i = 0; i < 5; i++) tone(140 + i * 30, 120, "sawtooth", 0.1, i * 0.16);
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 180, "triangle", 0.12, i * 0.12));
  },
  lose() {
    tone(220, 400, "sawtooth", 0.1, 0, 110);
  },
  round() {
    tone(392, 120, "triangle", 0.1);
    tone(523, 160, "triangle", 0.1, 0.12);
  },
};
