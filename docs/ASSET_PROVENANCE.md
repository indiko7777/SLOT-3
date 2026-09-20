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
