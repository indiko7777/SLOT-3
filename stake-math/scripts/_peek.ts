import { readFile } from "node:fs/promises";
import { zstdDecompress } from "../src/zstd";
const [mode, id] = process.argv.slice(2);
const buf = await zstdDecompress(await readFile(`publish_files/books_${mode}.jsonl.zst`));
const i = buf.indexOf(Buffer.from(`{"id":${id},`));
const j = buf.indexOf(0x0a, i);
const book = JSON.parse(buf.subarray(i, j).toString("utf8"));
console.log("payoutMultiplier", book.payoutMultiplier);
for (const e of book.events) {
  if (e.type === "cluster_win") console.log("cluster", e.symbol, e.positions.length, "base", e.baseMultiplier, "x", e.appliedGlobalMultiplier, "payout", e.payout);
  else if (e.type === "bonus_end" || e.type === "round_end") console.log(e.type, JSON.stringify(e));
  else console.log(e.type);
}
