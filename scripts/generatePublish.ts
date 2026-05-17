import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { compress, init } from "@bokuweb/zstd-wasm";
import { BET_MODES, GAME_ID, type BetMode, validateRoundRecord } from "../src/domain";
import { createFixtureRecords } from "../src/fixtures";

const publishRoot = path.resolve("games", GAME_ID, "library", "publish_files");
const modes: BetMode[] = ["base", "ante", "buy", "super_buy"];

await init();
await mkdir(publishRoot, { recursive: true });

const index = {
  gameId: GAME_ID,
  version: 1,
  generatedAt: new Date("2026-05-12T00:00:00.000Z").toISOString(),
  maxWinMultiplier: 5000,
  modes: {} as Record<BetMode, { label: string; priceMultiplier: number; rtpTarget: number; lookup: string; book: string }>
};

for (const mode of modes) {
  const records = createFixtureRecords(mode);
  records.forEach(validateRoundRecord);

  const lookupFile = `${mode}_lookup.csv`;
  const bookFile = `${mode}_book.jsonl.zst`;
  const jsonl = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  const compressed = compress(Buffer.from(jsonl), 10);
  const csv = [
    "id,weight,payoutMultiplier,mode",
    ...records.map((record, index) => `${record.id},${fixtureWeight(mode, index)},${record.payoutMultiplier},${mode}`)
  ].join("\n");

  await writeFile(path.join(publishRoot, lookupFile), csv + "\n", "utf8");
  await writeFile(path.join(publishRoot, bookFile), Buffer.from(compressed));

  index.modes[mode] = {
    label: BET_MODES[mode].label,
    priceMultiplier: BET_MODES[mode].priceMultiplier,
    rtpTarget: BET_MODES[mode].rtpTarget,
    lookup: lookupFile,
    book: bookFile
  };
}

await writeFile(path.join(publishRoot, "index.json"), JSON.stringify(index, null, 2) + "\n", "utf8");
console.log(`Generated publish files in ${publishRoot}`);

function fixtureWeight(mode: BetMode, index: number): number {
  const byMode: Record<BetMode, number[]> = {
    base: [720000, 260000, 19800, 200],
    ante: [680000, 285000, 34500, 500],
    buy: [0, 0, 99600, 400],
    super_buy: [0, 0, 99000, 1000]
  };
  return byMode[mode][index];
}
