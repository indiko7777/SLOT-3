import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BIG_BAR_X, GETAWAY_SAMPLES, GetawaySound, MUSIC_LOOP_SECONDS, barVoice, loopPoints, type GetawayCue,
} from "../audio/GetawaySound";

afterEach(() => vi.unstubAllGlobals());

describe("Getaway sound set", () => {
  it("ships every sample the game loads", () => {
    const dir = path.resolve(__dirname, "../../public/assets/audio/getaway");
    for (const name of GETAWAY_SAMPLES) {
      expect(fs.existsSync(path.join(dir, `${name}.mp3`)), name).toBe(true);
    }
  });

  it("finds the loop inside a decoded buffer, skipping decoder lead-in silence", () => {
    const sr = 48000;
    const buf = (lead: number, seconds: number) => {
      const data = new Float32Array(lead + Math.round(seconds * sr)).fill(0.2);
      data.fill(0, 0, lead);
      return { sampleRate: sr, numberOfChannels: 2, duration: data.length / sr, getChannelData: () => data };
    };
    expect(loopPoints(buf(0, MUSIC_LOOP_SECONDS))).toEqual({ start: 0, end: MUSIC_LOOP_SECONDS });
    const padded = loopPoints(buf(1105, MUSIC_LOOP_SECONDS + 0.05));
    expect(padded.start).toBeCloseTo(1105 / sr, 6);
    expect(padded.end - padded.start).toBeCloseTo(MUSIC_LOOP_SECONDS, 6);
    const short = loopPoints(buf(0, 14.9));
    expect(short.end).toBeCloseTo(14.9, 6);
  });

  it("climbs a scale bar by bar, then an octave up", () => {
    expect([0, 1, 2, 3, 4].map((i) => barVoice(i).sample)).toEqual(["bar_land_0", "bar_land_1", "bar_land_2", "bar_land_3", "bar_land_4"]);
    expect(barVoice(0).rate).toBe(1);
    expect(barVoice(5)).toEqual({ sample: "bar_land_0", rate: 2 });
    expect(barVoice(12).rate).toBe(2);
  });
});

function audioSetup(names: readonly string[] = GETAWAY_SAMPLES) {
  const param = (value = 1) => ({ value, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() });
  const sources: any[] = [];
  const ctx = {
    currentTime: 3,
    sampleRate: 48000,
    createBufferSource: () => {
      const s = { buffer: null as any, connect: vi.fn((n) => n), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), playbackRate: param(), loop: false, loopStart: 0, loopEnd: 0, onended: null };
      sources.push(s);
      return s;
    },
    createGain: () => ({ gain: param(), connect: vi.fn((n) => n), disconnect: vi.fn() }),
    createStereoPanner: () => ({ pan: param(0), connect: vi.fn((n) => n), disconnect: vi.fn() }),
  };
  const buffers = new Map(names.map((n) => {
    const data = new Float32Array(16).fill(0.1);
    return [n, { name: n, duration: n.startsWith("music") ? MUSIC_LOOP_SECONDS : 2, sampleRate: 48000, numberOfChannels: 2, getChannelData: () => data }];
  }));
  vi.stubGlobal("window", { setTimeout: vi.fn() });
  const sound = new GetawaySound(ctx as unknown as AudioContext, {} as AudioNode, buffers as unknown as Map<string, AudioBuffer>);
  const played = () => sources.map((s) => s.buffer?.name);
  return { sound, sources, played };
}

describe("Getaway cues", () => {
  it("every gold bar sounds; big bars add the heavy layer", () => {
    const { sound, played } = audioSetup();
    sound.cue({ kind: "bar", index: 0, value: 2 }, false);
    sound.cue({ kind: "bar", index: 1, value: BIG_BAR_X }, false);
    expect(played()).toEqual(["bar_land_0", "bar_land_1", "bar_big"]);
  });

  it("each cue in a Getaway has a sound", () => {
    const cues: GetawayCue[] = [
      { kind: "spin_start" }, { kind: "column_stop", col: 2 }, { kind: "dynamite" },
      { kind: "fuse", seconds: 0.64 }, { kind: "boom", power: 1 }, { kind: "double", index: 0 },
      { kind: "dud" }, { kind: "held" }, { kind: "spent", spinsLeft: 3 }, { kind: "dead", heat: 2 },
    ];
    const { sound, played } = audioSetup();
    cues.forEach((c) => sound.cue(c, false));
    expect(played()).toEqual(["spin_start", "column_stop", "dynamite_land", "fuse", "boom", "double", "dud", "held", "tick", "dead_2"]);
  });

  it("warns on the last spin, and each doubled bar rings higher", () => {
    const { sound, sources, played } = audioSetup();
    sound.cue({ kind: "spent", spinsLeft: 1 }, false);
    expect(played()).toEqual(["tick", "last_spin"]);
    sound.cue({ kind: "double", index: 0 }, false);
    sound.cue({ kind: "double", index: 1 }, false);
    expect(sources[3].playbackRate.value).toBeGreaterThan(sources[2].playbackRate.value);
  });

  it("runs one sample-locked music + tension pair, and the heat brings the tension in", () => {
    const { sound, sources } = audioSetup();
    sound.startMusic();
    sound.startMusic();
    expect(sources).toHaveLength(2);
    const [main, tension] = sources;
    expect(main.loop && tension.loop).toBe(true);
    expect(main.start.mock.calls[0]).toEqual(tension.start.mock.calls[0]);
    expect(main.loopEnd - main.loopStart).toBeCloseTo(MUSIC_LOOP_SECONDS);
    // tension gain is the second gain created after the music bus
    sound.setHeat(3);
    sound.stopMusic(0.5);
    expect(main.stop).toHaveBeenCalled();
    expect(tension.stop).toHaveBeenCalled();
    expect(sound.musicPlaying).toBe(false);
  });

  it("stays silent (falls back) for a sample that did not load", () => {
    const { sound, sources } = audioSetup(["music_main"]);
    expect(sound.play("boom")).toBe(false);
    expect(sources).toHaveLength(0);
  });
});
