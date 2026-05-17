import { describe, expect, it } from "vitest";
import { toDisplay } from "../src/rgs/client";
import { parseLaunch } from "../src/rgs/session";
import { API_AMOUNT_MULTIPLIER } from "../src/rgs/types";

const params = (s: string): URLSearchParams => new URLSearchParams(s);

describe("RGS session parsing", () => {
  it("parses a real launch URL and builds an https base", () => {
    const s = parseLaunch(
      params("sessionID=abc&rgs_url=rgs.stake-engine.com&lang=de&device=mobile&currency=eur"),
      "host",
      false
    );
    expect(s.sessionID).toBe("abc");
    expect(s.rgsBase).toBe("https://rgs.stake-engine.com");
    expect(s.lang).toBe("de");
    expect(s.device).toBe("mobile");
    expect(s.currencyHint).toBe("EUR");
    expect(s.isLocal).toBe(false);
  });

  it("remaps br -> pt", () => {
    expect(parseLaunch(params("sessionID=a&rgs_url=x&lang=br"), "h", false).lang).toBe("pt");
  });

  it("throws in production when launch params are missing", () => {
    expect(() => parseLaunch(params(""), "host", false)).toThrow();
  });

  it("falls back to a local mock RGS in dev", () => {
    const s = parseLaunch(params(""), "127.0.0.1", true);
    expect(s.isLocal).toBe(true);
    expect(s.rgsBase).toBe("http://127.0.0.1:8787");
    expect(s.sessionID.length).toBeGreaterThan(0);
  });
});

describe("RGS money conversion", () => {
  it("converts 6dp integer amounts to display units", () => {
    expect(toDisplay(API_AMOUNT_MULTIPLIER)).toBe(1);
    expect(toDisplay(2_500_000)).toBe(2.5);
  });
});
