/**
 * Deterministic, seeded PRNG (SplitMix64 -> xoshiro128**).
 *
 * The math engine must be reproducible: a given simulation id always yields
 * the exact same round. Stake's verifier re-derives RTP from the published
 * lookup table, but reproducible books make debugging and replay sane.
 */
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    // SplitMix64-ish expansion of a single integer seed into 128 bits of state.
    let z = (seed >>> 0) || 1;
    const next = (): number => {
      z = (z + 0x9e3779b9) >>> 0;
      let t = z;
      t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
      t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
      return (t ^ (t >>> 15)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    // Discard a few outputs so close seeds diverge quickly.
    for (let i = 0; i < 16; i++) this.nextUint32();
  }

  nextUint32(): number {
    const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;
    const result = Math.imul(rotl((this.s1 * 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** Inclusive integer range [min, max]. */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  bool(probabilityTrue: number): boolean {
    return this.next() < probabilityTrue;
  }

  /** Pick an index from a weight array, proportional to weight. */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let roll = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i]!;
      if (roll < 0) return i;
    }
    return weights.length - 1;
  }

  /** Pick a key from a record of weights. */
  weightedKey<K extends string>(weights: Record<K, number>): K {
    const keys = Object.keys(weights) as K[];
    const idx = this.weightedIndex(keys.map((k) => weights[k]));
    return keys[idx]!;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = items[i]!;
      items[i] = items[j]!;
      items[j] = tmp;
    }
    return items;
  }
}
