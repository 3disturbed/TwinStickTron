// WebAudio synth — zero asset files. Kill sounds climb a pentatonic run
// inside a combo window (the Peggle rule, SDD §2.10).

let ctx = null, master = null, desiredVol = 0.25;

export function ensureAudio() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = desiredVol;
    master.connect(ctx.destination);
  } catch { ctx = null; }
}

export function setVolume(v) {
  desiredVol = v;
  if (master) master.gain.value = v;
}

function blip(freq, dur, type = "square", vol = 1, slide = 0) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol * 0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, vol = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = vol * 0.4;
  src.connect(g); g.connect(master);
  src.start(t);
}

// pentatonic kill ladder
const LADDER = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
let comboIdx = 0, lastKillAt = 0;

export const sfx = {
  shoot() { blip(880, 0.05, "square", 0.25, -300); },
  kill() {
    const now = performance.now();
    if (now - lastKillAt > 1600) comboIdx = 0;
    lastKillAt = now;
    const semi = LADDER[Math.min(comboIdx++, LADDER.length - 1)];
    blip(330 * Math.pow(2, semi / 12), 0.14, "triangle", 0.9);
    noise(0.06, 0.3);
  },
  hurt() { blip(140, 0.25, "sawtooth", 1, -60); noise(0.15, 0.8); },
  dash() { blip(520, 0.09, "sine", 0.5, 500); },
  bomb() { noise(0.6, 1); blip(60, 0.5, "sine", 1, -20); },
  ability() { blip(660, 0.2, "sine", 0.6, 300); },
  down() { blip(220, 0.6, "sawtooth", 0.9, -160); },
  revive() { blip(440, 0.3, "sine", 0.8, 220); },
  wave() { blip(392, 0.12, "square", 0.5); setTimeout(() => blip(523, 0.16, "square", 0.5), 130); },
  boss() { blip(98, 0.7, "sawtooth", 1, 30); setTimeout(() => blip(98, 0.7, "sawtooth", 1, 30), 400); },
  bank() { blip(784, 0.08, "sine", 0.6); setTimeout(() => blip(1046, 0.12, "sine", 0.6), 90); },
  pick() { blip(523, 0.1, "triangle", 0.5); },
  pickup() { blip(880, 0.07, "sine", 0.5); setTimeout(() => blip(1320, 0.09, "sine", 0.5), 70); },
  use() { blip(660, 0.12, "triangle", 0.7, 400); noise(0.08, 0.3); },
  // class-weapon voices
  smg() { blip(980, 0.03, "square", 0.18, -200); },
  boom() { noise(0.22, 0.9); blip(120, 0.18, "sawtooth", 0.8, -60); },
  swing() { noise(0.12, 0.5); blip(240, 0.14, "sine", 0.5, 240); },
  lance() { blip(700, 0.08, "triangle", 0.4, -350); },
  rail() { blip(180, 0.22, "sawtooth", 0.9, 900); noise(0.1, 0.4); },
  arc() { blip(1200, 0.05, "square", 0.3, -500); },
  zap() { blip(1500, 0.06, "square", 0.5, -900); },
  freeze() { blip(1800, 0.3, "sine", 0.6, -1200); },
  warp() { blip(300, 0.2, "sine", 0.7, 800); setTimeout(() => blip(900, 0.15, "sine", 0.5, -400), 120); },
  buy() { blip(1046, 0.08, "sine", 0.6); setTimeout(() => blip(1568, 0.14, "sine", 0.6), 90); },
  over() { blip(196, 0.5, "sawtooth", 0.9, -80); setTimeout(() => blip(147, 0.8, "sawtooth", 0.9, -50), 350); },
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.25, "triangle", 0.8), i * 140)); },
};
