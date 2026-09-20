import { describe, expect, it, vi } from "vitest";
import { GetawayResultSound } from "../audio/GetawayResultSound";

function setup() {
  const param = () => ({ value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
  const voices: any[] = [];
  const channels: any[] = [];
  const ctx = {
    currentTime: 5,
    createGain: () => { const gain = { gain: param(), connect: vi.fn((node) => node), disconnect: vi.fn() }; channels.push(gain); return gain; },
    createOscillator: () => { const node = { frequency: param(), connect: vi.fn((out) => out), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }; voices.push(node); return node; },
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
  it("stops the counting voices when the final chord lands, with a bounded tail", () => {
    const { sound, voices, ctx } = setup();
    sound.start();
    const counting = [...voices];
    sound.end();
    counting.forEach((voice) => expect(voice.stop).toHaveBeenLastCalledWith(ctx.currentTime + 0.015));
    for (const voice of voices.slice(counting.length)) {
      expect(voice.stop.mock.calls.at(-1)[0] - ctx.currentTime).toBeLessThan(0.6);
    }
    const count = voices.length;
    sound.progress(0.75);
    expect(voices).toHaveLength(count);
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
