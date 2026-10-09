import type { Position } from "../domain";

/**
 * The outline of a cluster: the boundary of the union of its cells, as closed
 * loops of points in board pixels, inset a little and with rounded corners.
 * One contour around the whole cluster replaces per-cell boxes + link lines.
 */

type V = [number, number];

/** Boundary loops in GRID-CORNER units (vertex (i, j) = corner between cells).
 *  Edges run clockwise in screen space, so the cluster is on each edge's right. */
export function clusterLoops(cells: Position[]): V[][] {
  const set = new Set(cells.map(([c, r]) => `${c}:${r}`));
  const has = (c: number, r: number) => set.has(`${c}:${r}`);
  const edges: Array<[V, V]> = [];
  for (const [c, r] of cells) {
    if (!has(c, r - 1)) edges.push([[c, r], [c + 1, r]]);
    if (!has(c + 1, r)) edges.push([[c + 1, r], [c + 1, r + 1]]);
    if (!has(c, r + 1)) edges.push([[c + 1, r + 1], [c, r + 1]]);
    if (!has(c - 1, r)) edges.push([[c, r + 1], [c, r]]);
  }
  const key = (v: V) => `${v[0]},${v[1]}`;
  const out = new Map<string, number[]>();
  edges.forEach((e, i) => {
    const k = key(e[0]);
    const list = out.get(k);
    if (list) list.push(i); else out.set(k, [i]);
  });
  const used = new Array(edges.length).fill(false);
  const loops: V[][] = [];
  for (let start = 0; start < edges.length; start++) {
    if (used[start]) continue;
    const loop: V[] = [];
    let i = start;
    while (!used[i]) {
      used[i] = true;
      const [a, b] = edges[i]!;
      loop.push(a);
      const cand = (out.get(key(b)) ?? []).filter((j) => !used[j]);
      if (!cand.length) break;
      if (cand.length === 1) { i = cand[0]!; continue; }
      // pinch vertex (two cells touching diagonally): take the sharpest right turn
      const d = [b[0] - a[0], b[1] - a[1]];
      i = cand.sort((x, y) => turn(d, edges[x]!) - turn(d, edges[y]!))[0]!;
    }
    loops.push(simplify(loop));
  }
  return loops;
}

/** Right turn = -1, straight = 0, left turn = 1 (screen space, y down). */
function turn(d: number[], e: [V, V]): number {
  const n = [e[1][0] - e[0][0], e[1][1] - e[0][1]];
  const cross = d[0]! * n[1]! - d[1]! * n[0]!;
  return cross > 0 ? -1 : cross < 0 ? 1 : 0;
}

/** Drop vertices in the middle of straight runs. */
function simplify(loop: V[]): V[] {
  const n = loop.length;
  return loop.filter((v, i) => {
    const p = loop[(i - 1 + n) % n]!, q = loop[(i + 1) % n]!;
    return (v[0] - p[0]) * (q[1] - v[1]) - (v[1] - p[1]) * (q[0] - v[0]) !== 0;
  });
}

/**
 * Pixel contour: grid corners → board pixels, inset by `inset` toward the
 * cluster, corners rounded with radius `radius`. Returns flat [x,y,...] loops.
 */
export function clusterContours(
  cells: Position[],
  corner: (i: number, j: number) => { x: number; y: number },
  inset: number,
  radius: number
): number[][] {
  return clusterLoops(cells).map((loop) => {
    const n = loop.length;
    const pts: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < n; k++) {
      const p = loop[(k - 1 + n) % n]!, v = loop[k]!, q = loop[(k + 1) % n]!;
      const d1 = [Math.sign(v[0] - p[0]), Math.sign(v[1] - p[1])];
      const d2 = [Math.sign(q[0] - v[0]), Math.sign(q[1] - v[1])];
      // inward normal of a clockwise edge with direction d is (-d.y, d.x)
      const nx = -d1[1]! - d2[1]!, ny = d1[0]! + d2[0]!;
      const c = corner(v[0], v[1]);
      pts.push({ x: c.x + nx * inset, y: c.y + ny * inset });
    }
    // round every corner
    const flat: number[] = [];
    for (let k = 0; k < n; k++) {
      const p = pts[(k - 1 + n) % n]!, v = pts[k]!, q = pts[(k + 1) % n]!;
      const l1 = Math.hypot(v.x - p.x, v.y - p.y), l2 = Math.hypot(q.x - v.x, q.y - v.y);
      const r = Math.min(radius, l1 / 2, l2 / 2);
      const a = { x: v.x + ((p.x - v.x) / l1) * r, y: v.y + ((p.y - v.y) / l1) * r };
      const b = { x: v.x + ((q.x - v.x) / l2) * r, y: v.y + ((q.y - v.y) / l2) * r };
      const steps = 5;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        // quadratic bezier a → v → b
        const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * v.x + t * t * b.x;
        const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * v.y + t * t * b.y;
        flat.push(x, y);
      }
    }
    return flat;
  });
}

/** Length of a closed flat polyline. */
export function loopLength(flat: number[]): number {
  let L = 0;
  for (let i = 0; i < flat.length; i += 2) {
    const j = (i + 2) % flat.length;
    L += Math.hypot(flat[j]! - flat[i]!, flat[j + 1]! - flat[i + 1]!);
  }
  return L;
}

/** The first `frac` (0..1) of a closed loop, as an OPEN flat polyline. */
export function loopPrefix(flat: number[], frac: number): number[] {
  const total = loopLength(flat);
  let left = total * Math.max(0, Math.min(1, frac));
  const out: number[] = [flat[0]!, flat[1]!];
  for (let i = 0; i < flat.length && left > 0; i += 2) {
    const j = (i + 2) % flat.length;
    const seg = Math.hypot(flat[j]! - flat[i]!, flat[j + 1]! - flat[i + 1]!);
    if (seg <= left) { out.push(flat[j]!, flat[j + 1]!); left -= seg; }
    else {
      const t = left / seg;
      out.push(flat[i]! + (flat[j]! - flat[i]!) * t, flat[i + 1]! + (flat[j + 1]! - flat[i + 1]!) * t);
      left = 0;
    }
  }
  return out;
}

/** Point at fraction `frac` along a closed loop. */
export function loopPoint(flat: number[], frac: number): { x: number; y: number } {
  const p = loopPrefix(flat, frac);
  return { x: p[p.length - 2]!, y: p[p.length - 1]! };
}
