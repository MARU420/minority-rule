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
    return ctx.state === "running" ? ctx : null;
  } catch {
    return null;
  }
}

/** Browsers suspend AudioContext until a user gesture — unlock on first tap/key. */
function unlock() {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* audio unsupported */
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
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
    tone(660, 60, "square", 0.1);
  },  vote() {
    tone(220, 120, "sawtooth", 0.14, 0, 440);
  },
  tick() {
    tone(880, 50, "square", 0.09);
  },
  countdown() {
    tone(990, 90, "square", 0.12);
  },
  revealDrum() {
    for (let i = 0; i < 5; i++) tone(140 + i * 30, 120, "sawtooth", 0.14, i * 0.16);
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 180, "triangle", 0.16, i * 0.12));
  },
  lose() {
    tone(220, 400, "sawtooth", 0.14, 0, 110);
  },
  round() {
    tone(392, 120, "triangle", 0.1);
    tone(523, 160, "triangle", 0.1, 0.12);
  },
};

/* ---------- procedural background music (no assets) ---------- */
let bgmTimer: number | null = null;

// dark pulse: A-minor bass + sparse lead. Menu = slow/sparse, match = driving.
const BASS = [55, 0, 55, 0, 65.41, 0, 55, 0, 49, 0, 49, 0, 58.27, 0, 73.42, 82.41];
const LEAD_MENU = [440, 0, 0, 0, 523.25, 0, 0, 0, 392, 0, 0, 0, 329.63, 0, 392, 0];
const LEAD_MATCH = [440, 0, 523.25, 0, 392, 0, 440, 0, 523.25, 0, 659.25, 0, 587.33, 523.25, 392, 329.63];

export function startBgm(kind: "menu" | "match") {
  stopBgm();
  const stepMs = kind === "menu" ? 230 : 170;
  const lead = kind === "menu" ? LEAD_MENU : LEAD_MATCH;
  let step = 0;
  bgmTimer = window.setInterval(() => {
    if (muted) return;
    const i = step++ % 16;
    if (BASS[i]) tone(BASS[i], stepMs * 0.9, "triangle", 0.08);
    if (lead[i]) tone(lead[i], stepMs * 1.4, "sine", 0.05);
    if (kind === "match" && step % 4 === 1) tone(110, 50, "square", 0.028);
  }, stepMs);
}

export function stopBgm() {
  if (bgmTimer !== null) {
    clearInterval(bgmTimer);
    bgmTimer = null;
  }
}
