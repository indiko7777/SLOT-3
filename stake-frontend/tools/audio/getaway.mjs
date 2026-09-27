#!/usr/bin/env node
/**
 * Renders the Getaway (Hold & Spin) sound set to public/assets/audio/getaway/.
 *
 *   node tools/audio/getaway.mjs            # everything
 *   node tools/audio/getaway.mjs boom door  # just these
 *
 * Music: a 128 BPM night-chase synthwave loop in A minor (8 bars = exactly 15 s)
 * plus a TENSION layer of the same length (police sirens, helicopter rotor,
 * pounding toms) that the game fades in as dead spins stack the heat. Loops are
 * rendered three times and the middle pass is kept, so reverb/delay tails wrap
 * and the loop point is seamless.
 *
 * The original transition sound (getaway_intro) and the intro typewriter are
 * NOT rendered here — they are untouched.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  SR, len, mono, stereo, rng, osc, noise, crackle, modal, env, decay, mul, add, saturate,
  biquad, lp, hp, bp, reverb, pingpong, limit, normalize, fades, trimTail, peakDb,
  writeWav, encodeMp3, loudness, note,
} from "./dsp.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../../public/assets/audio/getaway");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "getaway-audio-"));

// ── music constants ────────────────────────────────────────────────────────
const BPM = 128;
const BEAT = 60 / BPM;                 // 0.46875 s = 22500 samples @ 48 kHz
const S16 = BEAT / 4;
const BARS = 8;
const LOOP = BARS * 4 * BEAT;          // 15 s exactly
// A minor chase progression: Am F C G | Am F Dm E(dominant → back to Am)
const CHORDS = [
  [-12, -9, -5], [-16, -12, -9], [-9, -5, -2], [-14, -10, -7],
  [-12, -9, -5], [-16, -12, -9], [-19, -16, -12], [-17, -13, -10],
];
const ROOTS = [-36, -40, -33, -38, -36, -40, -31, -41];  // bass roots (semitones from A4)

// ── instruments ────────────────────────────────────────────────────────────
function kick() {
  const d = 0.42;
  const body = mul(osc("sine", (t) => 48 + 115 * Math.exp(-t / 0.028), d), decay(d, 0.16, 0.001));
  const click = mul(hp(noise(0.012, "white", 21), 2500), decay(0.012, 0.002, 0.0002));
  const k = mono(d);
  add(k, saturate(body, 1.8), 0, 0.95);
  add(k, click, 0, 0.35);
  return k;
}
function snare(seed) {
  const d = 0.32;
  const n = mul(bp(noise(d, "white", seed), 1900, 0.7), decay(d, 0.07, 0.001));
  const tone = mul(osc("tri", (t) => 190 - 30 * t / d, d), decay(d, 0.045, 0.001));
  const s = mono(d);
  add(s, n, 0, 0.9); add(s, tone, 0, 0.45);
  return s;
}
function hat(open, seed) {
  const d = open ? 0.28 : 0.06;
  const n = hp(bp(noise(d, "white", seed), 9000, 0.6), 6500);
  return mul(n, decay(d, open ? 0.09 : 0.016, 0.0005));
}
function supersawNote(freq, d, detune = 0.11, voices = 5) {
  const out = mono(d);
  for (let v = 0; v < voices; v++) {
    const cents = (v - (voices - 1) / 2) * detune * 100 / ((voices - 1) / 2);
    add(out, osc("saw", freq * Math.pow(2, cents / 1200), d, { phase: v * 0.37 % 1 }), 0, 1 / voices);
  }
  return out;
}
function tom(freq, seed) {
  const d = 0.5;
  const body = mul(osc("sine", (t) => freq * (1 + 0.6 * Math.exp(-t / 0.03)), d), decay(d, 0.18, 0.001));
  const skin = mul(bp(noise(d, "white", seed), freq * 4, 1.2), decay(d, 0.03, 0.001));
  const t = mono(d); add(t, saturate(body, 1.5), 0, 0.9); add(t, skin, 0, 0.3);
  return t;
}

/** Sidechain envelope: ducks to `depth` on every beat, recovers over `rel`. */
function sidechain(total, depth = 0.35, rel = 0.16) {
  const out = mono(total);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const since = t % BEAT;
    out[i] = 1 - (1 - depth) * Math.exp(-since / (rel * 0.45));
  }
  return out;
}

function renderMusicMain(passes = 3) {
  const total = LOOP * passes;
  const drums = stereo(total), bass = mono(total), pad = stereo(total), arp = stereo(total), snareBus = stereo(total);
  const K = kick();
  for (let bar = 0; bar < BARS * passes; bar++) {
    const b = bar % BARS;
    const t0 = bar * 4 * BEAT;
    // drums: four-on-the-floor, gated snare on 2 & 4, 16th hats with groove
    for (let q = 0; q < 4; q++) add(drums, K, t0 + q * BEAT, 0.95);
    add(snareBus, snare(100 + bar), t0 + BEAT, 0.62, -0.05);
    add(snareBus, snare(200 + bar), t0 + 3 * BEAT, 0.62, 0.05);
    for (let s = 0; s < 16; s++) {
      const open = s === 14;
      const vel = open ? 0.28 : [0.22, 0.12, 0.3, 0.14][s % 4];
      add(drums, hat(open, 300 + bar * 16 + s), t0 + s * S16, vel, 0.25);
    }
    if (b === BARS - 1) {           // fill into the loop: 16th snares over beat 4
      for (let s = 12; s < 16; s++) add(snareBus, snare(500 + s), t0 + s * S16, 0.18 + (s - 12) * 0.08, (s % 2 ? 0.2 : -0.2));
    }
    // bass: pulsing 16ths on the root, octave pop on the last 16th of each beat
    const root = note(ROOTS[b]);
    for (let s = 0; s < 16; s++) {
      const f = s % 4 === 3 ? root * 2 : root;
      const d = S16 * 0.92;
      const n = osc("saw", f, d);
      const filt = biquad(n, "lp", (t) => 220 + 1100 * Math.exp(-t / 0.045), 1.1);
      add(bass, mul(filt, env(d, [[0, 0], [0.003, 1], [d * 0.6, 0.75], [d, 0]])), t0 + s * S16, s % 4 === 0 ? 0.9 : 0.62);
    }
    // pad: wide supersaw chord per bar
    const d = 4 * BEAT + 0.35;
    CHORDS[b].forEach((st, i) => {
      const f = note(st);
      const v = lp(supersawNote(f, d), 1500, 0.8);
      const e = env(d, [[0, 0], [0.22, 1], [4 * BEAT - 0.05, 0.85], [d, 0]]);
      add(pad, mul(v, e), t0, 0.16, i === 0 ? -0.55 : i === 1 ? 0.55 : 0);
      add(pad, mul(lp(supersawNote(f * 2, d, 0.08, 3), 2200), e), t0, 0.06, i === 1 ? -0.4 : 0.4);
    });
    // arp: 16ths up the chord (octave 5), pulse wave, into a ping-pong delay
    const tones = [...CHORDS[b].map((x) => x + 12), CHORDS[b][0] + 24];
    for (let s = 0; s < 16; s++) {
      const f = note(tones[[0, 1, 2, 3, 2, 1, 0, 1][s % 8]]);
      const dd = S16 * 0.9;
      const v = lp(osc("pulse", f, dd, { pw: 0.28 }), 3200, 0.9);
      add(arp, mul(v, env(dd, [[0, 0], [0.002, 1], [dd, 0]], "lin")), t0 + s * S16, s % 4 === 0 ? 0.12 : 0.085, (s % 2 ? 0.35 : -0.35));
    }
  }
  // sidechain pump on bass + pad
  const sc = sidechain(total, 0.3, 0.2);
  const bassSC = mul(saturate(lp(bass, 900), 1.4), sc);
  const padSC = pad.map((ch) => mul(ch, sidechain(total, 0.55, 0.22)));
  const snareVerb = reverb(snareBus, { room: 0.86, damp: 0.35, wet: 0.55, dry: 0.9, tail: 0.1 });
  pingpong(arp, BEAT * 0.75, 0.38, 0.45, 3000);
  const arpVerb = reverb(arp, { room: 0.8, wet: 0.35, dry: 1, tail: 0.1 });
  const padVerb = reverb(padSC, { room: 0.9, wet: 0.3, dry: 1, tail: 0.1 });

  const mix = stereo(total);
  add(mix, drums, 0, 0.85);
  add(mix, snareVerb.map((c) => c.slice(0, len(total))), 0, 0.8);
  add(mix, bassSC, 0, 0.62);
  add(mix, padVerb.map((c) => c.slice(0, len(total))), 0, 0.8);
  add(mix, arpVerb.map((c) => c.slice(0, len(total))), 0, 0.9);
  return middlePass(mix, passes);
}

function renderMusicTension(passes = 3) {
  const total = LOOP * passes;
  const mix = stereo(total);
  const r = rng(77);
  // two police sirens (wail), far away and panned, 8 wails per loop each
  for (const [side, detune, off] of [[-0.6, 1, 0], [0.6, 1.035, 0.9]]) {
    const wail = (t) => {
      const ph = ((t + off) % (LOOP / 8)) / (LOOP / 8);
      return (660 + 640 * (0.5 - 0.5 * Math.cos(Math.PI * 2 * ph))) * detune;
    };
    const s = osc("saw", wail, total);
    const f = lp(bp(s, 1100, 0.6), 2300);
    const am = env(total, [[0, 0.8], [total, 0.8]]);
    add(mix, mul(f, am), 0, 0.055, side);
  }
  // helicopter: rotor chop (11.2 Hz = 168 cycles per loop) over low turbine noise
  const turb = lp(noise(total, "brown", 5), 400);
  const chop = mono(total);
  for (let i = 0; i < chop.length; i++) {
    const t = i / SR;
    const ph = (t * 11.2) % 1;
    // ~3 ms raised-cosine attack per blade pass: a zero-length attack made every
    // pass (and so the loop point, which lands on one) a hard click
    const atk = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, ph / 0.035));
    chop[i] = atk * Math.exp(-ph / 0.09) * (0.8 + 0.2 * Math.sin(Math.PI * 2 * t / LOOP));
  }
  const blade = mul(bp(noise(total, "white", 6), 700, 0.9), chop);
  const heli = mono(total);
  add(heli, mul(turb, chop), 0, 0.9);
  add(heli, blade, 0, 0.35);
  // slow pan across the loop (heli circling)
  const heliSt = stereo(total);
  for (let i = 0; i < total * SR; i++) {
    const p = Math.sin(Math.PI * 2 * i / (LOOP * SR));
    const a = (p * 0.7 + 1) * Math.PI / 4;
    heliSt[0][i] = heli[i] * Math.cos(a) * 1.2;
    heliSt[1][i] = heli[i] * Math.sin(a) * 1.2;
  }
  add(mix, heliSt, 0, 0.5);
  // pounding toms on 8ths with accents, locked to the main loop's grid
  const pattern = [1, 0, 0.6, 0, 0.8, 0.5, 0.6, 0.4];
  for (let bar = 0; bar < BARS * passes; bar++) {
    const t0 = bar * 4 * BEAT;
    for (let e = 0; e < 8; e++) {
      if (!pattern[e]) continue;
      const f = [82, 98, 110][e % 3];
      add(mix, tom(f, 900 + bar * 8 + e), t0 + e * (BEAT / 2), 0.32 * pattern[e], (e % 2 ? 0.25 : -0.25));
    }
    // tension pulse: high E pulsing 8ths (dominant of A minor)
    const d = 4 * BEAT;
    const pulse = mul(lp(osc("saw", note(7), d), 1800), env(d, Array.from({ length: 9 }, (_, k) => [k * BEAT / 2, k % 2 ? 0.25 : 1])));
    add(mix, pulse, t0, 0.03, (bar % 2 ? 0.3 : -0.3));
    void r;
  }
  const wet = reverb(mix, { room: 0.85, wet: 0.3, dry: 1, tail: 0.1 });
  return middlePass(wet.map((c) => c.slice(0, len(total))), passes);
}

/** Keep the middle pass as the loop, and blend its head with what actually
 *  follows its end (linear, 0.3 s — most of the mix is periodic and therefore
 *  correlated, where an equal-power fade would bump the level). Non-periodic
 *  parts (noise, free-running oscillators) then flow straight from the loop's
 *  last sample into its first — no click. Mastering (normalize + limiter) runs
 *  on the whole multi-pass render BEFORE the cut, so its gain is continuous
 *  across the join too. */
function middlePass(st, passes) {
  const mastered = limit(normalize(st, -2), -1.5);
  const a = len(LOOP * Math.floor(passes / 2)), n = len(LOOP), x = len(0.3);
  return mastered.map((ch) => {
    const loop = ch.slice(a, a + n);
    for (let i = 0; i < x; i++) {
      const r = i / x;
      loop[i] = loop[i] * r + (ch[a + n + i] ?? 0) * (1 - r);
    }
    return loop;
  });
}

// ── sound effects ──────────────────────────────────────────────────────────
/** Heavy armoured doors: latch strain rattle (0–0.2 s), bolt clunk, a fast
 *  swing with hinge groan, then both doors slam against their stops ~0.78 s. */
function door() {
  const d = 2.3;
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  // latch strain: 5 metallic knocks while the doors fight the latch
  for (let k = 0; k < 5; k++) {
    const knock = mono(0.6);
    add(knock, mul(bp(noise(0.2, "white", 30 + k), 2600, 3), decay(0.2, 0.012, 0.0005)), 0, 0.6);
    add(knock, modal(0.2, [{ f: 610, amp: 0.3, decay: 0.05 }, { f: 1530, amp: 0.2, decay: 0.03 }], { seed: 40 + k }), 0, 1);
    add(st, knock, k * 0.04, 0.35 - k * 0.03, k % 2 ? 0.3 : -0.3);
  }
  // bolt release clunk
  const clunk = mono(2.2);
  add(clunk, mul(osc("sine", (t) => 58 + 45 * Math.exp(-t / 0.04), 0.6), decay(0.6, 0.12, 0.001)), 0, 0.9);
  add(clunk, mul(bp(noise(0.6, "white", 50), 900, 1.2), decay(0.6, 0.035, 0.0005)), 0, 0.5);
  add(clunk, modal(0.6, [{ f: 220, amp: 0.4, decay: 0.25 }, { f: 587, amp: 0.25, decay: 0.18 }, { f: 1340, amp: 0.12, decay: 0.1 }], { seed: 51 }), 0, 1);
  add(st, saturate(clunk, 1.6), 0.2, 0.8);
  // hinge groan (stick-slip): two doors, L and R, slightly offset
  for (const [side, off, f0, seed] of [[-0.7, 0.21, 118, 60], [0.7, 0.25, 104, 61]]) {
    const gd = 0.62;
    const r = rng(seed);
    let jitter = 0;
    const src = osc("saw", (t) => { jitter += (r() - 0.5) * 0.9; jitter *= 0.995; return f0 * (1 + 0.25 * t / gd) + jitter * 4; }, gd);
    const stick = mono(gd);
    for (let i = 0; i < stick.length; i++) {
      const t = i / SR;
      const rate = 34 - 22 * t / gd;          // slips slow down as the swing slows
      stick[i] = 0.35 + 0.65 * Math.pow(Math.abs(Math.sin(Math.PI * rate * t)), 6);
    }
    const formants = mono(gd);
    for (const [f, q, g] of [[720, 9, 1], [1480, 11, 0.7], [2650, 12, 0.45]]) add(formants, bp(src, f, q), 0, g);
    const groan = mul(mul(formants, stick), env(gd, [[0, 0], [0.04, 1], [0.35, 0.8], [gd, 0]]));
    add(st, groan, off, 0.5, side);
  }
  // air of the swing
  const sw = 0.7;
  add(st, mul(biquad(noise(sw, "pink", 70), "bp", (t) => 380 + 1400 * Math.sin(Math.PI * Math.min(1, t / sw)), 0.8), env(sw, [[0, 0], [0.2, 1], [sw, 0]])), 0.2, 0.28);
  // slam against the stops (two doors a hair apart) + settle knock
  for (const [side, at, seed] of [[-0.55, 0.78, 80], [0.55, 0.83, 81]]) {
    const cd = 1.4;
    const slam = mono(cd + 2);
    add(slam, mul(osc("sine", (t) => 55 + 60 * Math.exp(-t / 0.03), cd), decay(cd, 0.13, 0.001)), 0, 0.85);
    add(slam, mul(bp(noise(cd, "white", seed), 1200, 0.9), decay(cd, 0.03, 0.0005)), 0, 0.55);
    add(slam, modal(cd, [
      { f: 176, amp: 0.35, decay: 0.42 }, { f: 463, amp: 0.3, decay: 0.34 }, { f: 887, amp: 0.2, decay: 0.26 },
      { f: 1452, amp: 0.13, decay: 0.2 }, { f: 2231, amp: 0.08, decay: 0.14 },
    ], { seed: seed + 5 }), 0, 1);
    add(st, saturate(slam, 1.7), at, 0.85, side);
  }
  add(st, modal(0.5, [{ f: 330, amp: 0.3, decay: 0.12 }, { f: 910, amp: 0.15, decay: 0.08 }], { seed: 90 }), 0.96, 0.25, 0.1);
  return reverb(st, { room: 0.7, damp: 0.5, wet: 0.22, tail: 0.8, predelay: 0.02 });
}

/** Reels start: a quick mechanical wind-up whoosh. */
function spinStart() {
  const d = 0.55;
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  const motor = mul(lp(osc("saw", (t) => 70 + 110 * Math.min(1, t / 0.25), d), 900, 1.2), env(d, [[0, 0], [0.05, 0.9], [0.3, 0.6], [d, 0]]));
  add(st, motor, 0, 0.35);
  add(st, mul(biquad(noise(d, "pink", 12), "bp", (t) => 600 + 3000 * t / d, 0.9), env(d, [[0, 0], [0.12, 1], [d, 0]])), 0, 0.45);
  add(st, mul(hp(noise(0.03, "white", 13), 3000), decay(0.03, 0.006)), 0, 0.3);
  return reverb(st, { wet: 0.12, tail: 0.3 });
}

/** A reel column stops: small mechanical clack. */
function columnStop() {
  const d = 0.2;
  const m = mono(d);
  add(m, mul(bp(noise(d, "white", 14), 1700, 2), decay(d, 0.01, 0.0003)), 0, 0.7);
  add(m, mul(osc("sine", (t) => 150 - 40 * t / d, d), decay(d, 0.035, 0.001)), 0, 0.5);
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  add(st, m, 0, 1);
  return st;
}

// Bar pitches: A minor pentatonic up the scale, so a spin that lands several
// bars plays an ascending run (A C D E G).
const BAR_NOTES = [0, 3, 5, 7, 10];
/** A solid gold bar slams into its slot: sub weight, hard metal transient,
 *  a ringing free-bar mode set tuned to the scale, and a coin-bright shimmer. */
function barLand(k) {
  const d = 1.6;
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  const f = note(BAR_NOTES[k] + 3);          // C5.. region
  const sub = mul(osc("sine", (t) => 52 + 95 * Math.exp(-t / 0.03), d), decay(d, 0.12, 0.001));
  add(st, saturate(sub, 2), 0, 0.9);
  add(st, mul(bp(noise(0.05, "white", 100 + k), 1300, 0.8), decay(0.05, 0.012, 0.0003)), 0, 0.8);
  add(st, mul(hp(noise(0.02, "white", 110 + k), 4000), decay(0.02, 0.004, 0.0002)), 0, 0.45);
  // free-free bar modes: 1, 2.76, 5.40, 8.93
  const ring = modal(d, [
    { f, amp: 0.36, decay: 0.95 }, { f: f * 2.756, amp: 0.2, decay: 0.55 },
    { f: f * 5.404, amp: 0.11, decay: 0.32 }, { f: f * 8.933, amp: 0.06, decay: 0.18 },
  ], { seed: 120 + k, attack: 0.001 });
  add(st, ring, 0.004, 0.55, -0.15);
  add(st, modal(d, [{ f: f * 1.0012, amp: 0.3, decay: 0.8 }, { f: f * 2.77, amp: 0.15, decay: 0.45 }], { seed: 130 + k }), 0.006, 0.4, 0.2);
  // coin-bright shimmer
  const r = rng(140 + k);
  for (let i = 0; i < 5; i++) {
    const pf = 3200 + r() * 3200;
    add(st, modal(0.4, [{ f: pf, amp: 0.2, decay: 0.08 + r() * 0.08 }], { seed: 150 + i }), 0.02 + r() * 0.12, 0.25, r() * 1.4 - 0.7);
  }
  return reverb(st, { room: 0.6, wet: 0.18, tail: 0.6 });
}

/** Extra layer for a BIG bar (25x+): a deep boom and a bright sparkle chord. */
function barBig() {
  const d = 2.2;
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  add(st, saturate(mul(osc("sine", (t) => 34 + 60 * Math.exp(-t / 0.08), d), decay(d, 0.55, 0.002)), 2.2), 0, 0.9);
  for (const [s, p] of [[12, -0.4], [16, 0.4], [19, 0], [24, 0]]) {
    add(st, mul(osc("sine", note(s), d), env(d, [[0, 0], [0.02, 1], [d, 0]], "lin")), 0.03, 0.09, p);
    add(st, mul(osc("tri", note(s) * 2, d), env(d, [[0, 0], [0.02, 0.6], [1.2, 0]], "lin")), 0.05, 0.05, -p);
  }
  add(st, mul(biquad(noise(0.9, "white", 160), "bp", (t) => 1500 + 7000 * t / 0.9, 1.2), env(0.9, [[0, 0], [0.5, 1], [0.9, 0]])), 0, 0.18);
  return reverb(st, { room: 0.88, wet: 0.35, tail: 1.2 });
}

/** Dynamite lands: wooden thud, match strike, fuse catches and fizzes. */
function dynamiteLand() {
  const d = 1.2;
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  add(st, mul(osc("sine", (t) => 95 + 60 * Math.exp(-t / 0.02), 0.25), decay(0.25, 0.07, 0.001)), 0, 0.8);
  add(st, mul(lp(noise(0.08, "white", 170), 900), decay(0.08, 0.02, 0.0005)), 0, 0.5);
  // strike
  add(st, mul(bp(noise(0.1, "white", 171), 3200, 1.1), env(0.1, [[0, 0], [0.01, 1], [0.1, 0]])), 0.09, 0.55);
  add(st, crackle(0.12, 900, 172), 0.09, 0.25);
  // ignite whoosh
  add(st, mul(biquad(noise(0.35, "pink", 173), "bp", (t) => 700 + 1400 * t / 0.35, 0.9), env(0.35, [[0, 0], [0.08, 1], [0.35, 0.3]])), 0.14, 0.5);
  // fuse fizz tail
  const fz = 0.8;
  const fizz = mul(hp(bp(noise(fz, "white", 174), 5200, 0.8), 3500), env(fz, [[0, 0], [0.05, 0.8], [fz, 0]]));
  add(st, fizz, 0.35, 0.35, 0.15);
  add(st, crackle(fz, (t) => 60 - 50 * t / fz, 175), 0.35, 0.3, 0.15);
  return reverb(st, { wet: 0.12, tail: 0.3 });
}

/** The fuse burns down into the stick — rising sizzle, ends right at the boom. */
function fuse() {
  const d = 0.62;
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  const hiss = biquad(noise(d, "white", 180), "bp", (t) => 3000 + 3500 * t / d, 0.7);
  add(st, mul(hiss, env(d, [[0, 0.2], [d * 0.9, 1], [d, 0.9]])), 0, 0.5);
  add(st, crackle(d, (t) => 40 + 260 * (t / d) ** 2, 181), 0, 0.45);
  add(st, mul(osc("sine", (t) => 180 + 420 * (t / d) ** 2, d), env(d, [[0, 0], [d, 0.12]])), 0, 1);
  return st;
}

/** The blast: sub drop, saturated body sweeping shut, debris rattling down. */
function boom() {
  const d = 3;
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  add(st, saturate(mul(osc("sine", (t) => 30 + 70 * Math.exp(-t / 0.09), d), decay(d, 0.55, 0.002)), 2.5), 0, 1);
  const body = biquad(noise(d, "white", 190), "lp", (t) => 150 + 7500 * Math.exp(-t / 0.18), 0.8);
  add(st, saturate(mul(body, env(d, [[0, 0], [0.004, 1], [0.25, 0.45], [1.6, 0]])), 2.8), 0, 0.9);
  add(st, mul(noise(0.01, "white", 191), decay(0.01, 0.002, 0.0001)), 0, 0.8);
  // debris: gravel and small metal bits over the tail
  const r = rng(192);
  for (let i = 0; i < 26; i++) {
    const at = 0.15 + r() * 1.5;
    const g = (1 - (at - 0.15) / 1.6) * 0.25;
    add(st, mul(bp(noise(0.05, "white", 200 + i), 1500 + r() * 3000, 2), decay(0.05, 0.012)), at, g, r() * 1.6 - 0.8);
  }
  add(st, lp(crackle(1.8, (t) => 180 * Math.exp(-t / 0.5), 193), 3000), 0.1, 0.35, -0.2);
  const wet = reverb(st, { room: 0.92, damp: 0.55, wet: 0.35, tail: 1.2, predelay: 0.03 });
  return limit(wet, -1);
}

/** A bar's value doubles: an upward "shing", a lock-click and a coin splash. */
function doubleHit() {
  const d = 1.1;
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  add(st, mul(osc("tri", (t) => 660 * Math.pow(2, Math.min(1, t / 0.09)), d), env(d, [[0, 0], [0.01, 0.8], [0.09, 0.6], [0.5, 0]])), 0, 0.25);
  add(st, modal(d, [{ f: 1318.5, amp: 0.3, decay: 0.45 }, { f: 1318.5 * 2.76, amp: 0.14, decay: 0.25 }, { f: 1760, amp: 0.2, decay: 0.5 }], { seed: 210 }), 0.07, 0.6);
  add(st, mul(hp(noise(0.3, "white", 211), 5000), env(0.3, [[0, 0], [0.02, 1], [0.3, 0]])), 0.07, 0.18);
  const r = rng(212);
  for (let i = 0; i < 7; i++) add(st, modal(0.3, [{ f: 3500 + r() * 3500, amp: 0.2, decay: 0.05 + r() * 0.07 }], { seed: 220 + i }), 0.1 + r() * 0.25, 0.3, r() * 1.4 - 0.7);
  add(st, mul(bp(noise(0.03, "white", 213), 2500, 2), decay(0.03, 0.006)), 0.07, 0.5);
  return reverb(st, { room: 0.7, wet: 0.2, tail: 0.6 });
}

/** A dud: nothing next to it to blow — the fuse sputters out and it puffs smoke. */
function dud() {
  const d = 1.3;
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  add(st, mul(hp(noise(0.7, "white", 230), 3000), env(0.7, [[0, 0.7], [0.5, 0.2], [0.7, 0]])), 0, 0.3);
  add(st, crackle(0.7, (t) => 120 * Math.exp(-t / 0.2), 231), 0, 0.4);
  add(st, mul(lp(noise(0.4, "pink", 232), 700), env(0.4, [[0, 0], [0.04, 1], [0.4, 0]])), 0.62, 0.55);
  add(st, mul(osc("sine", (t) => 260 - 140 * Math.min(1, t / 0.3), 0.35), env(0.35, [[0, 0], [0.02, 0.5], [0.35, 0]])), 0.62, 0.25);
  return reverb(st, { wet: 0.15, tail: 0.4 });
}

/** Dead spin: nothing landed. Weight grows with the heat (1–3). */
function dead(heat) {
  const d = 1.6;
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  const w = 0.75 + heat * 0.12;
  add(st, saturate(mul(osc("sine", (t) => 36 + 70 * Math.exp(-t / 0.06), d), decay(d, 0.35, 0.002)), 1.8), 0, 0.85 * w);
  // sour minor-2nd rub falling away
  for (const [f, p] of [[233.08, -0.3], [246.94, 0.3]]) {
    add(st, mul(lp(osc("saw", (t) => f * (1 - 0.18 * Math.min(1, t / 0.6)), d), 1400), env(d, [[0, 0], [0.03, 1], [0.8, 0.3], [1.3, 0]])), 0.02, 0.07 * w, p);
  }
  if (heat >= 2) {  // a siren "whoop" — the cops are gaining
    add(st, mul(lp(osc("saw", (t) => 600 + 500 * Math.sin(Math.PI * Math.min(1, t / 0.45)), 0.5), 2200), env(0.5, [[0, 0], [0.05, 1], [0.5, 0]])), 0.15, 0.1, 0.4);
  }
  if (heat >= 3) {  // heavy hit
    add(st, mul(bp(noise(0.3, "white", 240), 400, 0.8), decay(0.3, 0.06, 0.001)), 0, 0.5);
  }
  return reverb(st, { room: 0.8, wet: 0.22, tail: 0.8 });
}

/** A lock landed: the spins are held — short confident two-note confirm. */
function held() {
  const d = 0.9;
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  for (const [s, at] of [[7, 0], [12, 0.09]]) {
    add(st, mul(osc("tri", note(s), d), env(d, [[0, 0], [0.008, 1], [d, 0]], "lin")), at, 0.13, at ? 0.2 : -0.2);
    add(st, modal(d, [{ f: note(s) * 2, amp: 0.2, decay: 0.3 }], { seed: 250 + at * 100 }), at, 0.3);
  }
  return reverb(st, { wet: 0.25, tail: 0.6 });
}

/** A spin is spent: a heavy counter "ka-chunk". */
function tick() {
  const d = 0.45;
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  add(st, mul(bp(noise(d, "white", 260), 1400, 2.2), decay(d, 0.012)), 0, 0.6);
  add(st, mul(bp(noise(d, "white", 261), 900, 2.2), decay(d, 0.015)), 0.07, 0.55);
  add(st, mul(osc("sine", (t) => 90 - 30 * t / d, d), decay(d, 0.09, 0.001)), 0.07, 0.6);
  return reverb(st, { wet: 0.12, tail: 0.3 });
}

/** One spin left: a short two-tone police alarm stab over a low hit. */
function lastSpin() {
  const d = 1.2;
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  for (let k = 0; k < 4; k++) {
    const f = k % 2 ? 740 : 988;
    add(st, mul(lp(osc("square", f, 0.16), 2600), env(0.16, [[0, 0], [0.01, 1], [0.14, 0.8], [0.16, 0]])), k * 0.16, 0.07, k % 2 ? 0.3 : -0.3);
  }
  add(st, saturate(mul(osc("sine", (t) => 40 + 50 * Math.exp(-t / 0.05), d), decay(d, 0.3, 0.002)), 1.6), 0, 0.7);
  return reverb(st, { room: 0.8, wet: 0.25, tail: 0.6 });
}

// ── result stage ───────────────────────────────────────────────────────────
function brassChord(root, d, level) {
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  for (const [ratio, p] of [[1, 0], [1.5, -0.35], [2, 0.35], [2.52, 0]]) {
    const f = root * ratio;
    const v = biquad(supersawNote(f, d, 0.06, 4), "lp", (t) => 600 + 2600 * Math.exp(-t / 0.25) + 400 * level, 1.2);
    add(st, mul(v, env(d, [[0, 0], [0.03, 1], [d * 0.5, 0.6], [d, 0]])), 0, 0.2, p);
  }
  add(st, saturate(mul(osc("sine", (t) => 40 + 50 * Math.exp(-t / 0.05), d), decay(d, 0.3, 0.002)), 1.6), 0, 0.6);
  return st;
}
function resultOpen() {
  const d = 2;
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  add(st, saturate(mul(osc("sine", (t) => 30 + 110 * Math.exp(-t / 0.12), d), decay(d, 0.6, 0.003)), 2), 0, 0.9);
  add(st, mul(biquad(noise(0.8, "white", 300), "bp", (t) => 500 + 6000 * t / 0.8, 1), env(0.8, [[0, 0], [0.6, 1], [0.8, 0]])), 0, 0.2);
  [0, 4, 7, 12, 16].forEach((s, i) => add(st, mul(osc("tri", note(s - 9), d), env(d, [[0, 0], [0.02, 1], [d, 0]], "lin")), 0.05 + i * 0.05, 0.08, (i - 2) * 0.2));
  return reverb(st, { room: 0.9, wet: 0.35, tail: 1 });
}
function resultTick() {
  const d = 0.25;
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  add(st, modal(d, [{ f: 1046.5, amp: 0.4, decay: 0.06 }, { f: 1046.5 * 3.93, amp: 0.12, decay: 0.03 }], { seed: 310 }), 0, 0.8);
  add(st, mul(bp(noise(d, "white", 311), 4000, 2), decay(d, 0.004)), 0, 0.25);
  return st;
}
function resultTier(level) {
  const d = 1.1 + level * 0.15;
  const root = [174.61, 220, 261.63, 349.23][level];
  const st = brassChord(root, d, level);
  add(st, mul(biquad(noise(0.5, "white", 320 + level), "bp", (t) => 1800 + 6000 * t / 0.5, 0.9), env(0.5, [[0, 0], [0.3, 1], [0.5, 0]])), 0, 0.12);
  return reverb(st, { room: 0.85, wet: 0.3, tail: 0.9 });
}
function resultEnd() {
  const d = 2.4;
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  [0, 4, 7, 12, 16, 19].forEach((s, i) => add(st, mul(osc("tri", note(s - 9), d), env(d, [[0, 0], [0.02, 1], [d, 0]], "lin")), i * 0.03, 0.08, (i - 2.5) * 0.2));
  add(st, brassChord(note(-21), 1.2, 1), 0, 0.8);
  add(st, modal(d, [{ f: 2093, amp: 0.2, decay: 0.9 }, { f: 2637, amp: 0.14, decay: 0.8 }], { seed: 330 }), 0.05, 0.4);
  return reverb(st, { room: 0.9, wet: 0.35, tail: 1.2 });
}
function resultExit() {
  const d = 0.8;
  const st = stereo(d + 2.5); // room to ring out; the silent tail is trimmed on write
  add(st, mul(biquad(noise(d, "pink", 340), "lp", (t) => 6000 * Math.exp(-t / 0.18) + 200, 1), env(d, [[0, 0], [0.04, 1], [d, 0]])), 0, 0.5);
  add(st, mul(osc("sine", (t) => 100 - 60 * t / d, d), decay(d, 0.2, 0.002)), 0, 0.5);
  return reverb(st, { wet: 0.2, tail: 0.4 });
}

// ── build ──────────────────────────────────────────────────────────────────
const SFX = {
  door, spin_start: spinStart, column_stop: columnStop,
  bar_land_0: () => barLand(0), bar_land_1: () => barLand(1), bar_land_2: () => barLand(2),
  bar_land_3: () => barLand(3), bar_land_4: () => barLand(4), bar_big: barBig,
  dynamite_land: dynamiteLand, fuse, boom, double: doubleHit, dud,
  dead_1: () => dead(1), dead_2: () => dead(2), dead_3: () => dead(3),
  held, tick, last_spin: lastSpin,
  result_open: resultOpen, result_tick: resultTick,
  result_tier_0: () => resultTier(0), result_tier_1: () => resultTier(1),
  result_tier_2: () => resultTier(2), result_tier_3: () => resultTier(3),
  result_end: resultEnd, result_exit: resultExit,
};
const LOOPS = { music_main: renderMusicMain, music_tension: renderMusicTension };

function write(name, st, { loop = false } = {}) {
  const wav = path.join(TMP, `${name}.wav`);
  const mp3 = path.join(OUT, `${name}.mp3`);
  let out = st;
  if (!loop) out = fades(trimTail(normalize(limit(st, -1.5), -1.5), -60, 0.03), 0.001, 0.04);
  // loops are mastered inside middlePass (continuous across the join)
  writeWav(wav, out);
  if (process.env.KEEP_WAV) fs.copyFileSync(wav, path.join(process.env.KEEP_WAV, `${name}.wav`));
  encodeMp3(wav, mp3);
  const L = loudness(mp3);
  const kb = fs.statSync(mp3).size / 1024;
  console.log(`${name.padEnd(16)} ${(out[0].length / SR).toFixed(2)}s  ${kb.toFixed(0).padStart(4)} KB  ${L.lufs.toFixed(1)} LUFS  peak ${L.truePeak.toFixed(1)} dBTP`);
  return { seconds: out[0].length / SR, lufs: L.lufs };
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2);
  const manifestFile = path.join(OUT, "manifest.json");
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : {};
  for (const [name, fn] of Object.entries(LOOPS)) {
    if (only.length && !only.includes(name)) continue;
    const info = write(name, fn(), { loop: true });
    manifest[name] = { loop: LOOP, bpm: BPM, lufs: info.lufs };
  }
  for (const [name, fn] of Object.entries(SFX)) {
    if (only.length && !only.includes(name)) continue;
    const info = write(name, fn());
    manifest[name] = { seconds: +info.seconds.toFixed(3), lufs: info.lufs };
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
  fs.rmSync(TMP, { recursive: true, force: true });
}

main();
