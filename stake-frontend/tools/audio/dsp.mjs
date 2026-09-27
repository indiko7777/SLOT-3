/**
 * Tiny offline DSP toolkit for rendering game audio to files (48 kHz, stereo).
 *
 * Everything is sample-accurate and deterministic (seeded noise), so a render
 * is reproducible. Signals are Float32Array (mono) or [L, R] pairs (stereo).
 * Rendered offline — so unlike realtime Web Audio synthesis we can afford
 * oversampled saturation, proper reverb, multi-layer modal metal, limiting.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const SR = 48000;
const TAU = Math.PI * 2;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(HERE, "../../package.json"));

// ── buffers ────────────────────────────────────────────────────────────────
export const len = (sec) => Math.max(1, Math.round(sec * SR));
export const mono = (sec) => new Float32Array(len(sec));
export const stereo = (sec) => [mono(sec), mono(sec)];

/** Seeded PRNG (mulberry32) so renders are reproducible. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const val = (v, t) => (typeof v === "function" ? v(t) : v);

// ── generators ─────────────────────────────────────────────────────────────
function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/** Oscillator. freq may be a number or fn(tSeconds). type: sine|saw|square|tri|pulse */
export function osc(type, freq, sec, { phase = 0, pw = 0.5 } = {}) {
  const out = mono(sec);
  let ph = phase;
  let tri = 0;
  for (let i = 0; i < out.length; i++) {
    const f = val(freq, i / SR);
    const dt = Math.min(0.49, Math.max(0, f / SR));
    let v;
    switch (type) {
      case "sine": v = Math.sin(TAU * ph); break;
      case "saw": v = 2 * ph - 1 - polyblep(ph, dt); break;
      case "square":
      case "pulse": {
        const w = type === "square" ? 0.5 : pw;
        v = (ph < w ? 1 : -1) + polyblep(ph, dt) - polyblep((ph + 1 - w) % 1, dt);
        break;
      }
      case "tri": {
        const sq = (ph < 0.5 ? 1 : -1) + polyblep(ph, dt) - polyblep((ph + 0.5) % 1, dt);
        tri = dt * sq + (1 - dt) * tri;
        v = tri * 4;
        break;
      }
      default: v = 0;
    }
    out[i] = v;
    ph += dt;
    if (ph >= 1) ph -= 1;
  }
  return out;
}

/** Noise: white | pink | brown. */
export function noise(sec, color = "white", seed = 7) {
  const r = rng(seed);
  const out = mono(sec);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < out.length; i++) {
    const w = r() * 2 - 1;
    if (color === "white") out[i] = w;
    else if (color === "pink") {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      br = (br + 0.02 * w) / 1.02;
      out[i] = br * 3.5;
    }
  }
  return out;
}

/** Sparse random clicks (crackle) — density in clicks/sec, may be fn(t). */
export function crackle(sec, density, seed = 3, { width = 0.0008 } = {}) {
  const r = rng(seed);
  const out = mono(sec);
  const w = Math.max(2, Math.round(width * SR));
  for (let i = 0; i < out.length; i++) {
    if (r() < val(density, i / SR) / SR) {
      const amp = (0.3 + 0.7 * r()) * (r() < 0.5 ? -1 : 1);
      for (let k = 0; k < w && i + k < out.length; k++) out[i + k] += amp * Math.exp(-k / (w * 0.35)) * (k % 2 ? -0.6 : 1);
    }
  }
  return out;
}

/** Damped-sine modal resonator bank: [{f, amp, decay (s)}] + optional detune jitter. */
export function modal(sec, partials, { attack = 0.0015, seed = 11 } = {}) {
  const r = rng(seed);
  // Always long enough for every partial to ring down to -60 dB: a bar or a
  // bell cut off mid-ring is an audible click, however short the fade.
  const need = Math.max(...partials.map((p) => p.decay)) * 7;
  const out = mono(Math.max(sec, need));
  for (const p of partials) {
    const ph = r() * TAU;
    const aN = Math.max(1, attack * SR);
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      const env = Math.min(1, i / aN) * Math.exp(-t / p.decay);
      if (env < 1e-5 && i > aN) break;
      out[i] += p.amp * env * Math.sin(TAU * p.f * t + ph);
    }
  }
  return out;
}

// ── envelopes ──────────────────────────────────────────────────────────────
/** Piecewise envelope from [[t, v], ...] (linear, or exponential when curve=exp). */
export function env(sec, pts, curve = "lin") {
  const out = mono(sec);
  let k = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    while (k < pts.length - 2 && t > pts[k + 1][0]) k++;
    const [t0, v0] = pts[k], [t1, v1] = pts[Math.min(k + 1, pts.length - 1)];
    if (t <= t0) { out[i] = v0; continue; }
    if (t >= t1) { out[i] = v1; continue; }
    const r = (t - t0) / (t1 - t0);
    out[i] = curve === "exp" && v0 > 0 && v1 > 0 ? v0 * Math.pow(v1 / v0, r) : v0 + (v1 - v0) * r;
  }
  return out;
}

/** Attack then exponential decay (time constant tau). */
export function decay(sec, tau, attack = 0.002) {
  const out = mono(sec);
  const aN = Math.max(1, attack * SR);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, i / aN) * Math.exp(-(i / SR) / tau);
  return out;
}

// ── math on signals ────────────────────────────────────────────────────────
export function mul(a, b) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * (typeof b === "number" ? b : (b[i] ?? 0));
  return out;
}
/** Fade the last few ms of a layer so a buffer that ends while its sound is
 *  still ringing never clicks (the spectrogram showed those as vertical lines). */
function endFade(x) {
  const n = x.length, f = Math.min(Math.round(0.012 * SR), Math.floor(n / 8));
  if (f < 2 || Math.abs(x[n - 1]) < 1e-5) return x;
  const y = new Float32Array(x);
  for (let i = 0; i < f; i++) y[n - 1 - i] *= i / f;
  return y;
}

/** Mix src into dst at offset seconds with gain (mono into mono, or into both sides of stereo with pan). */
export function add(dst, src, at = 0, gain = 1, pan = 0) {
  src = Array.isArray(src) ? src.map(endFade) : endFade(src);
  const o = Math.round(at * SR);
  if (Array.isArray(dst)) {
    const [L, R] = dst;
    if (Array.isArray(src)) {
      for (let i = 0; i < src[0].length; i++) {
        const j = i + o; if (j < 0 || j >= L.length) continue;
        L[j] += src[0][i] * gain; R[j] += src[1][i] * gain;
      }
    } else {
      const a = (pan + 1) * Math.PI / 4, gl = Math.cos(a) * Math.SQRT2 * gain, gr = Math.sin(a) * Math.SQRT2 * gain;
      for (let i = 0; i < src.length; i++) {
        const j = i + o; if (j < 0 || j >= L.length) continue;
        L[j] += src[i] * gl; R[j] += src[i] * gr;
      }
    }
  } else {
    for (let i = 0; i < src.length; i++) { const j = i + o; if (j >= 0 && j < dst.length) dst[j] += src[i] * gain; }
  }
  return dst;
}
export function saturate(x, drive = 1) {
  const out = new Float32Array(x.length);
  const n = Math.tanh(drive) || 1;
  for (let i = 0; i < x.length; i++) out[i] = Math.tanh(x[i] * drive) / n;
  return out;
}

// ── filters ────────────────────────────────────────────────────────────────
/** RBJ biquad. type: lp|hp|bp|notch|peak|lowshelf|highshelf. freq/q may be fn(t). */
export function biquad(x, type, freq, q = 0.707, gainDb = 0) {
  const out = new Float32Array(x.length);
  let b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const dyn = typeof freq === "function" || typeof q === "function";
  const coef = (t) => {
    const f = Math.min(SR * 0.45, Math.max(10, val(freq, t)));
    const Q = Math.max(0.05, val(q, t));
    const w = TAU * f / SR, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * Q);
    const A = Math.pow(10, gainDb / 40);
    let c;
    switch (type) {
      case "lp": c = [(1 - cs) / 2, 1 - cs, (1 - cs) / 2, 1 + al, -2 * cs, 1 - al]; break;
      case "hp": c = [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al]; break;
      case "bp": c = [al, 0, -al, 1 + al, -2 * cs, 1 - al]; break;
      case "notch": c = [1, -2 * cs, 1, 1 + al, -2 * cs, 1 - al]; break;
      case "peak": c = [1 + al * A, -2 * cs, 1 - al * A, 1 + al / A, -2 * cs, 1 - al / A]; break;
      case "lowshelf": { const s = 2 * Math.sqrt(A) * al; c = [A * ((A + 1) - (A - 1) * cs + s), 2 * A * ((A - 1) - (A + 1) * cs), A * ((A + 1) - (A - 1) * cs - s), (A + 1) + (A - 1) * cs + s, -2 * ((A - 1) + (A + 1) * cs), (A + 1) + (A - 1) * cs - s]; break; }
      case "highshelf": { const s = 2 * Math.sqrt(A) * al; c = [A * ((A + 1) + (A - 1) * cs + s), -2 * A * ((A - 1) + (A + 1) * cs), A * ((A + 1) + (A - 1) * cs - s), (A + 1) - (A - 1) * cs + s, 2 * ((A - 1) - (A + 1) * cs), (A + 1) - (A - 1) * cs - s]; break; }
      default: c = [1, 0, 0, 1, 0, 0];
    }
    b0 = c[0] / c[3]; b1 = c[1] / c[3]; b2 = c[2] / c[3]; a1 = c[4] / c[3]; a2 = c[5] / c[3];
  };
  coef(0);
  for (let i = 0; i < x.length; i++) {
    if (dyn && (i & 15) === 0) coef(i / SR);
    const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}
export const lp = (x, f, q) => biquad(x, "lp", f, q);
export const hp = (x, f, q) => biquad(x, "hp", f, q);
export const bp = (x, f, q) => biquad(x, "bp", f, q);

// ── space ──────────────────────────────────────────────────────────────────
/** Freeverb (Jezar) — 8 combs + 4 allpasses per side. Returns a NEW stereo buffer (dry+wet). */
export function reverb(st, { room = 0.8, damp = 0.4, wet = 0.25, dry = 1, width = 1, predelay = 0.012, tail = 1.5 } = {}) {
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const apT = [556, 441, 341, 225];
  const k = SR / 44100, spread = 23;
  const inLen = st[0].length, outLen = inLen + len(tail);
  const pre = Math.round(predelay * SR);
  const fb = room * 0.28 + 0.7, d1 = damp * 0.4, d2 = 1 - d1;
  const wet1 = wet * (width / 2 + 0.5), wet2 = wet * ((1 - width) / 2);
  const outs = [];
  for (let ch = 0; ch < 2; ch++) {
    const combs = combT.map((t) => ({ buf: new Float32Array(Math.round((t + ch * spread) * k)), i: 0, store: 0 }));
    const aps = apT.map((t) => ({ buf: new Float32Array(Math.round((t + ch * spread) * k)), i: 0 }));
    const o = new Float32Array(outLen);
    for (let n = 0; n < outLen; n++) {
      const m = n - pre;
      const input = m >= 0 && m < inLen ? (st[0][m] + st[1][m]) * 0.015 : 0;
      let acc = 0;
      for (const c of combs) {
        const y = c.buf[c.i];
        c.store = y * d2 + c.store * d1;
        c.buf[c.i] = input + c.store * fb;
        c.i = (c.i + 1) % c.buf.length;
        acc += y;
      }
      for (const a of aps) {
        const b = a.buf[a.i];
        a.buf[a.i] = acc + b * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        acc = b - acc;
      }
      o[n] = acc;
    }
    outs.push(o);
  }
  const L = new Float32Array(outLen), R = new Float32Array(outLen);
  for (let n = 0; n < outLen; n++) {
    const dl = n < inLen ? st[0][n] : 0, dr = n < inLen ? st[1][n] : 0;
    L[n] = dl * dry + outs[0][n] * wet1 + outs[1][n] * wet2;
    R[n] = dr * dry + outs[1][n] * wet1 + outs[0][n] * wet2;
  }
  return [L, R];
}

/** Stereo ping-pong delay (in place mix), time in seconds. */
export function pingpong(st, time, feedback = 0.35, mix = 0.25, damp = 3500) {
  const d = Math.round(time * SR);
  const [L, R] = st;
  const bl = new Float32Array(d), br = new Float32Array(d);
  let i = 0, lpL = 0, lpR = 0;
  const a = Math.exp(-TAU * damp / SR);
  for (let n = 0; n < L.length; n++) {
    const yl = bl[i], yr = br[i];
    lpL = (1 - a) * yl + a * lpL; lpR = (1 - a) * yr + a * lpR;
    bl[i] = (L[n] + R[n]) * 0.5 + lpR * feedback;
    br[i] = lpL * feedback;
    i = (i + 1) % d;
    L[n] += yl * mix; R[n] += yr * mix;
  }
  return st;
}

// ── dynamics / mastering ───────────────────────────────────────────────────
/** Brickwall-ish limiter with lookahead; ceiling in dBFS. */
export function limit(st, ceilingDb = -1, release = 0.08, lookahead = 0.004) {
  const c = Math.pow(10, ceilingDb / 20);
  const la = Math.round(lookahead * SR);
  const n = st[0].length;
  const peak = new Float32Array(n);
  for (let i = 0; i < n; i++) peak[i] = Math.max(Math.abs(st[0][i]), Math.abs(st[1][i]));
  const out = [new Float32Array(n), new Float32Array(n)];
  let g = 1;
  const rel = Math.exp(-1 / (release * SR));
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (let k = 0; k <= la; k++) { const j = i + k; if (j < n && peak[j] > p) p = peak[j]; }
    const target = p > c ? c / p : 1;
    g = target < g ? target : target + (g - target) * rel;
    out[0][i] = st[0][i] * g; out[1][i] = st[1][i] * g;
  }
  return out;
}

export function peakDb(st) {
  let p = 0;
  for (const ch of st) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]));
  return 20 * Math.log10(p || 1e-9);
}

/** Scale so the peak sits at `db` dBFS. */
export function normalize(st, db = -1) {
  const g = Math.pow(10, (db - peakDb(st)) / 20);
  return st.map((ch) => mul(ch, g));
}

/** Short fades at both ends (clickless one-shots). */
export function fades(st, fin = 0.002, fout = 0.03) {
  const a = len(fin), b = len(fout);
  for (const ch of st) {
    for (let i = 0; i < a && i < ch.length; i++) ch[i] *= i / a;
    for (let i = 0; i < b && i < ch.length; i++) ch[ch.length - 1 - i] *= i / b;
  }
  return st;
}

/** Trim trailing near-silence (keeps a tiny tail). */
export function trimTail(st, thresholdDb = -70, keep = 0.02) {
  const th = Math.pow(10, thresholdDb / 20);
  let last = 0;
  for (const ch of st) for (let i = ch.length - 1; i >= 0; i--) { if (Math.abs(ch[i]) > th) { last = Math.max(last, i); break; } }
  const n = Math.min(st[0].length, last + len(keep));
  return st.map((ch) => ch.slice(0, n));
}

// ── io ─────────────────────────────────────────────────────────────────────
export function writeWav(file, st) {
  const n = st[0].length, ch = 2;
  const data = Buffer.alloc(n * ch * 2);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, st[c][i]));
      data.writeInt16LE(Math.round(v * 32767), (i * ch + c) * 2);
    }
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * ch * 2, 28); h.writeUInt16LE(ch * 2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

export const FFMPEG = require("ffmpeg-static");

/** Encode a wav to mp3 (VBR ~190 kbps, 48 kHz) and return ebur128 loudness stats. */
export function encodeMp3(wav, mp3, { q = 2 } = {}) {
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", wav, "-ar", String(SR), "-c:a", "libmp3lame", "-q:a", String(q), mp3]);
}

export function loudness(file) {
  let out = "";
  try {
    execFileSync(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) { out = String(e.stderr ?? ""); }
  if (!out) {
    const r = require("node:child_process").spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
    out = r.stderr;
  }
  const I = /I:\s+(-?[\d.]+) LUFS/.exec(out.slice(out.lastIndexOf("Summary")));
  const P = /Peak:\s+(-?[\d.]+) dBFS/.exec(out.slice(out.lastIndexOf("Summary")));
  return { lufs: I ? +I[1] : NaN, truePeak: P ? +P[1] : NaN };
}

/** Semitone → frequency, A4 = 440. */
export const note = (semisFromA4) => 440 * Math.pow(2, semisFromA4 / 12);
