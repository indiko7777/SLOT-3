import {
  GRID_COLUMNS,
  GRID_ROWS,
  MAX_WIN_MULTIPLIER,
  type BetMode,
  type Board,
  type BonusCell,
  type GameEvent,
  type Position,
  type RoundRecord,
  type SymbolId
} from "./domain";
import {
  BASEBIG_THRESHOLD,
  BONUS_CELLS,
  BONUS_RESPINS,
  CLUSTER_PAY,
  cascadeMultiplier,
  clusterSizeFactor,
  type Criteria,
  LOW_SYMBOLS,
  MAX_BONUS_SPINS,
  MAX_TUMBLES,
  MODES,
  PAYABLE_SYMBOLS,
  PAYOUT_QUANTUM_X,
  SCATTER_TRIGGER_COUNT,
  SCATTER_TRIGGER_SHARE
} from "./model";
import { Rng } from "./rng";

const WILD: SymbolId = "CAR_WILD";
const WILDS = new Set<SymbolId>(["CAR_WILD", "WILD"]);
const SCATTER: SymbolId = "PHONE_SCATTER";

interface Cluster {
  symbol: SymbolId;
  positions: Position[];
  payout: number;
}

/** Quantize a multiplier to Stake's 0.1x grid (payout %% 10 == 0 in hundredths). */
export function quantize(x: number): number {
  const q = Math.round(x / PAYOUT_QUANTUM_X) * PAYOUT_QUANTUM_X;
  return Number(q.toFixed(1));
}

export interface SimResult {
  record: RoundRecord;
  criteria: Criteria;
}

export function simulateRound(
  mode: BetMode,
  criteria: Criteria,
  seed: number,
  id: number
): SimResult {
  const cfg = MODES[mode];
  const rng = new Rng(seed);
  const events: GameEvent[] = [];

  const forceBonus = criteria === "freegame" || criteria === "wincap";
  const forceWincap = criteria === "wincap";

  // Collection head-start: a tier-N table reaches the 5★ Getaway after a SHORTER
  // climb (the client pre-lights the first N stars). RTP-safe — the optimizer
  // reweights every mode to exactly 96% regardless of the natural trigger rate;
  // this only makes the served tier books reflect the shorter, head-started run.
  const headStart = cfg.headStart ?? 0;
  const triggerHeat = Math.max(1, 5 - headStart);

  events.push({
    type: "round_start",
    mode,
    boardSeedLabel: `${mode}-${criteria}-${id}`,
    turboProfile: "normal"
  });

  // For a forced bonus in a CASH mode, decide the trigger TYPE up front: a rare
  // scatter land, or (the default, ~85%) the WANTED path — a deep cascade forced
  // to climb to Heat 5 so the book genuinely triggers via the stars. BUY modes
  // are a purchased Getaway: straight to the bonus, no Wanted climb / base run.
  const isCash = !cfg.isBuyBonus;
  const forceScatter = forceBonus && isCash && rng.bool(SCATTER_TRIGGER_SHARE);
  const forceDeep = forceBonus && isCash && !forceScatter;

  let board = genBoard(rng, mode);
  if (criteria === "zero") scrubWins(board, rng);
  if (criteria === "basegame") ensureSeedCluster(board, rng, false);
  if (criteria === "basebig") ensureSeedCluster(board, rng, true);
  if (forceScatter) plantScatters(board, rng, SCATTER_TRIGGER_COUNT);
  else if (forceDeep) ensureSeedCluster(board, rng, true);
  else if (forceBonus) plantScatters(board, rng, SCATTER_TRIGGER_COUNT); // buy: straight to the Getaway
  else capScatters(board, rng, SCATTER_TRIGGER_COUNT - 1);

  events.push({ type: "board_settle", board: cloneBoard(board) });

  const scatterPositions = findSymbol(board, SCATTER);
  if (scatterPositions.length >= 2) {
    events.push({
      type: "scatter_tease",
      count: scatterPositions.length,
      positions: scatterPositions
    });
  }

  // ---- Base game: cluster + tumble + climbing cascade multiplier ----
  // The big win is built by CHAIN LENGTH: every cascade bumps the multiplier
  // one rung (CASCADE_LADDER) and that rung multiplies every win on this
  // cascade. A long chain of modest clusters compounds into the monster win.
  let heat = 0;
  let cascadeIndex = 0;
  let globalMultiplier = cascadeMultiplier(0); // 1
  let winCounter = 0;
  let baseGameWin = 0;

  for (let guard = 0; guard < MAX_TUMBLES; guard++) {
    const clusters = findClusters(board);
    if (clusters.length === 0) break;

    globalMultiplier = cascadeMultiplier(cascadeIndex);

    for (const cluster of clusters) {
      winCounter += 1;
      const baseMultiplier = Number(cluster.payout.toFixed(4));
      const payout = Number((baseMultiplier * globalMultiplier).toFixed(4));
      baseGameWin += payout;
      events.push({
        type: "cluster_win",
        winId: `w${winCounter}`,
        symbol: cluster.symbol,
        positions: cluster.positions,
        baseMultiplier,
        heatLevel: heat,
        appliedGlobalMultiplier: globalMultiplier,
        payout
      });
    }

    const removed = unionPositions(clusters);
    events.push({ type: "tumble_remove", positions: removed });

    const from = heat;
    heat = Math.min(5, heat + 1);
    events.push({ type: "heat_advance", from, to: heat, reason: "win_tumble" });

    // Heat feature unlocks happen as the meter reaches the threshold. Pulled
    // EARLY (transform @2, mega-wild @3) so deep chains — and the 5★ Wanted
    // trigger — are reachable, not a 1-in-thousands event, on this small grid.
    if (from < 2 && heat >= 2) {
      // Transform only the low symbols that SURVIVE this tumble. The just-won
      // cells (in `removed`) are cleared on screen and discarded by gravity
      // below, so transforming them would (a) refill the holes the win just made
      // — the cluster appears to "switch symbol" instead of disappearing — and
      // (b) be meaningless to the result. Excluding them is RTP-neutral: gravity
      // replaces those cells regardless, so the post-tumble board is identical.
      const removedSet = new Set(removed.map(([c, r]) => `${c}:${r}`));
      const positions = findSymbols(board, LOW_SYMBOLS).filter(
        ([c, r]) => !removedSet.has(`${c}:${r}`)
      );
      if (positions.length > 0) {
        for (const [c, r] of positions) board[c]![r] = "CASH";
        events.push({
          type: "heat_transform",
          sourceSymbols: [...LOW_SYMBOLS],
          targetSymbol: "CASH",
          positions,
          board: cloneBoard(board)
        });
      }
    }

    applyGravity(board, removed, rng, mode);
    // Wanted-path coverage: force the fresh drop to contain a cluster so the
    // chain keeps climbing to Heat 5 (the 5★ trigger). Looks like a lucky refill
    // and stops once Heat 5 is reached; representative of a genuine deep chain.
    if (forceDeep && heat < triggerHeat) {
      const sym = (["BRASS", "KNIFE", "PISTOL", "AMMO"] as SymbolId[])[rng.int(4)]!;
      plantBlob(board, rng, sym, 5);
    }
    events.push({ type: "tumble_drop", board: cloneBoard(board) });

    // Mid-chain wild injection fuels a runaway chain. Fires entering Heat 3 AND
    // Heat 4 so each rung can carry the chain one deeper — that's what keeps the
    // 5★ Wanted trigger reachable (not a 1-in-thousands wall) on a 5x4 grid.
    if ((from < 3 && heat >= 3) || (from < 4 && heat >= 4)) {
      const topLeft = placeMegaWild(board, rng);
      events.push({
        type: "mega_wild_place",
        topLeft,
        occupiedPositions: [
          topLeft,
          [topLeft[0] + 1, topLeft[1]],
          [topLeft[0], topLeft[1] + 1],
          [topLeft[0] + 1, topLeft[1] + 1]
        ],
        board: cloneBoard(board)
      });
    }

    // Advance the ladder; surface the new rung so the client can show it climb.
    cascadeIndex += 1;
    const nextMultiplier = cascadeMultiplier(cascadeIndex);
    if (nextMultiplier > globalMultiplier) {
      events.push({
        type: "global_multiplier_apply",
        value: nextMultiplier,
        affectedWinIds: [`w${winCounter + 1}`]
      });
    }
  }

  baseGameWin = Number(baseGameWin.toFixed(4));

  // ---- Bonus: The Getaway Hold & Spin ----
  // Two trigger paths, both fully in-book: (1) the WANTED-LEVEL path — a chain
  // that reaches Heat 5 (a 5-cascade chain) launches the Getaway on this same
  // paid spin (earned, guaranteed, RTP-funded); (2) the classic 3+ scatter land.
  let bonusWin = 0;
  const reachedMaxHeat = heat >= triggerHeat;
  const finalScatters = findSymbol(board, SCATTER);
  const scatterTriggered = finalScatters.length >= SCATTER_TRIGGER_COUNT;
  const triggered = forceBonus || reachedMaxHeat || scatterTriggered;

  if (triggered) {
    const bonusMode = mode === "super_buy" ? "super_getaway" : "getaway";
    // Heat 5 (the Wanted path) takes precedence. Only a genuine 3+ scatter land
    // — with no max-heat chain — highlights scatters; the Wanted path carries no
    // scatter positions so the client can theme it as an earned trigger.
    const viaScatter = scatterTriggered && !reachedMaxHeat;
    const trigPositions = viaScatter ? finalScatters.slice(0, SCATTER_TRIGGER_COUNT) : [];
    events.push({
      type: "bonus_trigger",
      mode: bonusMode,
      scatterPositions: trigPositions
    });
    bonusWin = runHoldAndSpin(events, rng, mode, forceWincap);
  }

  // ---- Settle, quantize, cap ----
  const rawTotal = Number((baseGameWin + bonusWin).toFixed(4));
  const capped = rawTotal >= MAX_WIN_MULTIPLIER;
  const finalX = Math.min(quantize(rawTotal), MAX_WIN_MULTIPLIER);

  scaleEventPayouts(events, rawTotal, finalX);

  events.push({
    type: "round_end",
    payoutMultiplier: finalX,
    capApplied: capped
  });

  const actualCriteria: Criteria =
    finalX >= MAX_WIN_MULTIPLIER
      ? "wincap"
      : triggered
        ? "freegame"
        : finalX >= BASEBIG_THRESHOLD
          ? "basebig"
          : finalX > 0
            ? "basegame"
            : "zero";

  return {
    record: { id, payoutMultiplier: finalX, events },
    criteria: actualCriteria
  };
}

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

function genBoard(rng: Rng, mode: BetMode): Board {
  const weights = MODES[mode].reelWeights;
  const keys = (Object.keys(weights) as SymbolId[]).filter((k) => weights[k] > 0);
  const w = keys.map((k) => weights[k]);
  const board: Board = [];
  for (let c = 0; c < GRID_COLUMNS; c++) {
    const col: SymbolId[] = [];
    for (let r = 0; r < GRID_ROWS; r++) col.push(keys[rng.weightedIndex(w)]!);
    board.push(col);
  }
  return board;
}

function cloneBoard(board: Board): Board {
  return board.map((col) => col.slice());
}

function randomFill(rng: Rng, mode: BetMode): SymbolId {
  const weights = MODES[mode].reelWeights;
  const keys = (Object.keys(weights) as SymbolId[]).filter(
    (k) => weights[k] > 0 && k !== SCATTER
  );
  const w = keys.map((k) => weights[k]);
  return keys[rng.weightedIndex(w)]!;
}

function findSymbol(board: Board, symbol: SymbolId): Position[] {
  const out: Position[] = [];
  for (let c = 0; c < GRID_COLUMNS; c++)
    for (let r = 0; r < GRID_ROWS; r++)
      if (board[c]![r] === symbol) out.push([c, r]);
  return out;
}

function findSymbols(board: Board, symbols: SymbolId[]): Position[] {
  const set = new Set(symbols);
  const out: Position[] = [];
  for (let c = 0; c < GRID_COLUMNS; c++)
    for (let r = 0; r < GRID_ROWS; r++)
      if (set.has(board[c]![r]!)) out.push([c, r]);
  return out;
}

function neighbours([c, r]: Position): Position[] {
  const out: Position[] = [];
  if (c > 0) out.push([c - 1, r]);
  if (c < GRID_COLUMNS - 1) out.push([c + 1, r]);
  if (r > 0) out.push([c, r - 1]);
  if (r < GRID_ROWS - 1) out.push([c, r + 1]);
  return out;
}

/**
 * Cluster pays with wild substitution. For each payable symbol we flood-fill
 * over (symbol | wild) cells, requiring >=1 real symbol and size >= 5. Wilds
 * are "any" and may back multiple symbols; real cells are claimed once, best
 * payout first, so payouts never double-count a concrete symbol cell.
 */
function findClusters(board: Board): Cluster[] {
  const candidates: Cluster[] = [];
  for (const symbol of PAYABLE_SYMBOLS) {
    const match = (p: Position): boolean => {
      const s = board[p[0]]![p[1]]!;
      return s === symbol || WILDS.has(s);
    };
    const seen = new Set<string>();
    for (let c = 0; c < GRID_COLUMNS; c++) {
      for (let r = 0; r < GRID_ROWS; r++) {
        const start: Position = [c, r];
        const key = `${c}:${r}`;
        if (seen.has(key) || !match(start)) continue;
        const comp: Position[] = [];
        const stack: Position[] = [start];
        seen.add(key);
        let realCount = 0;
        while (stack.length) {
          const cur = stack.pop()!;
          comp.push(cur);
          if (board[cur[0]]![cur[1]] === symbol) realCount++;
          for (const nb of neighbours(cur)) {
            const nk = `${nb[0]}:${nb[1]}`;
            if (!seen.has(nk) && match(nb)) {
              seen.add(nk);
              stack.push(nb);
            }
          }
        }
        if (realCount >= 1 && comp.length >= 5) {
          candidates.push({
            symbol,
            positions: comp,
            payout: Number(
              (CLUSTER_PAY[symbol] * clusterSizeFactor(comp.length)).toFixed(4)
            )
          });
        }
      }
    }
  }
  candidates.sort((a, b) => b.payout - a.payout);
  const claimedReal = new Set<string>();
  const wins: Cluster[] = [];
  for (const cand of candidates) {
    const realCells = cand.positions.filter(
      (p) => board[p[0]]![p[1]] === cand.symbol
    );
    if (realCells.some((p) => claimedReal.has(`${p[0]}:${p[1]}`))) continue;
    for (const p of realCells) claimedReal.add(`${p[0]}:${p[1]}`);
    wins.push(cand);
  }
  return wins;
}

function unionPositions(clusters: Cluster[]): Position[] {
  const seen = new Set<string>();
  const out: Position[] = [];
  for (const cl of clusters)
    for (const p of cl.positions) {
      const k = `${p[0]}:${p[1]}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(p);
      }
    }
  return out;
}

/** Gravity: survivors fall to the bottom (high row idx); new fills enter top. */
function applyGravity(
  board: Board,
  removed: Position[],
  rng: Rng,
  mode: BetMode
): void {
  const dead = new Set(removed.map((p) => `${p[0]}:${p[1]}`));
  for (let c = 0; c < GRID_COLUMNS; c++) {
    const survivors: SymbolId[] = [];
    for (let r = 0; r < GRID_ROWS; r++)
      if (!dead.has(`${c}:${r}`)) survivors.push(board[c]![r]!);
    const need = GRID_ROWS - survivors.length;
    const col: SymbolId[] = [];
    for (let i = 0; i < need; i++) col.push(randomFill(rng, mode));
    for (const s of survivors) col.push(s);
    board[c] = col;
  }
}

function placeMegaWild(board: Board, rng: Rng): Position {
  const c = rng.int(GRID_COLUMNS - 1);
  const r = rng.int(GRID_ROWS - 1);
  board[c]![r] = WILD;
  board[c + 1]![r] = WILD;
  board[c]![r + 1] = WILD;
  board[c + 1]![r + 1] = WILD;
  return [c, r];
}

// ---- criteria shaping ----

function scrubWins(board: Board, rng: Rng): void {
  for (let pass = 0; pass < 6; pass++) {
    const clusters = findClusters(board);
    if (clusters.length === 0) return;
    for (const cl of clusters) {
      const [c, r] = cl.positions[rng.int(cl.positions.length)]!;
      const alt = PAYABLE_SYMBOLS.filter((s) => s !== cl.symbol);
      board[c]![r] = alt[rng.int(alt.length)]!;
    }
  }
}

/**
 * Plant a connected blob to seed a base-game win.
 *  - `big=false` (basegame): small low/mid clusters -> frequent, tiny wins that
 *    keep the base hit-rate high and the band mean LOW (so its probability stays
 *    high and dead spins stay down).
 *  - `big=true` (basebig): large premium clusters that clear the basebig
 *    threshold on their own and often kick off a runaway cascade -> the rare,
 *    laddered monster win.
 */
function ensureSeedCluster(board: Board, rng: Rng, big: boolean): void {
  const tier = big
    ? 2 // premium only
    : rng.weightedIndex([42, 46, 12]); // mostly low/mid, rarely premium
  const pool =
    tier === 0
      ? (["BRASS", "KNIFE"] as SymbolId[])
      : tier === 1
        ? (["PISTOL", "AMMO", "DUFFEL"] as SymbolId[])
        : (["CASH", "DIAMOND", "BIKE"] as SymbolId[]);
  const symbol = pool[rng.int(pool.length)]!;
  const size = big ? rng.range(8, 12) : rng.range(5, 6);
  plantBlob(board, rng, symbol, size);
}

/** Stamp a connected `size`-cell blob of `symbol` onto the board (overwrites). */
function plantBlob(board: Board, rng: Rng, symbol: SymbolId, size: number): void {
  const start: Position = [rng.int(GRID_COLUMNS), rng.int(GRID_ROWS)];
  const blob = new Set<string>([`${start[0]}:${start[1]}`]);
  const frontier: Position[] = [start];
  while (blob.size < size && frontier.length) {
    const pick = frontier.splice(rng.int(frontier.length), 1)[0]!;
    for (const nb of rng.shuffle(neighbours(pick))) {
      const k = `${nb[0]}:${nb[1]}`;
      if (!blob.has(k)) {
        blob.add(k);
        frontier.push(nb);
        if (blob.size >= size) break;
      }
    }
  }
  for (const k of blob) {
    const [c, r] = k.split(":").map(Number) as [number, number];
    board[c]![r] = symbol;
  }
}

function plantScatters(board: Board, rng: Rng, count: number): void {
  const spots = rng.shuffle(allPositions());
  for (let i = 0; i < count; i++) {
    const [c, r] = spots[i]!;
    board[c]![r] = SCATTER;
  }
}

function capScatters(board: Board, rng: Rng, max: number): void {
  const found = findSymbol(board, SCATTER);
  for (let i = max; i < found.length; i++) {
    const [c, r] = found[i]!;
    board[c]![r] = PAYABLE_SYMBOLS[rng.int(PAYABLE_SYMBOLS.length)]!;
  }
}

function allPositions(): Position[] {
  const out: Position[] = [];
  for (let c = 0; c < GRID_COLUMNS; c++)
    for (let r = 0; r < GRID_ROWS; r++) out.push([c, r]);
  return out;
}

function defaultScatterPositions(): Position[] {
  return [
    [1, 2],
    [2, 1],
    [4, 0]
  ];
}

// ---------------------------------------------------------------------------
// Hold & Spin bonus
// ---------------------------------------------------------------------------

function runHoldAndSpin(
  events: GameEvent[],
  rng: Rng,
  mode: BetMode,
  forceWincap: boolean
): number {
  const cfg = MODES[mode];
  const grid: BonusCell[][] = Array.from({ length: GRID_COLUMNS }, () =>
    Array.from({ length: GRID_ROWS }, () => ({ symbol: "EMPTY" }) as BonusCell)
  );
  let respins = BONUS_RESPINS;
  let locked = 0;

  const emptyCells = (): Position[] => {
    const out: Position[] = [];
    for (let c = 0; c < GRID_COLUMNS; c++)
      for (let r = 0; r < GRID_ROWS; r++)
        if (grid[c]![r]!.symbol === "EMPTY") out.push([c, r]);
    return out;
  };

  // Landing probability per empty cell; wincap forces a full grid.
  // Tuned LOW for the buy modes so bonuses frequently bust early with only a few
  // bars (real losses), giving the feature genuine high volatility instead of a
  // flat "always ~your-money-back" payout. The fat-tailed safe values then supply
  // the rare big wins. base/ante keep a more generous land rate (you earned it).
  const landP = forceWincap ? 0.62 : mode === "super_buy" ? 0.18 : mode === "buy" ? 0.085 : 0.22;
  const keyP = 0.12;

  let safety = 0;
  while (respins > 0 && locked < BONUS_CELLS && safety++ < MAX_BONUS_SPINS) {
    const respinsBefore = respins;
    const empties = emptyCells();
    const landed: Array<{
      symbol: "SAFE" | "MASTER_KEY";
      position: Position;
      value?: number;
    }> = [];

    for (const [c, r] of empties) {
      if (!rng.bool(landP)) continue;
      if (rng.bool(keyP)) {
        // Dynamite: lands, doubles neighbours, then VACATES its cell (below) so
        // it can be refilled by a gold bar on a later spin. It does NOT count
        // toward filling the grid.
        grid[c]![r] = { symbol: "MASTER_KEY" };
        landed.push({ symbol: "MASTER_KEY", position: [c, r] });
      } else {
        // Gold bar: sticky multiplier, counts toward the 20-cell fill.
        const value = pickWeighted(
          rng,
          cfg.safeValues.map((s) => ({ value: s.value, weight: s.weight }))
        );
        grid[c]![r] = { symbol: "SAFE", value };
        landed.push({ symbol: "SAFE", position: [c, r], value });
        locked += 1;
      }
    }

    respins = landed.length > 0 ? BONUS_RESPINS : respins - 1;

    events.push({
      type: "bonus_spin",
      respinsBefore,
      respinsAfter: respins,
      landedSymbols: landed,
      lockedGrid: cloneGrid(grid)
    });

    for (const l of landed) {
      if (l.symbol === "SAFE")
        events.push({ type: "safe_lock", position: l.position, value: l.value! });
    }

    for (const l of landed) {
      if (l.symbol !== "MASTER_KEY") continue;
      const affected: Array<{
        position: Position;
        oldValue: number;
        newValue: number;
      }> = [];
      for (const nb of neighbours(l.position)) {
        const cell = grid[nb[0]]![nb[1]]!;
        if (cell.symbol === "SAFE" && cell.value) {
          const oldValue = cell.value;
          const newValue = Number((oldValue * 2).toFixed(4));
          grid[nb[0]]![nb[1]] = { symbol: "SAFE", value: newValue };
          affected.push({ position: nb, oldValue, newValue });
        }
      }
      if (affected.length)
        events.push({
          type: "master_key_crack",
          keyPosition: l.position,
          affectedSafes: affected
        });
      // The dynamite is spent — clear its cell so a gold bar can land there later.
      grid[l.position[0]]![l.position[1]] = { symbol: "EMPTY" };
    }
  }

  let total = 0;
  for (let c = 0; c < GRID_COLUMNS; c++)
    for (let r = 0; r < GRID_ROWS; r++) {
      const cell = grid[c]![r]!;
      if (cell.symbol === "SAFE" && cell.value) total += cell.value;
    }
  total = Number(total.toFixed(4));
  const filledScreen = locked >= BONUS_CELLS;
  if (filledScreen && total < MAX_WIN_MULTIPLIER) total = MAX_WIN_MULTIPLIER;

  events.push({ type: "bonus_end", totalPayout: total, filledScreen });
  return total;
}

function cloneGrid(grid: BonusCell[][]): BonusCell[][] {
  return grid.map((col) => col.map((cell) => ({ ...cell })));
}

// ---------------------------------------------------------------------------
// Payout assembly
// ---------------------------------------------------------------------------

/** Scale every payout-bearing event so they sum exactly to the final value. */
function scaleEventPayouts(events: GameEvent[], rawTotal: number, finalX: number): void {
  if (rawTotal <= 0 || finalX <= 0) {
    for (const e of events) {
      if (e.type === "cluster_win") e.payout = 0;
      if (e.type === "bonus_end") e.totalPayout = 0;
    }
    return;
  }
  const k = finalX / rawTotal;
  let running = 0;
  const scalable = events.filter(
    (e): e is Extract<GameEvent, { type: "cluster_win" | "bonus_end" }> =>
      e.type === "cluster_win" || e.type === "bonus_end"
  );
  scalable.forEach((e, i) => {
    const orig = e.type === "cluster_win" ? e.payout : e.totalPayout;
    let scaled = Number((orig * k).toFixed(2));
    if (i === scalable.length - 1) scaled = Number((finalX - running).toFixed(2));
    running = Number((running + scaled).toFixed(2));
    if (e.type === "cluster_win") e.payout = scaled;
    else e.totalPayout = scaled;
  });
}

function pickWeighted(
  rng: Rng,
  table: { value: number; weight: number }[]
): number {
  const idx = rng.weightedIndex(table.map((t) => t.weight));
  return table[idx]!.value;
}
