#!/usr/bin/env node
/**
 * Ship a built symbol bundle to public/assets/skel/<name>/ (Node twin of the
 * ship step in build_all.py): <name>.json copied, packed.png re-encoded as
 * LOSSLESS webp, atlas header rewritten to match.
 *
 *   node semantic/ship.mjs symbols/<name>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load, saveWebp } from "./img.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_SKEL = path.resolve(HERE, "../../../public/assets/skel");

export async function ship(dir) {
  const name = path.basename(dir);
  const dst = path.join(PUBLIC_SKEL, name);
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(dir, `${name}.json`), path.join(dst, `${name}.json`));
  // rig.json "shipLossy": true for sheets built from photographic / scanned
  // art (the cash notes): lossless buys nothing there and costs ~3x the bytes.
  const rigFile = path.join(dir, "rig.json");
  const lossy = fs.existsSync(rigFile) && JSON.parse(fs.readFileSync(rigFile, "utf8")).shipLossy === true;
  await saveWebp(await load(path.join(dir, "packed.png")), path.join(dst, "packed.webp"), !lossy);
  const atlas = fs.readFileSync(path.join(dir, `${name}.atlas`), "utf8").split(/\r?\n/);
  atlas[0] = "packed.webp";
  while (atlas.length && atlas[atlas.length - 1] === "") atlas.pop();
  fs.writeFileSync(path.join(dst, `${name}.atlas`), atlas.join("\n") + "\n");
  const kb = ["json", "atlas"].map((e) => fs.statSync(path.join(dst, `${name}.${e}`)).size)
    .concat(fs.statSync(path.join(dst, "packed.webp")).size).reduce((a, b) => a + b, 0) / 1024;
  console.log(`SHIPPED ${name} -> ${path.relative(process.cwd(), dst)} (${kb.toFixed(1)} KB)`);
}

const self = path.resolve(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  if (!process.argv[2]) { console.error("usage: node ship.mjs symbols/<name>"); process.exit(1); }
  ship(process.argv[2]).catch((e) => { console.error(e.message || e); process.exit(1); });
}
