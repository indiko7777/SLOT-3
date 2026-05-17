import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_WIN_X, RTP_TOLERANCE, TARGET_RTP } from "./model";
import { zstdDecompress } from "./zstd";

interface ModeStats {
  mode: string;
  cost: number;
  rtp: number;
  rtpPct: number;
  rows: number;
  totalWeight: string;
  hitRate: number;
  bonusHitRate: number;
  maxWinRate: number;
  stdDev: number;
  volatilityVsTarget: number;
  maxPayoutX: number;
  booksMatch: boolean;
}

/**
 * Independent verification: recompute every published number straight from
 * the on-disk lookUpTable CSVs (the artifact Stake's RGS itself audits) and
 * confirm books payouts hash-match the CSV. Throws if any mode is outside
 * 0.96 +/- 0.005 or the cross-mode spread exceeds 0.005.
 */
export async function verify(write = true): Promise<ModeStats[]> {
  const root = path.resolve("publish_files");
  const index = JSON.parse(
    await readFile(path.join(root, "index.json"), "utf8")
  ) as { modes: Array<{ name: string; cost: number; events: string; weights: string }> };

  const stats: ModeStats[] = [];

  for (const m of index.modes) {
    // Parse books first: id -> { payout (hundredths), bonus presence }.
    const raw = await readFile(path.join(root, m.events));
    const jsonl = (await zstdDecompress(raw)).toString("utf8");
    const book = new Map<number, { payout: number; bonus: boolean }>();
    for (const l of jsonl.split("\n")) {
      if (!l.trim()) continue;
      const b = JSON.parse(l) as {
        id: number;
        payoutMultiplier: number;
        events: Array<{ type: string }>;
      };
      book.set(b.id, {
        payout: b.payoutMultiplier,
        bonus: b.events.some((e) => e.type === "bonus_trigger")
      });
    }

    const csv = await readFile(path.join(root, m.weights), "utf8");
    const lines = csv.split("\n").filter((l) => l.trim().length > 0);

    let num = 0;
    let den = 0n;
    let hitW = 0n;
    let bonusW = 0n;
    let maxW = 0n;
    let maxPayout = 0;
    let booksMatch = book.size === lines.length;
    for (const line of lines) {
      const parts = line.split(",");
      if (parts.length !== 3)
        throw new Error(`[${m.name}] lookup row must have 3 columns: "${line}"`);
      const id = Number(parts[0]);
      const weight = Number(parts[1]);
      const payout = Number(parts[2]);
      if (!Number.isInteger(id) || !Number.isInteger(weight) || !Number.isInteger(payout))
        throw new Error(`[${m.name}] non-integer lookup row: "${line}"`);
      if (weight < 0 || payout < 0)
        throw new Error(`[${m.name}] negative value: "${line}"`);
      if (payout % 10 !== 0)
        throw new Error(`[${m.name}] payout not %%10: "${line}"`);
      if (payout !== 0 && payout < 10)
        throw new Error(`[${m.name}] non-zero payout < 10: "${line}"`);
      const x = payout / 100;
      num += x * weight;
      den += BigInt(weight);
      if (payout > 0) hitW += BigInt(weight);
      if (x >= MAX_WIN_X) maxW += BigInt(weight);
      if (x > maxPayout) maxPayout = x;
      const bk = book.get(id);
      if (!bk || bk.payout !== payout) booksMatch = false;
      if (bk?.bonus) bonusW += BigInt(weight);
    }
    if (den === 0n) throw new Error(`[${m.name}] zero total weight`);

    const denN = Number(den);
    const mean = num / denN;
    const rtp = mean / m.cost;

    // weighted std of payout multiplier
    let variance = 0;
    for (const line of lines) {
      const [, ws, ps] = line.split(",");
      const w = Number(ws);
      const x = Number(ps) / 100;
      variance += w * (x - mean) ** 2;
    }
    variance /= denN;
    const sd = Math.sqrt(variance) / m.cost;

    stats.push({
      mode: m.name,
      cost: m.cost,
      rtp: Number(rtp.toFixed(6)),
      rtpPct: Number((rtp * 100).toFixed(4)),
      rows: lines.length,
      totalWeight: den.toString(),
      hitRate: Number((Number(hitW) / denN).toFixed(6)),
      bonusHitRate: Number((Number(bonusW) / denN).toFixed(6)),
      maxWinRate: Number((Number(maxW) / denN).toExponential(3)),
      stdDev: Number(sd.toFixed(3)),
      volatilityVsTarget: Number((rtp - TARGET_RTP).toFixed(6)),
      maxPayoutX: maxPayout,
      booksMatch
    });
  }

  // Tolerance gates.
  const problems: string[] = [];
  for (const s of stats) {
    if (Math.abs(s.rtp - TARGET_RTP) > RTP_TOLERANCE)
      problems.push(
        `${s.mode} RTP ${s.rtpPct}% outside ${(TARGET_RTP * 100).toFixed(
          1
        )}% +/- ${(RTP_TOLERANCE * 100).toFixed(1)}`
      );
    if (!s.booksMatch) problems.push(`${s.mode} books/lookup payout mismatch`);
  }
  const rtps = stats.map((s) => s.rtp);
  const spread = Math.max(...rtps) - Math.min(...rtps);
  if (spread > RTP_TOLERANCE)
    problems.push(
      `cross-mode RTP spread ${(spread * 100).toFixed(4)} > ${(
        RTP_TOLERANCE * 100
      ).toFixed(1)}`
    );

  const summary = {
    game: "heat-chase-grand-escape",
    target: { rtp: TARGET_RTP, tolerance: RTP_TOLERANCE },
    crossModeSpread: Number(spread.toFixed(6)),
    pass: problems.length === 0,
    problems,
    modes: stats,
    generatedAt: new Date().toISOString()
  };

  if (write)
    await writeFile(
      path.resolve("stats_summary.json"),
      JSON.stringify(summary, null, 2) + "\n",
      "utf8"
    );

  // Console table.
  for (const s of stats)
    console.log(
      `  ${s.mode.padEnd(10)} RTP ${s.rtpPct.toFixed(4).padStart(8)}%  ` +
        `hit ${(s.hitRate * 100).toFixed(2)}%  bonus ${(
          s.bonusHitRate * 100
        ).toFixed(3)}%  std ${s.stdDev.toFixed(2)}  rows ${s.rows}  ` +
        `books ${s.booksMatch ? "OK" : "MISMATCH"}`
    );
  console.log(
    `  cross-mode spread ${(spread * 100).toFixed(4)} pts  ->  ${
      problems.length === 0 ? "PASS" : "FAIL"
    }`
  );

  if (problems.length) {
    for (const p of problems) console.error(`  ! ${p}`);
    throw new Error(`verification failed: ${problems.join("; ")}`);
  }
  return stats;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  verify().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
