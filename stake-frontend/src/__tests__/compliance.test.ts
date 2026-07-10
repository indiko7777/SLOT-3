import { describe, expect, it } from "vitest";
import { displayCurrency, uiStrings } from "../domain";
import { formatBalance, formatWin } from "../rgs/client";
import { parseLaunch } from "../rgs/session";

describe("win/balance display precision", () => {
  it("balance is always exactly 2 decimals", () => {
    expect(formatBalance(1000)).toBe("1000.00");
    expect(formatBalance(0.009)).toBe("0.01");
  });

  it("wins show up to 4 decimals, TRUNCATED not rounded", () => {
    expect(formatWin(0.009)).toBe("0.009");
    expect(formatWin(0.0024)).toBe("0.0024");
    expect(formatWin(1234.56789)).toBe("1234.5678"); // truncated
    expect(formatWin(5)).toBe("5");
    expect(formatWin(0.99999)).toBe("0.9999"); // never rounds up
  });
});

describe("social currency display", () => {
  it("maps XGC/XSC to GC/SC and passes other codes through", () => {
    expect(displayCurrency("XGC")).toBe("GC");
    expect(displayCurrency("XSC")).toBe("SC");
    expect(displayCurrency("USD")).toBe("USD");
    expect(displayCurrency("JPY")).toBe("JPY");
  });
});

describe("social terminology", () => {
  it("social strings never contain bet/buy", () => {
    const social = uiStrings(true);
    for (const [key, value] of Object.entries(social)) {
      expect(value, `social string ${key}`).not.toMatch(/\b(bet|buy)/i);
    }
  });

  it("stake.us translation requirements", () => {
    const social = uiStrings(true);
    expect(social.baseBetLabel).toBe("Base Play");
    expect(social.costMultLabel).toBe("Feature Multiplier");
    expect(social.finalMultLabel).toBe("Final Multiplier");
    expect(social.betLabel).toBe("Play");
  });
});

describe("launch parsing", () => {
  const parse = (qs: string, isDev = false) =>
    parseLaunch(new URLSearchParams(qs), "game.example.com", isDev);

  it("uses the rgs_url query parameter for the API base", () => {
    const s = parse("sessionID=abc&rgs_url=rgs.custom-host.io&lang=en&currency=EUR");
    expect(s.rgsBase).toBe("https://rgs.custom-host.io");
    expect(s.sessionID).toBe("abc");
    expect(s.currencyHint).toBe("EUR");
  });

  it("throws without sessionID/rgs_url in production (non-replay)", () => {
    expect(() => parse("lang=en")).toThrow();
  });

  it("parses replay parameters including mode, amount, currency and language", () => {
    const s = parse(
      "replay=true&event=52615&mode=super_getaway&amount=2.5&currency=EUR&lang=de&rgs_url=rgs.example.com&sessionID=r1"
    );
    expect(s.isReplayMode).toBe(true);
    expect(s.replayEvent).toBe("52615");
    expect(s.replayMode).toBe("super_getaway");
    expect(s.replayAmount).toBe(2.5);
    expect(s.currencyHint).toBe("EUR");
    expect(s.lang).toBe("de");
  });

  it("invalid/unknown language parameters never break parsing", () => {
    const s = parse("sessionID=a&rgs_url=r.example.com&lang=zz-INVALID");
    expect(s.lang).toBe("zz-invalid"); // normalised, game text stays English
    const s2 = parse("sessionID=a&rgs_url=r.example.com&lang=br");
    expect(s2.lang).toBe("pt");
  });
});
