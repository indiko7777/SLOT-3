# Sound guide: replacing the Getaway sounds and the background music

Every sound is a plain `.mp3` under `stake-frontend/public/assets/`. To swap
one, **overwrite the file at the same path and keep the same file name**. No
code change is needed. If you would rather use a new file name, change the
path in the table the row below points to:

* `TRACK_PATHS` at the top of `stake-frontend/src/audio.ts` (music, Getaway
  intro/loop, banners, counters, voices)
* `stake-frontend/src/audio/approvedManifest.json` (the per-cue Getaway and
  symbol sounds chosen in the sound review)

After swapping, run `npm run dev:local` in `stake-frontend` and play
`?qa=presentation` → **QA Getaway** to hear the whole chase, then
`npm run check` before packaging.

## 1. Background music (base game radio)

The radio wheel (the radio button on the control bar) picks one of these loops. COASTAL HEAT is the default.

| Station | Track id | File |
| --- | --- | --- |
| COASTAL HEAT (default) | `bg_base` | `assets/audio/turbo_night.mp3` |
| NEON NIGHTS | `sunset_synths` | `assets/audio/sunset_synths.mp3` |
| VICE 95.6 | `vice_nights` | `assets/audio/vice_nights.mp3` |
| OPEN LIVE | `open_lines` | `assets/Open Lines 97.mp3` |
| VAULT FM | `bg_bonus` | same file as the Getaway loop below |

Volumes are in `VOLUME` in `src/audio.ts` (music sits at `0.30`).

## 2. Getaway mode

| Moment | Track / cue id | File |
| --- | --- | --- |
| Cinematic intro hit (with the banner) | `getaway_intro` | `assets/new new sound/sound for getaway intro play in same time as the banner appear that give the cinematic look.mp3` |
| **Getaway background loop** | `bg_bonus` | `assets/new new sound/continuous looping getaway background sound play after the intro sound.mp3` |
| Fallback loop if the one above is missing | `police_sound_loop` | `assets/sound/police sound loop.mp3` |
| Typewriter (intro text) | `typewriter` | `assets/new new sound/type writer sound.mp3` |
| Gold bar lands / sticks | `sticky_gold_bar` | `assets/new new sound/sound for sticky gold bar in getaway mode.mp3` |
| Dynamite explosion | `getaway_explosive` | `assets/new new sound/sound for explosive multiples in the getaway play once per explosive.mp3` |
| End of the Getaway | `getaway_end` | `assets/new new sound/end of getaway sound.mp3` |
| Max-win ending | `win_max` | `assets/new new sound/sound for biggest winning banner.mp3` |
| Dynamite lands | `dynamite` (manifest) | `assets/audio/approved/6a3c088d40e91858.mp3` |
| Fuse burning (loops) | `fuse` (manifest) | `assets/audio/approved/baba05ce999650e3.mp3` |
| Dud dynamite | `dud` (manifest) | `assets/audio/approved/42a7bc0dbab9669e.mp3` |
| Respins held / meter | `held` (manifest) | `assets/audio/approved/4ef43c3ee641cc28.mp3` |
| Respin used up | `spent` (manifest) | `assets/audio/approved/4fde6baeae226165.mp3` |
| Bonus reel column stop / truck doors | `bonusstop`, `doors` (manifest) | `assets/audio/approved/c3be35abff9b3a95.mp3` |
| Helicopter at max heat (loops) | `helicopter` (manifest) | `assets/audio/approved/31899a1a9ae33773.mp3` |
| BUSTED / wasted | `busted` (manifest) | `assets/audio/approved/busted_wasted.mp3` |
| Result screen opens | `result` (manifest) | `assets/audio/approved/e524d707c3aae800.mp3` |
| Result money counter (loops) / end | `counter`, `counter_end` (manifest) | `assets/audio/approved/85376485ec5d215b.mp3`, `29709ba4eb2644e9.mp3` |

Some approved files are shared by several cues (for example `4ef43c3…` is both
`held` and `heat1`). To change only one cue, add a new file and point that
cue's `path` in `approvedManifest.json` to it. A manifest entry with
`"silent": true` is deliberately silent; give it a `path` to add a sound.
`assets/audio/getaway/` is an older sample bank that the game no longer plays.

## 3. File specs

* MP3, 44.1 or 48 kHz, 128–192 kbps. Music can be stereo; short effects can be mono.
* **Loops** (`bg_bonus`, music, fuse, counters) must loop without a gap: trim
  them to the beat and export without leading or trailing silence.
* **Keep music loops at about 3 minutes or less.** The browser stores a
  playing loop decoded, at roughly 23 MB per minute of stereo audio. Phones
  hold only the track that is playing (this was part of the iPhone 12 crash
  fix), but a 10-minute loop would still cost ~230 MB on its own.
* Normalise loudness. Music around −16 LUFS and effects peaking at about −1 dBFS
  fit the current mix. Fine-tune with `VOLUME` in `src/audio.ts`.

## 4. Where to get new sounds

This is a real-money and social-casino release, so **every file must carry a
licence that allows commercial use in a game** (watch out for "non-commercial",
"YouTube only" or "personal" licences). Save the licence or receipt and add a
line to `docs/ASSET_PROVENANCE.md` for each new file. Check each licence's
current terms before buying.

**Sound effects for the Getaway** (sirens, car chase, engines, explosions, fuses, cash, vault and metal hits):
* **Sonniss "GDC Game Audio Bundle"**: free, large, professionally recorded; licensed royalty-free for commercial games.
* **A Sound Effect** (asoundeffect.com): a marketplace of game-oriented libraries; search "car chase", "police", "heist", "explosion".
* **BOOM Library** and **Pro Sound Effects**: high-end paid libraries (vehicles, weapons, cinematic hits).
* **ZapSplat**: large free/paid catalogue. The free tier needs attribution; the paid tier does not.
* **Freesound.org**: check the licence of every file. CC0 is easiest, CC-BY needs credit, and **CC-BY-NC cannot be used**.

**Background music** (search terms: *synthwave*, *outrun*, *retrowave*, *80s Miami*, *heist*, *car chase*, *trap*, *crime drama*):
* **AudioJungle (Envato Market)** or **Pond5**: pay per track and get a commercial licence; many tracks come with loop versions.
* **Artlist** / **Epidemic Sound**: subscription libraries. Confirm the plan covers games or apps before using a track.
* **Commission a composer** (for example on SoundBetter or Fiverr, or a game-audio studio) for an exclusive, seamless loop set: base theme, Getaway loop, intro sting and end sting. This is what top-tier slots do, and it guarantees a matched style.
* AI music generators are risky here: rights depend on the plan, and the platform may ask for provenance. Avoid them unless the plan grants full commercial rights.

The local sound-review page (`npm run dev:local`, then
`http://127.0.0.1:5176/sound-review.html`) lets you upload a candidate file and
audition it against the cues before you swap it in.
