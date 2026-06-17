/**
 * Download Higgsfield generation results into the pipeline working dirs.
 *
 * The agent drives generation via the Higgsfield MCP, collects each result URL,
 * and writes them to tools/asset-pipeline/urls.json as:
 *   [ { "key": "cyan_car_wild.png", "url": "https://...", "type": "image" },
 *     { "key": "safe_win",          "url": "https://...", "type": "video" } ]
 *
 * Images land in raw/symbols/<key>; videos in raw/videos/<key>.mp4.
 *
 *   node tools/asset-pipeline/fetch-generations.mjs
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const URLS = join(HERE, "urls.json");
const RAW_IMG = join(HERE, "raw", "symbols");
const RAW_VID = join(HERE, "raw", "videos");

async function main() {
  const list = JSON.parse(await readFile(URLS, "utf8"));
  await mkdir(RAW_IMG, { recursive: true });
  await mkdir(RAW_VID, { recursive: true });

  for (const { key, url, type } of list) {
    const res = await fetch(url);
    if (!res.ok) { console.error(`✗ ${key}: HTTP ${res.status}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const out = type === "video"
      ? join(RAW_VID, key.endsWith(".mp4") ? key : `${key}.mp4`)
      : join(RAW_IMG, key);
    await writeFile(out, buf);
    console.log(`✓ ${key}  (${(buf.length / 1024).toFixed(0)}KB) → ${out}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
