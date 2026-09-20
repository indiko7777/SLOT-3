import { describe, expect, it, vi } from "vitest";
import { GetawayResultSound } from "../audio/GetawayResultSound";

function setup() {
  const param = () => ({ value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
  const voices: any[] = [];
  const channels: any[] = [];
  // Every scheduled source is registered as the SAME object the sound holds, so
  // a test can read back the onended the sound assigned to it.
  const source = (extra: object) => {
    const node = { connect: vi.fn((out) => out), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), ...extra };
    voices.push(node);
    return node;
  };
  const ctx = {
    currentTime: 5,
    sampleRate: 48000,
    createGain: () => { const gain = { gain: param(), connect: vi.fn((node) => node), disconnect: vi.fn() }; channels.push(gain); return gain; },
    createOscillator: () => source({ frequency: param(), type: "sine" }),
    createBufferSource: () => source({ buffer: null }),
    createBiquadFilter: () => ({ type: "bandpass", frequency: param(), Q: { value: 1 }, connect: vi.fn((out) => out), disconnect: vi.fn() }),
    createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
  };
  const sound = new GetawayResultSound(ctx as unknown as AudioContext, {} as AudioNode);
  return { sound, ctx, voices, channels };
}

describe("Getaway-only result sound", () => {
  it("follows visual progress without duplicating notes at high frame rates", () => {
    const { sound, voices } = setup();
    sound.start();
    expect(voices).toHaveLength(2);
    for (let i = 0; i < 100; i++) sound.progress(0.01);
    expect(voices).toHaveLength(2);
    sound.progress(0.5);
    expect(voices).toHaveLength(4);
    sound.progress(1);
    expect(voices).toHaveLength(4);
  });
  it("layers a tier stinger over the running count instead of restarting it", () => {
    const { sound, voices } = setup();
    sound.start();
    const counting = [...voices];
    sound.tier(2);
    // The counting voices keep playing — only stage() would have stopped them.
    counting.forEach((voice) => expect(voice.stop).toHaveBeenCalledTimes(1));
    expect(voices.length).toBeGreaterThan(counting.length);
    sound.progress(0.5);
    expect(voices.length).toBeGreaterThan(counting.length + 1);
  });
  it("plays no stinger once the stage has been cancelled", () => {
    const { sound, voices } = setup();
    sound.start();
    sound.cancel();
    const after = voices.length;
    sound.tier(3);
    expect(voices).toHaveLength(after);
  });
  it("stops the counting voices when the final chord lands, with a bounded tail", () => {
    const { sound, voices, ctx } = setup();
    sound.start();
    const counting = [...voices];
    sound.end();
    counting.forEach((voice) => expect(voice.stop).toHaveBeenLastCalledWith(ctx.currentTime + 0.015));
    for (const voice of voices.slice(counting.length)) {
      // One resolved chord, never a multi-second jingle over the base game.
      expect(voice.stop.mock.calls.at(-1)[0] - ctx.currentTime).toBeLessThan(1);
    }
    const count = voices.length;
    sound.progress(0.75);
    expect(voices).toHaveLength(count);
  });
  it("keeps the exit whoosh inside the wipe that plays it", () => {
    const { sound, voices, ctx } = setup();
    sound.exit();
    expect(voices.length).toBeGreaterThan(0);
    // The base radio returns when the wipe finishes covering (230 ms in turbo),
    // so a whoosh longer than that would be audibly cut off.
    for (const voice of voices) {
      expect(voice.stop.mock.calls.at(-1)[0] - ctx.currentTime).toBeLessThanOrEqual(0.3);
    }
  });
  it("cancels even future entrance notes on an early skip or dismissal", () => {
    const { sound, voices, channels, ctx } = setup();
    sound.open();
    expect(voices.some((voice) => voice.start.mock.calls[0][0] > ctx.currentTime)).toBe(true);
    sound.cancel();
    sound.cancel();
    voices.forEach((voice) => expect(voice.stop).toHaveBeenLastCalledWith(ctx.currentTime + 0.015));
    expect(channels[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, ctx.currentTime + 0.012);
    voices.forEach((voice) => voice.onended({}));
    expect(channels[0].disconnect).toHaveBeenCalledTimes(1);
  });
});
