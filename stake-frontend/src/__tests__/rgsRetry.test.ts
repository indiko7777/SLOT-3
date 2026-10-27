import { afterEach, describe, expect, it, vi } from "vitest";
import { RgsClient, RgsError } from "../rgs/client";
import { parseLaunch } from "../rgs/session";

// Engine's RGS drops idle connections: the first POST after a quiet spell can
// fail ("Failed to fetch" or a 503) while the same request a moment later
// succeeds. These cases are what made the live game show its error screen.

const client = () => new RgsClient(parseLaunch(new URLSearchParams("sessionID=s1&rgs_url=rgs.example.com"), "game.example.com", false));
const ok = (body: unknown) => new Response(JSON.stringify(body));
const balance = (amount: number) => ({ amount, currency: "USD" });
const config = { betLevels: [1_000_000], defaultBetLevel: 1_000_000, betModes: {} };
const round = (active: boolean) => ({ roundID: 7, mode: "base", amount: 1_000_000, payoutMultiplier: active ? 2 : 0, active, state: [{ type: "round_end", payoutMultiplier: active ? 2 : 0, capApplied: false }] });
const paths = (m: ReturnType<typeof vi.fn>) => m.mock.calls.map((c) => String(c[0]).replace("https://rgs.example.com", ""));

describe("RGS hiccups", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  async function run<T>(p: Promise<T>): Promise<T> {
    // let the backoff timers elapse without real waiting
    const settled = p.then((v) => ({ v }), (e) => ({ e }));
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(4000);
    const r: any = await settled;
    if ("e" in r) throw r.e;
    return r.v;
  }

  it("retries authenticate after a dropped connection and a 503", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 }))
      .mockResolvedValueOnce(ok({ balance: balance(5_000_000), config, round: null }));
    vi.stubGlobal("fetch", fetchMock);
    const auth = await run(client().authenticate());
    expect(auth.balance.amount).toBe(5_000_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after the backoff when the RGS stays down", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(run(client().authenticate())).rejects.toMatchObject({ code: "ERR_NETWORK" });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("does not retry a definite RGS answer", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "ERR_IS", message: "invalid session" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(run(client().authenticate())).rejects.toMatchObject({ code: "ERR_IS" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-sends a play that never reached the RGS (no round, balance unchanged)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ok({ balance: balance(10_000_000), config, round: null }))
      .mockResolvedValueOnce(ok({ balance: balance(9_000_000), round: round(true) }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await run(client().play(1, "USD", "base", 10));
    expect(res.round.active).toBe(true);
    expect(paths(fetchMock)).toEqual(["/wallet/play", "/wallet/authenticate", "/wallet/play"]);
  });

  it("never re-sends a play that went through: plays the round the RGS holds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ok({ balance: balance(9_000_000), config, round: round(true) }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await run(client().play(1, "USD", "base", 10));
    expect(res.round.roundID).toBe(7);
    expect(res.balance.amount).toBe(9_000_000);
    expect(paths(fetchMock)).toEqual(["/wallet/play", "/wallet/authenticate"]);
  });

  it("reports a play that settled itself as a zero win (balance went down)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Bad Gateway", { status: 502 }))
      .mockResolvedValueOnce(ok({ balance: balance(9_000_000), config, round: null }));
    vi.stubGlobal("fetch", fetchMock);
    const err = await run(client().play(1, "USD", "base", 10)).catch((e) => e);
    expect(err).toBeInstanceOf(RgsError);
    expect(err).toMatchObject({ code: "ERR_SETTLED", balanceAmount: 9_000_000 });
    expect(paths(fetchMock)).toEqual(["/wallet/play", "/wallet/authenticate"]);
  });

  it("does not retry insufficient balance", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(ok({ status: { statusCode: "ERR_IPB", statusMessage: "insufficient balance" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(run(client().play(1, "USD", "base", 0.5))).rejects.toMatchObject({ code: "ERR_IPB" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("end-round: a lost reply is recovered from authenticate", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch")) // ended server-side, reply lost
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "ERR_VAL", message: "no active round" }), { status: 400 }))
      .mockResolvedValueOnce(ok({ balance: balance(12_000_000), config, round: round(false) }));
    vi.stubGlobal("fetch", fetchMock);
    const end = await run(client().endRound());
    expect(end.balance.amount).toBe(12_000_000);
    expect(paths(fetchMock)).toEqual(["/wallet/end-round", "/wallet/end-round", "/wallet/authenticate"]);
  });

  it("end-round: retries a dropped request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(ok({ balance: balance(12_000_000) }));
    vi.stubGlobal("fetch", fetchMock);
    const end = await run(client().endRound());
    expect(end.balance.amount).toBe(12_000_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
