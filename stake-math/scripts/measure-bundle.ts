// Weighted per-mode metrics straight from the published bundle (books + lookup):
// RTP, hit rate, Getaway trigger rate, mean bonus payout, full-screen rate and
// std dev — the before/after numbers used when tuning the Hold & Spin.
//   npx tsx scripts/measure-bundle.ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { zstdDecompress } from "../src/zstd";

const root = path.resolve("publish_files");

interface BookInfo {
  bonus: boolean;
  bonusTotal: number; // bonus_end totalPayout (x, post-scale)
  filled: boolean;
}

const index = JSON.parse(await readFile(path.join(root, "index.json"), "utf8")) as {
  modes: Array<{ name: string; cost: number; events: string; weights: string }>;
};

console.log(
  "mode        RTP%      hit%    bonus%   1-in    bonusMean(x)  fullScr/bonus%  std"
);
for (const m of index.modes) {
  const raw = await readFile(path.join(root, m.events));
  const jsonl = (await zstdDecompress(raw)).toString("utf8");
  const book = new Map<number, BookInfo>();
  for (const l of jsonl.split("\n")) {
    if (!l.trim()) continue;
    const b = JSON.parse(l) as {
      id: number;
      events: Array<{ type: string; totalPayout?: number; filledScreen?: boolean }>;
    };
    let bonus = false;
    let bonusTotal = 0;
    let filled = false;
    for (const e of b.events) {
      if (e.type === "bonus_trigger") bonus = true;
      if (e.type === "bonus_end") {
        bonusTotal = e.totalPayout ?? 0;
        filled = e.filledScreen ?? false;
      }
    }
    book.set(b.id, { bonus, bonusTotal, filled });
  }

  const csv = await readFile(path.join(root, m.weights), "utf8");
  let den = 0;
  let num = 0;
  let hitW = 0;
  let bonusW = 0;
  let filledW = 0;
  let bonusPayW = 0;
  const rows: Array<{ w: number; x: number }> = [];
  for (const line of csv.split("\n")) {
    if (!line.trim()) continue;
    const [idS, wS, pS] = line.split(",");
    const id = Number(idS);
    const w = Number(wS);
    const x = Number(pS) / 100;
    const bk = book.get(id)!;
    den += w;
    num += x * w;
    rows.push({ w, x });
    if (x > 0) hitW += w;
    if (bk.bonus) {
      bonusW += w;
      bonusPayW += bk.bonusTotal * w;
      if (bk.filled) filledW += w;
    }
  }
  const mean = num / den;
  let variance = 0;
  for (const r of rows) variance += r.w * (r.x - mean) ** 2;
  const std = Math.sqrt(variance / den) / m.cost;
  const rtp = (mean / m.cost) * 100;
  const bonusRate = bonusW / den;
  console.log(
    `${m.name.padEnd(11)} ${rtp.toFixed(3).padStart(7)} ${((hitW / den) * 100)
      .toFixed(2)
      .padStart(8)} ${(bonusRate * 100).toFixed(3).padStart(8)} ${(bonusRate > 0
      ? Math.round(1 / bonusRate)
      : Infinity
    )
      .toString()
      .padStart(6)} ${(bonusW > 0 ? bonusPayW / bonusW : 0)
      .toFixed(1)
      .padStart(12)} ${(bonusW > 0 ? (filledW / bonusW) * 100 : 0)
      .toFixed(2)
      .padStart(14)} ${std.toFixed(2).padStart(6)}`
  );
}
