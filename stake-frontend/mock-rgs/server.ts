/**
 * Local mock RGS. Speaks the EXACT Stake wallet protocol
 * (/wallet/authenticate, /wallet/play, /wallet/end-round, /bet/event) against
 * the real generated bundle in ../stake-math/publish_files, so local play
 * exercises the same client code path as production.
 *
 *   npm run mock-rgs           (or npm run dev:local for mock + Vite)
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decompress, init } from "@bokuweb/zstd-wasm";

const PORT = Number(process.env.MOCK_RGS_PORT ?? 8787);
const START_BALANCE = Number(process.env.MOCK_BALANCE ?? 1_000_000); // display units
/** MOCK_SOCIAL=1 simulates Stake.US: socialCasino flag + XGC currency, to
 *  verify the restricted-word swaps and GC/SC display locally. */
const SOCIAL = process.env.MOCK_SOCIAL === "1";
const CURRENCY = SOCIAL ? "XGC" : (process.env.MOCK_CURRENCY ?? "USD");
const API = 1_000_000; // 6dp integer money
const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLISH = path.resolve(here, "../../stake-math/publish_files");

interface Row {
  id: number;
  cumWeight: number;
  payoutCents: number;
}
interface ModeData {
  cost: number;
  rows: Row[];
  totalWeight: number;
  /** Decompressed JSONL kept as ONE Buffer (outside the V8 heap) plus per-book
   *  byte offsets. At 100k books/mode the raw JSONL runs to several hundred MB
   *  per mode — far past V8's max string length and too much heap for per-line
   *  strings — so lines are decoded on demand from the Buffer. */
  jsonl: Buffer;
  offsets: Map<number, [start: number, end: number]>;
}

const modes = new Map<string, ModeData>();

const BET_LEVELS = [
  0.2, 0.4, 0.6, 1, 2, 4, 6, 10, 20, 40, 60, 100
].map((v) => Math.round(v * API));

await init();
loadBundle();

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

function loadBundle(): void {
  const index = JSON.parse(
    readFileSync(path.join(PUBLISH, "index.json"), "utf8")
  ) as { modes: Array<{ name: string; cost: number; events: string; weights: string }> };

  for (const m of index.modes) {
    const csv = readFileSync(path.join(PUBLISH, m.weights), "utf8");
    const rows: Row[] = [];
    let cum = 0;
    const payoutById = new Map<number, number>();
    for (const line of csv.split("\n")) {
      if (!line.trim()) continue;
      const [idS, wS, pS] = line.split(",");
      const id = Number(idS);
      const w = Number(wS);
      const p = Number(pS);
      cum += w;
      rows.push({ id, cumWeight: cum, payoutCents: p });
      payoutById.set(id, p);
    }
    const raw = readFileSync(path.join(PUBLISH, m.events));
    const jsonl = Buffer.from(decompress(new Uint8Array(raw)));
    const offsets = new Map<number, [number, number]>();
    let start = 0;
    while (start < jsonl.length) {
      let end = jsonl.indexOf(0x0a, start); // "\n"
      if (end === -1) end = jsonl.length;
      if (end > start) {
        // Book id sits at the line head: {"id":123,... — decode only that bit.
        const head = jsonl.toString("utf8", start, Math.min(start + 32, end));
        const id = Number(head.slice(head.indexOf(":") + 1, head.indexOf(",")));
        if (Number.isFinite(id)) offsets.set(id, [start, end]);
      }
      start = end + 1;
    }
    modes.set(m.name, { cost: m.cost, rows, totalWeight: cum, jsonl, offsets });
    console.log(
      `[mock-rgs] ${m.name}: ${rows.length} books, cost ${m.cost}, ` +
        `weight ${cum.toExponential(3)}`
    );
  }
}

function pick(mode: ModeData): Row {
  const roll = Math.random() * mode.totalWeight;
  let lo = 0;
  let hi = mode.rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (mode.rows[mid]!.cumWeight <= roll) lo = mid + 1;
    else hi = mid;
  }
  return mode.rows[lo]!;
}

function getSession(id: string): Session {
  let s = sessions.get(id);
  if (!s) {
    s = { balanceApi: START_BALANCE * API, pendingWin: 0, active: null };
    sessions.set(id, s);
  }
  return s;
}

const OK = { statusCode: "SUCCESS", statusMessage: "" };

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let payload: Record<string, unknown> = {};
    try {
      payload = body ? JSON.parse(body) : {};
    } catch {
      /* ignore */
    }
    const json = (obj: unknown): void => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    const sid = String(payload.sessionID ?? "anon");
    const s = getSession(sid);

    try {
      if (req.url === "/wallet/authenticate") {
        json({
          status: OK,
          balance: { amount: s.balanceApi, currency: CURRENCY },
          config: {
            minBet: BET_LEVELS[0],
            maxBet: BET_LEVELS[BET_LEVELS.length - 1],
            stepBet: BET_LEVELS[0],
            defaultBetLevel: BET_LEVELS[3],
            betLevels: BET_LEVELS,
            betModes: {
              base: { mode: "base", costMultiplier: cost("base"), feature: false },
              ante: { mode: "ante", costMultiplier: cost("ante"), feature: true },
              getaway: { mode: "getaway", costMultiplier: cost("getaway"), feature: false },
              super_getaway: {
                mode: "super_getaway",
                costMultiplier: cost("super_getaway"),
                feature: false
              },
              // Collection Power-Level head-start tables (client-routed; 1x cost).
              base_tier1: { mode: "base_tier1", costMultiplier: cost("base_tier1"), feature: false },
              base_tier2: { mode: "base_tier2", costMultiplier: cost("base_tier2"), feature: false },
              base_tier3: { mode: "base_tier3", costMultiplier: cost("base_tier3"), feature: false }
            },
            jurisdiction: jurisdiction()
          },
          round: s.active
            ? { ...s.active, active: true, event: null }
            : null,
          error: null
        });
        return;
      }

      if (req.url === "/wallet/play") {
        const mode = modes.get(String(payload.mode));
        if (!mode) {
          json({ status: { statusCode: "ERR_VAL", statusMessage: "bad mode" }, error: "bad mode" });
          return;
        }
        const amount = Number(payload.amount) || 0; // 6dp, base bet
        // Every play is debited — no zero-cost path exists (matches production).
        const debit = Math.round(amount * mode.cost);
        if (debit > s.balanceApi) {
          json({
            status: { statusCode: "ERR_IPB", statusMessage: "insufficient balance" },
            balance: { amount: s.balanceApi, currency: CURRENCY },
            error: "insufficient balance"
          });
          return;
        }
        const row = pick(mode);
        const payoutMultiplier = row.payoutCents / 100;
        const winApi = Math.round((amount * row.payoutCents) / 100);
        s.balanceApi -= debit;
        s.pendingWin = winApi;
        const line = getBookLine(mode, row.id);
        const state = line ? (JSON.parse(line) as { events: unknown[] }).events : [];
        const round = {
          roundID: roundSeq++,
          amount: debit,
          payout: winApi,
          payoutMultiplier,
          mode: String(payload.mode),
          state
        };
        s.active = winApi > 0 ? round : null;
        if (winApi === 0) s.pendingWin = 0; // RGS auto-ends 0-win rounds
        json({
          status: OK,
          balance: { amount: s.balanceApi, currency: CURRENCY },
          round: { ...round, active: winApi > 0, event: null },
          error: null
        });
        return;
      }

      if (req.url === "/wallet/end-round") {
        s.balanceApi += s.pendingWin;
        s.pendingWin = 0;
        s.active = null;
        json({
          status: OK,
          balance: { amount: s.balanceApi, currency: CURRENCY },
          error: null
        });
        return;
      }

      if (req.url === "/bet/event") {
        json({ status: OK, event: String(payload.event ?? ""), error: null });
        return;
      }

      // GET /bet/replay/{game}/{version}/{mode}/{eventId} — serve the exact
      // book so replay URLs work against the local bundle too.
      const replayMatch = (req.url ?? "").match(
        /^\/bet\/replay\/[^/]+\/[^/]+\/([^/]+)\/(\d+)(?:\?.*)?$/
      );
      if (replayMatch) {
        const [, modeName, eventIdS] = replayMatch;
        const mode = modes.get(String(modeName));
        const eventId = Number(eventIdS);
        const line = mode ? getBookLine(mode, eventId) : null;
        if (!mode || !line) {
          json({
            status: { statusCode: "ERR_VAL", statusMessage: "unknown replay event" },
            error: "unknown replay event"
          });
          return;
        }
        const book = JSON.parse(line) as { events: unknown[]; payoutMultiplier: number };
        json({
          status: OK,
          roundID: eventId,
          mode: modeName,
          costMultiplier: mode.cost,
          payoutMultiplier: book.payoutMultiplier / 100,
          state: book.events,
          error: null
        });
        return;
      }

      res.writeHead(404).end();
    } catch (e) {
      json({
        status: { statusCode: "ERR_GE", statusMessage: String(e) },
        error: String(e)
      });
    }
  });
});

function cost(name: string): number {
  return modes.get(name)?.cost ?? 1;
}

/** Decode one book's JSONL line from the mode's Buffer on demand. */
function getBookLine(mode: ModeData, id: number): string | null {
  const span = mode.offsets.get(id);
  if (!span) return null;
  return mode.jsonl.toString("utf8", span[0], span[1]);
}
function jurisdiction(): Record<string, unknown> {
  return {
    socialCasino: SOCIAL,
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

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-rgs] listening on http://127.0.0.1:${PORT}`);
  console.log(`[mock-rgs] open the game at http://127.0.0.1:5176/`);
});
