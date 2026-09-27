# Asset provenance

Updated 20 September 2026.

| Asset group | Source / evidence | Release handling |
|---|---|---|
| `miami_daylight_gameplay_v2.webp` | Generated in this task with the built-in image tool. Exact prompt in GAMEPLAY_ART_PROMPT.md. | Regular-spin background; 449,358 bytes. |
| `miami_loadscreen_v2.webp` | Generated in this task with the built-in image tool. Exact prompt in LOADING_ART_PROMPT.md. | Loading and intro only. |
| Barlow Semi Condensed, SemiBold and Bold | Google Fonts repository, `ofl/barlowsemicondensed`, copyright The Barlow Project Authors. SIL Open Font License 1.1 included beside the fonts. | Bundled locally; no external font service. |
| Existing symbols, skeletal atlases, character cutouts, logo, truck/bonus imagery and audio | Present in the user's repository before this task. Authorship/license grants were not supplied in this task. | Preserved. The owner must retain the applicable licenses/source records for submission. No claim of verified rights is made. |
| Rejected dusk-marina illustration, old splash and unused source images | Retained in the working tree for reversible review. | Explicitly omitted from release archive. |

Font sources:
- https://github.com/google/fonts/tree/main/ofl/barlowsemicondensed
- `stake-frontend/public/assets/fonts/OFL-BarlowSemiCondensed.txt`

Every packaged file is recorded by relative path, byte size and SHA-256 in the release directory's `manifest.json`. This identifies exactly which assets are in the candidate; a checksum is not evidence of a license.

## Presentation assets added 27 September 2026

| Asset | Source / evidence | Handling |
|---|---|---|
| `getaway_highway.webp` | Original image-tool night Miami boulevard illustration; generated 27 September. | Quiet background behind the original truck. |
| `getaway_building.webp`, `getaway_palm.webp` | Original isolated Art Deco building and royal palm, generated for this task. | Recycled side scenery; original truck untouched. |
| `symbols/cash.webp`, cash atlas | Original unbound wad with fictional palm banknote design. Source `cash-wad.source.png`; six airborne sheets use `cash-note.source.png`. | Idle shows only one wad. Reproducible semantic generator and motion authoring included. |
| `real_bill.webp` | Original fictional palm note source, generated in this task. | Replaces earlier money-rain artwork. |
| Anton Regular | Official Google Fonts `ofl/anton`, SIL Open Font License. | Bundled as Heat Display with `OFL-Anton.txt`. |

Previous banded-bundle source is retained for provenance but is not used by the current CASH symbol. New assets were generated from textual art direction without supplied franchise artwork, logos, screenshots or characters.
