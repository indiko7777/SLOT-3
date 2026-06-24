# Heat Chase: Grand Escape — Math & Retention Design (Stake Engine)

> Source of truth for the math engine, the cascade model, and the persistent
> Beach Girl collection. This **replaces** the original puzzle-collection GDD,
> which was written against a model Stake Engine does not support. Read
> "Platform constraints" first — it explains every change.

## 0. Platform constraints (why this doc differs from the old GDD)

Stake Engine is a **per-round, book-driven, provably-fair RGS**:

- Every spin calls `/wallet/play`; the RGS returns one pre-generated **book**
  (a fixed `payoutMultiplier` + event stream) selected by weighted RNG from a
  **lookup table**. RTP is computed and **verified per bet mode** from those
  tables (`stake-math/src/verify.ts`).
- The RGS is **stateless across rounds**. It persists only *intra-round* state
  (to resume an interrupted spin). There is **no per-player KV store, no
  jackpot/progressive/collection** at the RGS level.
- The only identifier the game receives at launch is an **ephemeral
  `sessionID`** (`stake-frontend/src/rgs/session.ts`). There is **no stable
  account ID**.

**Consequences (hard rules):**

1. **Money only flows through verified per-round books.** A payout that depends
   on persistent cross-session progress is impossible and would fail RTP
   verification + provable fairness.
2. **The collection cannot be a money pot.** It is **cosmetic + engagement
   only**, $0 EV. All cash stays in the certified base + bonus books.
3. **No client-state-driven free EV.** (See §6 — the current Wanted meter
   violates this and is fixed.)
4. **Persistence is client-side** (`localStorage`) behind an interface, so it
   can be swapped for an operator-hosted store if Stake ever exposes a stable
   player ID. True cross-device account-binding requires operator support.

## 1. RTP budget (96%, all in books, per bet mode)

| Band | Base/Ante split | Intent |
| :-- | :-- | :-- |
| `basegame` (small) | ~22% | **Frequent, small** cluster wins. Drives hit-rate, kills dead-spin feel. |
| `basebig` (cascade) | ~10% | **Rare, large** cascade chains built by the multiplier ladder. The base-game excitement. |
| `freegame` (Getaway) | ~62% | The Hold & Spin bonus. Where the big money lives. High volatility. |
| `wincap` (5000x) | ~6% | The max-win tail. |

The old GDD's "Tier 1 = 16%, Tier 2 = 14%" collection buckets are **deleted** —
they described money the platform cannot pay. The collection is funded by $0.

**Why two base bands.** A single base band forces `hit% × avg-win = RTP`, so a
fat cascade tail *crushes* the hit-rate (baseline measured **8.6% hit / 91%
dead**). Splitting `basegame` (frequent/small) from `basebig` (rare/large) lets
both coexist at 96%. Target after split: **base hit ≈ 30%+, dead ≈ 65%**, with
collection shards making the rest feel active.

## 2. Cascade model — long chains are the big win

The headline change. Big wins come from **chain length**, not fat single
clusters.

- A **tumble-multiplier ladder** climbs **every cascade** and multiplies every
  win from that rung on. Front-loaded for the 5x4 grid (chains are short here):

  | Cascade # | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9+ |
  | :-- | :- | :- | :- | :- | :- | :- | :- | :- | :- |
  | Multiplier | 1 | 2 | 4 | 7 | 12 | 20 | 30 | 45 | 65 |

- **Flatter `clusterSizeFactor`** so cluster *size* barely matters; the ladder
  carries the win.
- **Mid-chain wild injection** (the Heat-4 2×2 mega-wild) fuels runaway chains —
  the rare 6–7 cascade monster that lands in `basebig`.
- On 5x4, realistic chains are **1–4, rarely 5–7**. The front-loaded ladder
  makes even a 3–4 chain pop (×4 by cascade 3).

Grid stays **5x4** (owner decision). Bonus stays the **Hold & Spin "Getaway"**
(sticky multipliers; full 20/20 screen = 5000x), sold as the **buy**, tuned
high-variance via a low land rate so full-screen stays a <0.1%-of-bonuses dream.

## 3. The Beach Girl collection (cosmetic, persistent, $0 EV)

Two layers, hard wall between them.

- **Layer A — money:** the certified books above. Collection never touches RTP.
- **Layer B — engagement:** one **rare WILD symbol** reveals **one body part**
  (strict 1:1), accumulated into a **persistent gallery**. WILDs come from the
  book's boards, so it's provably fair; the WILD is just a rare reel symbol.

**Pacing (set by WILD rarity in the reels):**

- The scene counts each distinct WILD that lands (deduped across tumbles) and
  calls `collectWild()`, which reveals the next body part and persists.
- Difficulty = WILD rarity × parts per girl. Make a later girl harder by giving
  her more parts (each still one WILD).

| Girl | Parts | ~Base spins | ~Ante spins | Feel |
| :-- | :-- | :-- | :-- | :-- |
| Girl 1 (Sapphire) | 8 | ~131 | ~81 | The hook — a session or two |
| Girl 2 (Roxy) | 8 | +~131 | +~81 | Several sessions |
| Girl 3 (Vega) | 8 | +~131 | +~81 | The long haul |

At WILD reel weight 3 (base) / 5 (ante): ~1 WILD every 16 base spins; full
gallery (24 parts) ~392 base spins. All tunable via the single WILD weight;
re-verify 96% after (the WILD also substitutes, so it touches the optimizer).

**Never resets.** Persistence is the "come back tomorrow" hook. (The old GDD's
reset-on-leave fought that goal and protected a money pot that doesn't exist.)

**Reward = cosmetic only.** Art reveal, permanent gallery slot, status/badge,
and **RTP-neutral unlocks** (e.g. a cosmetically distinct bonus skin — still
exactly 96%, full price). **No free spins, no free EV.** Real-money rewards for
the gallery are only possible via **operator-side promos** (loyalty/raffle),
outside the game math.

## 4. Persistence

`GalleryStore` interface with a `LocalStorageGalleryStore` implementation
(device+browser-bound). One swap point for an operator/account store later.
Stored: per-girl shard counts, completed girls, unlocked cosmetics. Never any
balance or payout.

## 5. Anti-exploit (simplified — the collection has no money)

The old GDD's bet-level segregation, bonus-buy quarantine, and average-bet
accounting all existed to protect a money pot that cannot exist here. With a $0
collection there is **nothing to exploit**, so these rules are dropped. Shards
may accrue on any paid spin; whether bought-bonus spins grant shards is a pure
feel choice (default: base/ante only, to reward organic play).

## 6. The Wanted meter — leak fixed, stars are the in-spin Heat (DONE)

The old client-side Wanted meter triggered a **free 100x buy-bonus** at 5 stars.
Nothing funded it (base mode is verified to 96% from base books *alone*), so it
pushed true RTP **above 96%** — an RTP leak that would fail verification. A
client-counted, cross-spin meter also cannot *guarantee* a paid bonus on a
stateless, per-mode-verified RGS.

**Built (owner-chosen, option A):** the WANTED LEVEL stars are now the **live
in-spin Heat** (cascade depth 0–5). The player watches them climb as the cascade
chain builds, and **5★ (a 5-cascade chain) triggers the Getaway in-book on that
same paid spin** — earned, guaranteed, fully RTP-funded. The client no longer
issues any `free` play (`getWantedLevel → snapshot.heatLevel`).

- **Stars fill:** +1 per winning cascade; reset to 0 each spin. Wild injections
  at Heat 3 & 4 let a 3-cascade chain run away to 5★. Measured: 1★ 1-in-3,
  2★ ~1-in-22, **5★ ~1-in-224 (base) / ~1-in-144 (ante)** — hard but reachable.
- **Wanted is the PRIMARY trigger:** ~88% of Getaways come from the 5★ climb;
  ~12% from a rare 3-scatter surprise (`SCATTER_TRIGGER_SHARE`). Forced bonus
  *coverage* in cash modes is climbed to Heat 5 via a per-cascade continuation
  plant, so served bonuses genuinely trigger via the stars, never "out of
  nowhere". Buy modes go straight to the Getaway (no Wanted climb).
- **Difficulty knobs:** the bonus/5★ rate is set by `rtpSplit.freegame`; the
  Wanted-vs-scatter mix by `SCATTER_TRIGGER_SHARE`; Ante boosts the Wanted path
  via higher wild weight (`anteReels`). All re-verify to exactly 96%.

The Hold & Spin bonus itself is unchanged and confirmed well-tuned (full-screen
5000x stays rare; buys are high-variance and bust-prone; all modes verify 96%).

## 7. Build phases

1. ~~**Cascade + bands (math):** ladder, flatter size curve, `basebig` band,
   retuned splits.~~ **DONE** — base hit 8.6%→31%, dead 91%→69%, 96% verified.
2. ~~**Wanted-meter fix:** leak removed; stars = in-spin Heat; 5★ triggers the
   Getaway in-book, Wanted-primary.~~ **DONE** — 96% verified, all modes.
3. ~~**Collection layer (frontend):** persistent gallery + shard pacing wired
   into the HUD, replacing the in-memory `collectionCount`.~~ **DONE.**
4. ~~**Reward polish:** completion celebration + RTP-neutral unlock.~~ **DONE.**

### Phase 3+4 as built

- **Trigger: one rare WILD = one body part (strict 1:1).** The scene counts each
  distinct WILD that lands (deduped by symbol-view across tumbles) and calls
  `collectWild()`. WILD is rare in the reels (base weight 3 / ante 5; was 55) →
  ~1 WILD per 16 base spins. RTP stays exactly 96% (the WILD also substitutes, so
  the change went through the optimizer + verify).
- **`stake-frontend/src/meta/`** (pure, unit-tested — 7 tests):
  - `collection.ts` — 3 girls × 8 parts, `collectWild()` / `addWilds()` (1:1,
    linear), advances girls, grants unlocks, and **never resets**. Mastering all
    3 grants `gallery_master`. Harder later girls = give them more `pieces`.
  - `GalleryStore.ts` — `LocalStorageGalleryStore` (device-bound) behind an
    interface, with a `MemoryGalleryStore` fallback; corrupt/blocked storage
    degrades safely. The ONE swap point for an operator/account store later.
  - `rewards.ts` — RTP-neutral cosmetic unlock copy ($0 EV; `applyCosmetic` is a
    visual-only stub).
- **Wiring:** each rare WILD during replay reveals a part via `collectWild()` +
  persists + animates it; completion fires a celebration + reward banner (master
  = grand banner). The old wrap-at-8 counter is gone. Pace tool:
  `stake-math/scripts/measure-wild.ts`.
- **Art reality:** only girl 1 has shipped art (`char_*`, 8 pieces). Girls 2/3
  progress in state and show a text placeholder until `char2_*` / `char3_*` art
  is added — the logic and persistence are complete.

Tests run via the math CLI only (`npm test`, `generate`, `verify`). Browser
feel-testing is done by the owner. The DEV debug pop-up is left untouched.
