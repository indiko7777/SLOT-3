/**
 * In-browser mock RGS. Intercepts fetch calls to the MOCK_BASE prefix and
 * serves real outcomes from the static data files in /data/.
 *
 * Activated automatically when session.isLocal is true and the real mock-rgs
 * server is not reachable (e.g. GitHub Pages, any static host).
 */
import { decompress, init as initZstd } from "@bokuweb/zstd-wasm";

export const MOCK_BASE = "/__mock_rgs__";

const API = 1_000_000;
const START_BALANCE = 1_000_000;

const BET_LEVELS = [0.2, 0.4, 0.6, 1, 2, 4, 6, 10, 20, 40, 60, 100].map(
  (v) => Math.round(v * API)
);

interface Row {
  id: number;
  cumWeight: number;
  payoutCents: number;
}
interface ModeData {
  cost: number;
  rows: Row[];
  totalWeight: number;
  events: Map<number, unknown[]>;
}

const modes = new Map<string, ModeData>();
let zstdReady = false;
let loading: Promise<void> | null = null;

interface Session {
  balanceApi: number;
  pendingWin: number;
  active: null | {
    roundID: number;
    mode: string;
    amount: number;
    payout: number;
    payoutMultiplier: number;
    state: unknown[];
  };
}
const sessions = new Map<string, Session>();
let roundSeq = 1;

function getSession(id: string): Session {
  let s = sessions.get(id);
  if (!s) {
    s = { balanceApi: START_BALANCE * API, pendingWin: 0, active: null };
    sessions.set(id, s);
  }
  return s;
}

async function ensureLoaded(): Promise<void> {
  if (modes.size > 0) return;
  if (loading) return loading;
  loading = load();
  return loading;
}

async function load(): Promise<void> {
  if (!zstdReady) {
    await initZstd();
    zstdReady = true;
  }

  const index = (await fetch("data/index.json").then((r) => r.json())) as {
    modes: Array<{ name: string; cost: number; events: string; weights: string }>;
  };

  await Promise.all(
    index.modes.map(async (m) => {
      const [csvText, bookBuf] = await Promise.all([
        fetch(`data/${m.weights}`).then((r) => r.text()),
        fetch(`data/${m.events}`)
          .then((r) => r.arrayBuffer())
          .then((ab) => new Uint8Array(ab))
      ]);

      const rows: Row[] = [];
      let cum = 0;
      for (const line of csvText.split("\n")) {
        if (!line.trim()) continue;
        const [idS, wS, pS] = line.split(",");
        const id = Number(idS);
        const w = Number(wS);
        const p = Number(pS);
        cum += w;
        rows.push({ id, cumWeight: cum, payoutCents: p });
      }

      const jsonl = new TextDecoder().decode(decompress(bookBuf));
      const events = new Map<number, unknown[]>();
      for (const l of jsonl.split("\n")) {
        if (!l.trim()) continue;
        const b = JSON.parse(l) as { id: number; events: unknown[] };
        events.set(b.id, b.events);
      }

      modes.set(m.name, { cost: m.cost, rows, totalWeight: cum, events });
    })
  );
}

function pick(mode: ModeData): Row {
  const roll = Math.random() * mode.totalWeight;
  let lo = 0,
    hi = mode.rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (mode.rows[mid]!.cumWeight <= roll) lo = mid + 1;
    else hi = mid;
  }
  return mode.rows[lo]!;
}

const OK = { statusCode: "SUCCESS", statusMessage: "" };

function cost(name: string): number {
  return modes.get(name)?.cost ?? 1;
}

function jurisdiction(): Record<string, unknown> {
  return {
    socialCasino: false,
    disabledFullscreen: false,
    disabledTurbo: false,
    disabledSuperTurbo: false,
    disabledAutoplay: false,
    disabledSlamstop: false,
    disabledSpacebar: false,
    disabledBuyFeature: false,
    displayNetPosition: false,
    displayRTP: true,
    displaySessionTimer: false,
    minimumRoundDuration: 0
  };
}

async function handle(
  path: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const sid = String(body.sessionID ?? "anon");
  const s = getSession(sid);

  if (path === "/wallet/authenticate") {
    await ensureLoaded();
    return {
      status: OK,
      balance: { amount: s.balanceApi, currency: "USD" },
      config: {
        minBet: BET_LEVELS[0],
        maxBet: BET_LEVELS[BET_LEVELS.length - 1],
        stepBet: BET_LEVELS[0],
        defaultBetLevel: BET_LEVELS[3],
        betLevels: BET_LEVELS,
        betModes: {
          base: { mode: "base", costMultiplier: cost("base"), feature: false },
          ante: { mode: "ante", costMultiplier: cost("ante"), feature: true },
          buy: { mode: "buy", costMultiplier: cost("buy"), feature: false },
          super_buy: {
            mode: "super_buy",
            costMultiplier: cost("super_buy"),
            feature: false
          }
        },
        jurisdiction: jurisdiction()
      },
      round: s.active ? { ...s.active, active: true, event: null } : null,
      error: null
    };
  }

  if (path === "/wallet/play") {
    await ensureLoaded();
    const mode = modes.get(String(body.mode));
    if (!mode)
      return {
        status: { statusCode: "ERR_VAL", statusMessage: "bad mode" },
        error: "bad mode"
      };
    const amount = Number(body.amount) || 0;
    const debit = Math.round(amount * mode.cost);
    if (debit > s.balanceApi)
      return {
        status: { statusCode: "ERR_IPB", statusMessage: "insufficient balance" },
        balance: { amount: s.balanceApi, currency: "USD" },
        error: "insufficient balance"
      };
    const row = pick(mode);
    const payoutMultiplier = row.payoutCents / 100;
    const winApi = Math.round((amount * row.payoutCents) / 100);
    s.balanceApi -= debit;
    s.pendingWin = winApi;
    const round = {
      roundID: roundSeq++,
      amount: debit,
      payout: winApi,
      payoutMultiplier,
      mode: String(body.mode),
      state: mode.events.get(row.id) ?? []
    };
    s.active = winApi > 0 ? round : null;
    if (winApi === 0) s.pendingWin = 0;
    return {
      status: OK,
      balance: { amount: s.balanceApi, currency: "USD" },
      round: { ...round, active: winApi > 0, event: null },
      error: null
    };
  }

  if (path === "/wallet/end-round") {
    s.balanceApi += s.pendingWin;
    s.pendingWin = 0;
    s.active = null;
    return {
      status: OK,
      balance: { amount: s.balanceApi, currency: "USD" },
      error: null
    };
  }

  if (path === "/bet/event") {
    return { status: OK, event: String(body.event ?? ""), error: null };
  }

  return null;
}

/** Monkey-patches window.fetch to intercept MOCK_BASE requests in-process. */
export function installBrowserMockRgs(): void {
  const original = window.fetch.bind(window);
  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url =
      input instanceof Request
        ? input.url
        : typeof input === "string"
          ? input
          : input.toString();

    if (!url.startsWith(MOCK_BASE)) return original(input, init);

    const path = url.slice(MOCK_BASE.length);
    let body: Record<string, unknown> = {};
    try {
      const raw = init?.body;
      if (raw) body = JSON.parse(raw as string) as Record<string, unknown>;
    } catch { /* empty body */ }

    const result = await handle(path, body);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
}
