import {
  compress as zCompress,
  decompress as zDecompress,
  init
} from "@bokuweb/zstd-wasm";

/**
 * zstd-wasm `init()` must run exactly once per process. publish.ts and
 * verify.ts both touch zstd within the same `npm run generate` process, so
 * the init is memoized here and shared.
 */
let ready: Promise<void> | null = null;

export function zstdReady(): Promise<void> {
  if (!ready) ready = init();
  return ready;
}

export async function zstdCompress(data: Buffer, level: number): Promise<Buffer> {
  await zstdReady();
  return Buffer.from(zCompress(data, level));
}

export async function zstdDecompress(data: Buffer): Promise<Buffer> {
  await zstdReady();
  return Buffer.from(zDecompress(new Uint8Array(data)));
}
