# HEAT CHASE — ART BRIEF
**Written 2026-07-17. Everything you need to redo the art at A1 quality without breaking the game or the 30 MB budget.**

Read §1 and §2 once. Then work through §4 symbol by symbol. §5 has a ready-to-paste
prompt for every single image. Don't skip §1 — that's where the two bugs that made
your art look "small and bad" are explained, and they were file problems, not code problems.

---

## 0. TL;DR — what actually needs doing

| Priority | What | Why |
|---|---|---|
| **1** | **Redo `cyan_car_wild.webp` as a CYAN SPORTS CAR** | It's currently a pink flip phone at 123×231 — the worst asset in the game, and it's your WILD |
| **2** | Redo the 9 low-res symbols at 512px | ~200px art can't look sharp in a 124px cell on a retina screen |
| 3 | (Optional) Redo logo master | Current one is fine, just small-sourced |
| 4 | (Optional) Recompress 4 big backgrounds | Frees ~5 MB if you need headroom |

Current asset folder: **23 MB / 30 MB budget.** Redoing every symbol at spec *shrinks*
the symbols folder. You have room. Don't rush this.

---

## 1. THE TWO RULES THAT DECIDE WHETHER ART LOOKS "A1" OR "CHEAP"

### RULE 1 — NO DEAD TRANSPARENT MARGIN. THE ART MUST FILL THE CANVAS.

**This is the single most important instruction in this document.**

The game scales every symbol by its **full canvas size**, not by the visible art. So if
your PNG is 2048×2048 but the object only occupies the middle 60%, the game shrinks the
whole 2048 square to fit the cell — and your object renders at 60% of the size it should.
It looks small and weak next to symbols that are tightly cropped. **This is exactly why
the Brinks truck and the Heat Chase logo looked too small** — the logo art filled only
63% × 46% of its canvas, so it was rendering at under half size everywhere. Both are fixed now.

**The rule:** crop tight to the object, then leave a small, even margin. Target **~97% fill**.

| | fill | verdict |
|---|---|---|
| `diamond`, `cash`, `knife`, `bike` | 95–100% | ✅ correct |
| `pistol` | 86% × 75% | ⚠️ renders ~15% small |
| `wild_symbole` | 82% × 86% | ⚠️ renders ~15% small |
| old `Heat Chase Logo` | 63% × 46% | ❌ was rendering at half size — FIXED |
| old `burner_phone` (truck) | 84% × 62% | ❌ was rendering small — FIXED |

**You do not have to do this by hand.** Run the tool in §3 and it does it automatically.

### RULE 2 — THE BACKGROUND MUST BE ACTUALLY TRANSPARENT, NOT "BLACK-ISH"

Image generators love giving you a *nearly* black background, or a dark halo/glow around
the object. In-game, on a lit background, that reads as a dirty grey box around your symbol.

- Generate on a **flat plain background** (say so in the prompt — it's already in §5's prompts).
- Remove the background so the alpha is **fully 0**, not "very dark".
- **Kill soft halos.** A fuzzy AI glow edge looks like garbage in motion. Hard, clean edges.
- Keep the symbol's *own* intentional glow (the gold rim light) — remove only the background.

Free tools: **remove.bg**, **Photopea** (Select > Subject → refine edge → invert → delete),
or the `remove_background` tool if you fund the Higgsfield workspace.

---

## 2. STYLE GUIDE — so all 14 symbols look like one set

Your best existing symbols (`diamond`, `cash`, `bike`, `brass_knuckles`) already define the
look. **Match them or the set won't feel professional:**

- **Vector / comic game-art.** Clean flat shapes, cel shading. NOT photoreal, NOT 3D render.
- **Bold dark outline** around the whole object (~2–3% of the symbol's width).
- **Warm gold rim-light** hugging the outline — this is the signature of your set.
- **Vice / GTA neon palette:** magenta, cyan, hot pink, electric green, gold. Night-time.
- **3/4 hero angle**, object centred, slight downward tilt, filling the frame.
- **Single object only.** No scene, no ground, no shadow pool, no text, no logos, no watermark.
- **Chunky and readable at 124px.** A symbol that needs squinting is a failed symbol.
  Fewer, bigger details always beat fine detail that turns to mush.

**Tier reads (players must instantly rank them by value):**
- **Low** (brass, knife) — cool steel/blue tones, small, plain, no gold.
- **Mid** (pistol, ammo, duffel) — some gold, warmer, more presence.
- **Premium** (cash, diamond, bike) — heavy gold, gem highlights, glow, sparkles. **⭐⭐⭐**
- **Special** (wild, cyan car) — neon green/cyan, unmistakable, maximum energy.
- **Bonus** (safe, master key, truck) — gold + heist blue, high contrast.

---

## 3. THE SPEC — EXACT NUMBERS, EVERY IMAGE

| Property | Value |
|---|---|
| **Generate at** | as large as your tool allows (1024–2048). Bigger = better source. |
| **Final resolution** | **512 px on the long side** (that's 2–3× the biggest cell — retina-safe) |
| **Fill** | **~97%** of canvas (see RULE 1) |
| **Background** | fully transparent alpha (see RULE 2) |
| **Format** | `.webp`, **quality 88** |
| **Expected file size** | **20–60 KB per symbol** |
| **Colour** | sRGB |
| **Filename** | ⚠️ **keep the EXACT existing filename** (see table §4) or the game won't load it |
| **Drop into** | `stake-frontend/public/assets/symbols/` |
| **Masters** | keep the big originals **OUTSIDE the repo** (e.g. `Downloads/heat-chase-masters/`) — they'd blow the 30 MB budget |

### The one command that does the resizing + margin fix for you

I built you a tool. After you export any symbol (any size, background already removed):

```bash
cd "stake-frontend"
python tools/asset-pipeline/prep_art.py "public/assets/symbols/cyan_car_wild.webp"
```

It trims dead margin, scales to 512px, fixes fill to 97%, saves webp q88, and prints
before/after. **Run it on every symbol you drop in.** Options: `--max=512` `--fill=0.97`
`--quality=88` `--shade=1.0` `--out=<path>`.

### ⭐ EXTRA STEP for premium symbols you want SKELETALLY ANIMATED (diamond, cash, bike)

The diamond you liked is skeletal — built from **separate layers**. For each premium symbol,
also export **the parts as separate images**, or ask the image model for them:

1. Generate the assembled symbol first.
2. Then ask: *"the same [object], full complete shape, isolated on plain background"* for
   each moving part — plus a **glow** layer and a **shine/highlight** layer.
3. **Overlap joints by 10–20%** — where two parts meet, each must extend *into* the other,
   or gaps open when they move.
4. **Paint fill behind occluders** — if a part sits on top of another, the lower one must
   be complete underneath (Photopea: select the hole → Edit > Fill > Content-Aware).
5. 4–8 parts is right. Name them semantically: `01_glow`, `02_body`, `03_shine`, `04_sparkle_l`.

Don't stress about this — **if you just give me the flat symbol, I can auto-split it like I
did for the diamond.** Real layers are only better if you have them.

---

## 4. WHAT TO DO WITH EACH IMAGE

⚠️ = must keep this exact filename.

| File ⚠️ | In-game meaning | Now | Do this |
|---|---|---|---|
| `cyan_car_wild.webp` | **WILD / Heat-4 mega-wild** | 🔴 **pink flip phone, 123×231** | **REDO → cyan sports car.** §5.1 |
| `knife.webp` | Low pay | 197×224, 7.5 KB | REDO @512 |
| `brass_knuckles.webp` | Low pay | 224×176 | REDO @512 |
| `ammo.webp` | Mid pay | 210×177 | REDO @512 |
| `duffel.webp` | Mid pay | 224×178 | REDO @512 |
| `cash.webp` | Premium ⭐⭐⭐ | 245×205 | REDO @512 + layers |
| `diamond.webp` | Premium ⭐⭐⭐ (skeletal ✅) | 255×217 | REDO @512 + layers → I re-run the rig |
| `safe.webp` | Bonus hold&spin | 294×320 | REDO @512 |
| `master_key.webp` | Bonus doubler | 320×143 | REDO @512 |
| `empty.webp` | Empty bonus cell | 210×224 | REDO @512 (or leave) |
| `wild_symbole.webp` | WILD (bikini) | 512×512, 82% fill | Optional: margin fix, or redo |
| `pistol.webp` | Mid pay | 512×487, 86% fill | Optional: margin fix, or redo |
| `bike.webp` | Premium ⭐⭐⭐ | 512×467, 100% | ✅ **leave alone** |
| `burner_phone.webp` | **Armored Truck scatter** (legacy name!) | 512×377 ✅ | ✅ **fixed — leave alone** |
| `watch.webp` | **nothing — unused** | 183×237 | Delete, or tell me to wire it in |

**One-liner for the two margin warnings** (say the word and I'll run it):
```bash
python tools/asset-pipeline/prep_art.py "public/assets/symbols/pistol.webp"
python tools/asset-pipeline/prep_art.py "public/assets/symbols/wild_symbole.webp"
```

### Naming truth you should know
Two IDs are **legacy-misnamed** in code — the art is right, the name is stale:
- `PHONE_SCATTER` → is actually the **Armored Truck** (file `burner_phone.webp`). Correct art.
- `CAR_WILD` → **should** be a Cyan Sports Car, but the file has a phone in it. Wrong art.

So: **the truck is correct and stays. The phone is the mistake.**

**❌ DECIDED 2026-07-17: do NOT rename the identifiers.** Investigated the blast radius —
the literal string `PHONE_SCATTER` is baked into **90,458 published book records** across all
7 books (boards serialize as symbol names), plus the lookup tables. Renaming the ID forces a
full math republish + parity re-verification for a change **no player can see** (the in-game
label already reads "Armored Truck"). Legacy names stay. Not a bug — just a stale name.

---

## 5. READY-TO-PASTE PROMPTS

**How to use:** paste the STYLE BLOCK + the symbol's SUBJECT line together as one prompt.
Then: remove background → run `prep_art.py` → drop in `public/assets/symbols/`.

### 📌 THE STYLE BLOCK — put this at the start of EVERY symbol prompt

```
Single video-slot game symbol, vector comic game-art style, bold dark outline,
warm gold rim-light along the edges, cel shading, GTA Vice City neon night palette
(magenta, cyan, hot pink, gold), 3/4 hero angle, object centred and filling the frame,
chunky and readable at small size, flat plain background, nothing cropped,
no text, no logo, no watermark, no ground shadow, no scene, single object only,
high detail, crisp clean edges.
```

---

### 5.1 ⭐ THE BIG ONE — `cyan_car_wild.webp` (phone → CYAN SPORTS CAR)

**Why a car:** the code literally calls it *"Cyan Sports Car"*, the file is named
`cyan_car_wild`, and the internal drop-in guide expects `vehicles/cyan_sports_car.webp`.
A neon getaway car IS the GTA vibe, it matches your bottom-left bike art, and it makes the
strongest wild in the game finally look like the strongest wild. The pink flip phone reads
as a random 2005 prop with zero heist energy.

**SUBJECT (append to the STYLE BLOCK):**
```
a sleek cyan neon sports car, GTA getaway supercar, front 3/4 hero angle, low aggressive
stance, glowing cyan underglow and headlights, electric green and cyan two-tone bodywork
with gold trim accents, tinted windows, chrome rims, wet reflective paint catching magenta
neon, energetic and premium, the hero wild symbol of a heist slot game.
```

**Alternates if you don't want a car** (still GTA, still fits "wild substitute"):
- **Gold-plated getaway car keys** on a neon fob — *"a set of golden car keys with a glowing cyan keyfob, swinging, luxury heist loot"*
- **Neon police badge** — *"a stolen golden police detective badge, cracked, neon cyan glow"*
- **Wanted poster star** — *"a golden five-point wanted star, GTA wanted-level star, glowing"*

My recommendation: **the cyan sports car**, clearly. It's what everything in the codebase already expects.

---

### 5.2 Low tier — cool, plain, no gold

**`knife.webp`**
```
a folding switchblade knife, blade open, steel blade with a cold blue sheen,
dark grip with subtle red accent, street weapon, cheap and mean, minimal gold.
```

**`brass_knuckles.webp`**
```
a pair of brass knuckles, worn copper-brass metal, four finger holes, scuffed
battle-worn surface, cold blue rim light, street weapon.
```

### 5.3 Mid tier — some gold, warmer

**`pistol.webp`** *(only if redoing)*
```
a semi-automatic pistol, matte black slide with electric-green neon accent panels,
gold trigger and gold detailing, side 3/4 view, sleek and modern.
```

**`ammo.webp`**
```
three golden bullet cartridges arranged in a tight cluster, brass casings with
cyan and magenta neon tips, gleaming metal, crisp highlights.
```

**`duffel.webp`**
```
a black tactical duffel bag stuffed full and overflowing with cash, zipper half
open, gold banknote edges spilling out, cyan and magenta neon rim light, heist loot bag.
```

### 5.4 Premium tier ⭐⭐⭐ — heavy gold, glow, sparkle (also export layers, §3)

**`cash.webp`**
```
a thick stack of banknotes bound with a gold band, crisp green and gold bills,
slight fan at the edges, sparkling gold highlights, magenta and cyan neon glints,
premium jackpot loot, rich and glowing.
```
*Layers to also request:* `glow`, `body` (the stack), `shine`, `sparkle_l`, `sparkle_r`.

**`diamond.webp`** *(matches your current one — keep the design, just higher res)*
```
a large brilliant-cut diamond gemstone, faceted crystal, white and gold interior
facets, thick gold outline, magenta and cyan prismatic sparkle glints on the facets,
brilliant white star highlights, premium jackpot gem, radiant.
```
*Layers to also request:* `glow`, `body`, `shine`, plus 3 `sparkle` stars.

**`bike.webp`** — ✅ **do not touch, it's already good.**

### 5.5 Bonus symbols

**`safe.webp`**
```
a heavy locked vault safe, dark steel body with gold dial and gold reinforced corners,
front 3/4 view, thick gold combination dial, heist target, gold rim light.
```

**`master_key.webp`**
```
an ornate skeleton master key, glowing cyan and electric blue metal, intricate
filigree bow, magical hacking tool aesthetic, neon glow along the shaft.
```

**`empty.webp`**
```
a plain dark hexagonal slot tile, empty holder, subtle dark blue gradient,
thin faint gold border, deliberately understated and non-distracting.
```

### 5.6 Logo — ✅ already done, two versions now exist

You asked for a big one and a small shaded one. **Both are built and wired in:**
- **`Heat Chase Logo.webp`** — 1024×752, tight-cropped → bottom-left corner (now renders
  **75% bigger**) + the buy-confirm popup.
- **`heat_chase_logo_symbol.webp`** — 512×375, **pre-shaded to 72% brightness** → the
  Getaway bonus reel watermark.

If you ever redo the logo, give me the master and I regenerate both:
```bash
python tools/asset-pipeline/prep_art.py "MASTER.webp" --fill=0.99 --max=1024 --quality=90 --out="public/assets/Heat Chase Logo.webp"
python tools/asset-pipeline/prep_art.py "public/assets/Heat Chase Logo.webp" --fill=0.97 --max=512 --shade=0.72 --out="public/assets/heat_chase_logo_symbol.webp"
```

---

## 6. BACKGROUNDS & BIG IMAGES — ⏸️ DEFERRED (decided 2026-07-17: not now)

Already at 23 MB / 30 MB, so this isn't needed yet. Kept here for when it is —
these are the last 8 MB, and they're **fine quality**, just over-compressible.
When we do it: try recompressing at **native resolution first** and measure; only
downscale if q82 alone misses the target (avoids a needless resolution loss).

| File | Now | Target |
|---|---|---|
| `slot3_bg.webp` | 2564×1536, **2.8 MB** | 1920 wide, q82 → ~500 KB |
| `chase_max_heat.webp` | 1920×1072, **2.1 MB** | q82 → ~500 KB |
| `vault_bonus.webp` | 1920×1072, **1.7 MB** | q82 → ~450 KB |
| `brinks_truck_frame.webp` | 2750×1536, **1.5 MB** | 1536 wide, q85 → ~400 KB |

⚠️ **`brinks_truck_frame.webp` has hardcoded door coordinates in `BonusView.ts`** — don't
resize it yourself, let me do it so I retune those numbers. Saves ~5 MB total → **~18 MB**.

---

## 7. WHAT NOT TO DO — the traps

- ❌ **Don't upscale old art.** Upscaling a 200px symbol gives you a bigger blurry symbol.
  Resaving cannot add detail. **Regenerate from scratch or leave it.**
- ❌ **Don't rename files** without telling me — `SYMBOL_ASSETS` in `assets.ts` maps
  every ID to an exact filename. A rename = a missing symbol.
- ❌ **Don't ship 2048px symbols.** They cost 1 MB each and render at 124px. 512 is the spec.
- ❌ **Don't leave a dark halo** around a cutout. (RULE 2.)
- ❌ **Don't add drop shadows or ground shadows** into the art — the engine does lighting.
- ❌ **Don't bake text/numbers** into symbols — the engine draws labels.
- ❌ **Don't put masters in the repo.** Budget.
- ❌ **Don't hand-edit the skeletal JSON** in `public/assets/skel/` — it's generated.

---

## 8. AFTER YOU DROP THE ART — what I do

Drop files in `public/assets/symbols/` with the **exact same names** and tell me. Then I:

1. Run `prep_art.py` on each (margin + 512 + webp q88) and report before/after sizes.
2. Verify every symbol still loads in the running game, no console errors.
3. For premium symbols: run the skeletal pipeline (`make_parts.py` → `pack_atlas` →
   `make_skeleton` → `gen_anim` → `validate` → `build_preview`) and wire them in like the
   diamond — idle / win / drop / destroy, ~100 KB each, no sprite sheets.
4. Re-measure the asset folder against the 30 MB budget.
5. Optionally rename the legacy `PHONE_SCATTER` / `cyan_car_wild` identifiers to match reality.

**Best order to work in:** cyan sports car first (biggest visible win) → premium three-star
(cash, diamond — they get skeletal animation) → bonus (safe, key) → mid → low.
