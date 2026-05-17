import type { Board, BonusCell, BetMode, RoundRecord } from "./domain";

const emptyBonusGrid = (): BonusCell[][] =>
  Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => ({ symbol: "EMPTY" })));

const withBonusCells = (cells: Array<{ column: number; row: number; symbol: "SAFE" | "MASTER_KEY"; value?: number }>): BonusCell[][] => {
  const grid = emptyBonusGrid();
  for (const cell of cells) {
    grid[cell.column][cell.row] = { symbol: cell.symbol, value: cell.value };
  }
  return grid;
};

export const ZERO_WIN_BOARD: Board = [
  ["BRASS", "AMMO", "WATCH", "KNIFE"],
  ["PISTOL", "DUFFEL", "DIAMOND", "AMMO"],
  ["CASH", "KNIFE", "BIKE", "PISTOL"],
  ["WATCH", "BRASS", "AMMO", "DUFFEL"],
  ["DIAMOND", "CASH", "PISTOL", "BIKE"]
];

export const SMALL_WIN_BOARD: Board = [
  ["BRASS", "BRASS", "WATCH", "KNIFE"],
  ["BRASS", "DUFFEL", "DIAMOND", "AMMO"],
  ["BRASS", "KNIFE", "BIKE", "PISTOL"],
  ["WATCH", "BRASS", "AMMO", "DUFFEL"],
  ["DIAMOND", "CASH", "PISTOL", "BIKE"]
];

export const SMALL_WIN_AFTER_DROP: Board = [
  ["PISTOL", "DIAMOND", "WATCH", "KNIFE"],
  ["CASH", "DUFFEL", "DIAMOND", "AMMO"],
  ["AMMO", "KNIFE", "BIKE", "PISTOL"],
  ["BIKE", "WATCH", "AMMO", "DUFFEL"],
  ["DIAMOND", "CASH", "PISTOL", "BIKE"]
];

export const HEAT_START_BOARD: Board = [
  ["BRASS", "BRASS", "WATCH", "KNIFE"],
  ["BRASS", "BRASS", "PHONE_SCATTER", "KNIFE"],
  ["BRASS", "AMMO", "PHONE_SCATTER", "KNIFE"],
  ["WATCH", "DUFFEL", "AMMO", "KNIFE"],
  ["PHONE_SCATTER", "CASH", "KNIFE", "KNIFE"]
];

export const HEAT_AFTER_FIRST: Board = [
  ["PISTOL", "CASH", "WATCH", "KNIFE"],
  ["AMMO", "DUFFEL", "PHONE_SCATTER", "KNIFE"],
  ["CASH", "AMMO", "PHONE_SCATTER", "KNIFE"],
  ["WATCH", "DUFFEL", "AMMO", "KNIFE"],
  ["PHONE_SCATTER", "CASH", "KNIFE", "KNIFE"]
];

export const HEAT_AFTER_TRANSFORM: Board = [
  ["PISTOL", "CASH", "WATCH", "CASH"],
  ["AMMO", "DUFFEL", "PHONE_SCATTER", "CASH"],
  ["CASH", "AMMO", "PHONE_SCATTER", "CASH"],
  ["WATCH", "DUFFEL", "AMMO", "CASH"],
  ["PHONE_SCATTER", "CASH", "CASH", "CASH"]
];

export const HEAT_AFTER_WILD: Board = [
  ["PISTOL", "CASH", "WATCH", "CASH"],
  ["AMMO", "CAR_WILD", "CAR_WILD", "CASH"],
  ["CASH", "CAR_WILD", "CAR_WILD", "CASH"],
  ["WATCH", "DUFFEL", "AMMO", "CASH"],
  ["PHONE_SCATTER", "CASH", "PHONE_SCATTER", "CASH"]
];

export function createFixtureRecords(mode: BetMode = "base"): RoundRecord[] {
  const buyMode = mode === "super_buy" ? "super_getaway" : "getaway";
  const bonusBoost = mode === "super_buy" ? 120 : mode === "buy" ? 45 : 0;

  return [
    {
      id: modeId(mode, 1),
      payoutMultiplier: 0,
      events: [
        { type: "round_start", mode, boardSeedLabel: `${mode}-zero`, turboProfile: "normal" },
        { type: "board_settle", board: ZERO_WIN_BOARD },
        { type: "round_end", payoutMultiplier: 0, capApplied: false }
      ]
    },
    {
      id: modeId(mode, 2),
      payoutMultiplier: 0.8,
      events: [
        { type: "round_start", mode, boardSeedLabel: `${mode}-small`, turboProfile: "normal" },
        { type: "board_settle", board: SMALL_WIN_BOARD },
        {
          type: "cluster_win",
          winId: "w1",
          symbol: "BRASS",
          positions: [
            [0, 0],
            [0, 1],
            [1, 0],
            [2, 0],
            [3, 1]
          ],
          baseMultiplier: 0.8,
          heatLevel: 0,
          appliedGlobalMultiplier: 1,
          payout: 0.8
        },
        {
          type: "tumble_remove",
          positions: [
            [0, 0],
            [0, 1],
            [1, 0],
            [2, 0],
            [3, 1]
          ]
        },
        { type: "heat_advance", from: 0, to: 1, reason: "win_tumble" },
        { type: "tumble_drop", board: SMALL_WIN_AFTER_DROP },
        { type: "round_end", payoutMultiplier: 0.8, capApplied: false }
      ]
    },
    {
      id: modeId(mode, 3),
      payoutMultiplier: Number((188.75 + bonusBoost).toFixed(2)),
      events: [
        { type: "round_start", mode, boardSeedLabel: `${mode}-heat-chain`, turboProfile: "normal" },
        { type: "board_settle", board: HEAT_START_BOARD },
        {
          type: "scatter_tease",
          count: 3,
          positions: [
            [1, 2],
            [2, 2],
            [4, 0]
          ]
        },
        {
          type: "cluster_win",
          winId: "w1",
          symbol: "BRASS",
          positions: [
            [0, 0],
            [0, 1],
            [1, 0],
            [1, 1],
            [2, 0]
          ],
          baseMultiplier: 1.25,
          heatLevel: 0,
          appliedGlobalMultiplier: 1,
          payout: 1.25
        },
        {
          type: "tumble_remove",
          positions: [
            [0, 0],
            [0, 1],
            [1, 0],
            [1, 1],
            [2, 0]
          ]
        },
        { type: "heat_advance", from: 0, to: 1, reason: "win_tumble" },
        { type: "tumble_drop", board: HEAT_AFTER_FIRST },
        {
          type: "cluster_win",
          winId: "w2",
          symbol: "KNIFE",
          positions: [
            [0, 3],
            [1, 3],
            [2, 2],
            [2, 3],
            [3, 3],
            [4, 3]
          ],
          baseMultiplier: 1.8,
          heatLevel: 1,
          appliedGlobalMultiplier: 1,
          payout: 1.8
        },
        {
          type: "tumble_remove",
          positions: [
            [0, 3],
            [1, 3],
            [2, 2],
            [2, 3],
            [3, 3],
            [4, 3]
          ]
        },
        { type: "heat_advance", from: 1, to: 2, reason: "win_tumble" },
        {
          type: "cluster_win",
          winId: "w3",
          symbol: "CASH",
          positions: [
            [0, 1],
            [1, 2],
            [2, 0],
            [4, 1],
            [4, 3]
          ],
          baseMultiplier: 4.2,
          heatLevel: 2,
          appliedGlobalMultiplier: 1,
          payout: 4.2
        },
        { type: "heat_advance", from: 2, to: 3, reason: "win_tumble" },
        {
          type: "heat_transform",
          sourceSymbols: ["BRASS", "KNIFE"],
          targetSymbol: "CASH",
          positions: [
            [0, 3],
            [1, 3],
            [2, 2],
            [2, 3],
            [3, 3],
            [4, 3]
          ],
          board: HEAT_AFTER_TRANSFORM
        },
        {
          type: "cluster_win",
          winId: "w4",
          symbol: "CASH",
          positions: [
            [0, 1],
            [0, 2],
            [1, 2],
            [2, 2],
            [2, 3],
            [3, 3],
            [4, 1],
            [4, 3]
          ],
          baseMultiplier: 9.5,
          heatLevel: 3,
          appliedGlobalMultiplier: 1,
          payout: 9.5
        },
        { type: "heat_advance", from: 3, to: 4, reason: "win_tumble" },
        {
          type: "mega_wild_place",
          topLeft: [1, 1],
          occupiedPositions: [
            [1, 1],
            [1, 2],
            [2, 1],
            [2, 2]
          ],
          board: HEAT_AFTER_WILD
        },
        {
          type: "cluster_win",
          winId: "w5",
          symbol: "CASH",
          positions: [
            [0, 1],
            [1, 1],
            [1, 2],
            [2, 1],
            [2, 2],
            [2, 3],
            [3, 3],
            [4, 1],
            [4, 3]
          ],
          baseMultiplier: 14,
          heatLevel: 4,
          appliedGlobalMultiplier: 1,
          payout: 14
        },
        { type: "heat_advance", from: 4, to: 5, reason: "win_tumble" },
        { type: "global_multiplier_apply", value: 8, affectedWinIds: ["w6"] },
        {
          type: "cluster_win",
          winId: "w6",
          symbol: "CASH",
          positions: [
            [0, 1],
            [0, 2],
            [1, 1],
            [1, 2],
            [2, 1],
            [2, 2],
            [3, 3],
            [4, 1],
            [4, 3]
          ],
          baseMultiplier: 12,
          heatLevel: 5,
          appliedGlobalMultiplier: 8,
          payout: 96
        },
        {
          type: "bonus_trigger",
          mode: buyMode,
          scatterPositions: [
            [1, 2],
            [2, 2],
            [4, 0]
          ]
        },
        {
          type: "bonus_spin",
          respinsBefore: 3,
          respinsAfter: 3,
          landedSymbols: [
            { symbol: "SAFE", position: [0, 0], value: 6 },
            { symbol: "SAFE", position: [2, 1], value: 10 },
            { symbol: "SAFE", position: [4, 2], value: 20 }
          ],
          lockedGrid: withBonusCells([
            { column: 0, row: 0, symbol: "SAFE", value: 6 },
            { column: 2, row: 1, symbol: "SAFE", value: 10 },
            { column: 4, row: 2, symbol: "SAFE", value: 20 }
          ])
        },
        { type: "safe_lock", position: [0, 0], value: 6 },
        { type: "safe_lock", position: [2, 1], value: 10 },
        { type: "safe_lock", position: [4, 2], value: 20 },
        {
          type: "bonus_spin",
          respinsBefore: 3,
          respinsAfter: 3,
          landedSymbols: [{ symbol: "MASTER_KEY", position: [2, 2] }],
          lockedGrid: withBonusCells([
            { column: 0, row: 0, symbol: "SAFE", value: 6 },
            { column: 2, row: 1, symbol: "SAFE", value: 10 },
            { column: 2, row: 2, symbol: "MASTER_KEY" },
            { column: 4, row: 2, symbol: "SAFE", value: 20 }
          ])
        },
        {
          type: "master_key_crack",
          keyPosition: [2, 2],
          affectedSafes: [{ position: [2, 1], oldValue: 10, newValue: 20 }]
        },
        {
          type: "bonus_spin",
          respinsBefore: 3,
          respinsAfter: 2,
          landedSymbols: [],
          lockedGrid: withBonusCells([
            { column: 0, row: 0, symbol: "SAFE", value: 6 },
            { column: 2, row: 1, symbol: "SAFE", value: 20 },
            { column: 2, row: 2, symbol: "MASTER_KEY" },
            { column: 4, row: 2, symbol: "SAFE", value: 20 }
          ])
        },
        {
          type: "bonus_end",
          totalPayout: 62 + bonusBoost,
          filledScreen: false
        },
        {
          type: "round_end",
          payoutMultiplier: Number((188.75 + bonusBoost).toFixed(2)),
          capApplied: false
        }
      ]
    },
    {
      id: modeId(mode, 4),
      payoutMultiplier: 5000,
      events: [
        { type: "round_start", mode, boardSeedLabel: `${mode}-grand`, turboProfile: "normal" },
        { type: "board_settle", board: HEAT_START_BOARD },
        {
          type: "bonus_trigger",
          mode: buyMode,
          scatterPositions: [
            [1, 2],
            [2, 2],
            [4, 0]
          ]
        },
        {
          type: "bonus_spin",
          respinsBefore: 3,
          respinsAfter: 3,
          landedSymbols: Array.from({ length: 20 }, (_, index) => ({
            symbol: "SAFE" as const,
            position: [(index % 5) as 0 | 1 | 2 | 3 | 4, Math.floor(index / 5) as 0 | 1 | 2 | 3],
            value: 250
          })),
          lockedGrid: Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => ({ symbol: "SAFE" as const, value: 250 })))
        },
        { type: "bonus_end", totalPayout: 5000, filledScreen: true },
        { type: "round_end", payoutMultiplier: 5000, capApplied: true }
      ]
    }
  ];
}

export const DEMO_RECORDS = createFixtureRecords("base");

function modeId(mode: BetMode, offset: number): number {
  const base = {
    base: 1000,
    ante: 2000,
    buy: 3000,
    super_buy: 4000
  }[mode];
  return base + offset;
}
