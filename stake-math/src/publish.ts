import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { GAME_ID, type BetMode } from "./domain";
import { MAX_WIN_X, MODES, TARGET_RTP } from "./model";
import type { OptimizeResult } from "./optimize";
import type { Sim } from "./simulate";
import { zstdCompress, zstdReady } from "./zstd";

export interface IndexMode {
  name: string;
  cost: number;
  events: string;
  weights: string;
}

const root = path.resolve("publish_files");
const cfgDir = path.resolve("config");
let initialised = false;

async function ensureInit(): Promise<void> {
  if (initialised) return;
  await zstdReady();
  await mkdir(root, { recursive: true });
  await mkdir(cfgDir, { recursive: true });
  initialised = true;
}

/**
 * Write ONE mode's Stake artifacts (so the caller can free sims between
 * modes). Enforces every hard Stake rule:
 *  - lookUpTable CSV: exactly 3 columns, NO header, non-negative integers
 *  - payout (col 3) integer hundredths, %% 10 == 0, non-zero >= 10
 *  - book.payoutMultiplier == lookup col 3 EXACTLY
 *  - sum of weights <= 2^64 - 1
 */
export async function publishMode(
  mode: BetMode,
  sims: Sim[],
  opt: OptimizeResult
): Promise<{ index: IndexMode; shelf: unknown }> {
  await ensureInit();
  const byId = new Map(sims.map((s) => [s.id, s]));
  const rows = [...opt.weighted].sort((a, b) => a.id - b.id);

  let weightSum = 0n;
  const csv: string[] = [];
  const books: string[] = [];
  for (const r of rows) {
    if (!Number.isInteger(r.weight) || r.weight < 0)
      throw new Error(`[${mode}] bad weight ${r.weight} (sim ${r.id})`);
    if (!Number.isInteger(r.payoutCents) || r.payoutCents < 0)
      throw new Error(`[${mode}] bad payout ${r.payoutCents} (sim ${r.id})`);
    if (r.payoutCents % 10 !== 0)
      throw new Error(`[${mode}] payout ${r.payoutCents} not %%10 (sim ${r.id})`);
    if (r.payoutCents !== 0 && r.payoutCents < 10)
      throw new Error(`[${mode}] non-zero payout < 10 (sim ${r.id})`);
    weightSum += BigInt(r.weight);
    csv.push(`${r.id},${r.weight},${r.payoutCents}`);
    books.push(
      JSON.stringify({
        id: r.id,
        events: byId.get(r.id)!.record.events,
        payoutMultiplier: r.payoutCents
      })
    );
  }
  if (weightSum >= 1n << 64n)
    throw new Error(`[${mode}] weight sum exceeds uint64`);

  const booksFile = `books_${mode}.jsonl.zst`;
  const weightsFile = `lookUpTable_${mode}_0.csv`;
  const csvText = csv.join("\n") + "\n";
  const compressed = await zstdCompress(
    Buffer.from(books.join("\n") + "\n", "utf8"),
    10
  );

  await writeFile(path.join(root, weightsFile), csvText, "utf8");
  await writeFile(path.join(root, booksFile), compressed);

  return {
    index: { name: mode, cost: MODES[mode].cost, events: booksFile, weights: weightsFile },
    shelf: {
      name: mode,
      tables: [{ file: weightsFile, sha256: sha256(csvText) }],
      cost: MODES[mode].cost,
      rtp: Number(opt.rtp.toFixed(6)),
      bookLength: rows.length,
      feature: MODES[mode].isFeature,
      autoEndRoundDisabled: false,
      buyBonus: MODES[mode].isBuyBonus,
      maxWin: MAX_WIN_X,
      booksFile: { file: booksFile, sha256: sha256Buf(compressed) },
      forceFile: { file: "force.json", sha256: "" }
    }
  };
}

export async function writeManifest(
  modes: IndexMode[],
  shelf: unknown[]
): Promise<void> {
  await ensureInit();
  await writeFile(
    path.join(root, "index.json"),
    JSON.stringify({ modes }, null, 2) + "\n",
    "utf8"
  );
  const force = "{}\n";
  await writeFile(path.join(cfgDir, "force.json"), force, "utf8");
  await writeFile(
    path.join(cfgDir, "config.json"),
    JSON.stringify(
      {
        workingName: GAME_ID,
        frontendConfig: { file: "fe_config.json", sha256: "" },
        gameID: GAME_ID,
        rtp: TARGET_RTP * 100,
        betDenomination: 10_000,
        minDenomination: 100,
        providerNumber: 0,
        standardForceFile: { file: "force.json", sha256: sha256(force) },
        bookShelfConfig: shelf
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
function sha256Buf(b: Buffer): string {
  return createHash("sha256").update(b).digest("hex");
}
