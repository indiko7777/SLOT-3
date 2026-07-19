#!/usr/bin/env python3
"""Report which files under public/assets are never referenced by the code.

Reference detection is deliberately generous, because a false "unused" verdict
deletes a real asset:
  - exact path match ("symbols/bike.webp")
  - basename match ("bike.webp"), URL-encoded too ("Heat%20Chase%20Logo.webp")
  - stem match for files reached by dynamic template ("skel/<name>/<name>.json",
    audio TrackName keys like "bg_base" -> bg_base.mp3)
Anything matched by ANY of those is reported as USED.

Usage:
  python audit_unused.py            # report only (safe)
  python audit_unused.py --delete   # delete the unused files
"""
import re
import sys
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parents[2]      # stake-frontend/
ASSETS = HERE / "public" / "assets"
SEARCH_DIRS = [HERE / "src", HERE / "mock-rgs"]
SEARCH_FILES = [HERE / "index.html"]
CODE_EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".html", ".css", ".json"}


def load_code() -> str:
    blobs = []
    for d in SEARCH_DIRS:
        if not d.exists():
            continue
        for f in d.rglob("*"):
            if f.is_file() and f.suffix in CODE_EXT:
                blobs.append(f.read_text(encoding="utf-8", errors="ignore"))
    for f in SEARCH_FILES:
        if f.exists():
            blobs.append(f.read_text(encoding="utf-8", errors="ignore"))
    return "\n".join(blobs)


def audio_fallback_paths(code: str) -> set:
    """audio.ts resolves a track as `TRACK_PATHS[t] ?? AUDIO_BASE + t + ".mp3"`.

    So every TrackName WITHOUT an explicit TRACK_PATHS entry silently loads
    assets/audio/<track>.mp3 — a path that appears nowhere in the source. Miss
    this and the audit condemns most of the audio folder while the game is
    still playing those files.
    """
    m = re.search(r"type TrackName\s*=(.+?);", code, re.S)
    if not m:
        return set()
    tracks = set(re.findall(r'"([^"]+)"', m.group(1)))
    explicit = set()
    tp = re.search(r"const TRACK_PATHS[^=]*=\s*\{(.+?)\n\};", code, re.S)
    if tp:
        explicit = {k for k, _ in re.findall(r"(\w+)\s*:\s*\"([^\"]+)\"", tp.group(1))}
    base = re.search(r'const AUDIO_BASE\s*=\s*"([^"]+)"', code)
    prefix = (base.group(1) if base else "assets/audio/").replace("assets/", "")
    return {f"{prefix}{t}.mp3" for t in tracks - explicit}


def main() -> None:
    code = load_code()
    dynamic = audio_fallback_paths(code)
    used, unused = [], []

    for f in sorted(ASSETS.rglob("*")):
        if not f.is_file():
            continue
        rel = f.relative_to(ASSETS).as_posix()
        name = f.name
        stem = f.stem
        # a skel bundle is referenced by its DIRECTORY name, not its filename
        skel_dir = f.parent.name if f.parent.parent.name == "skel" else None

        # NOTE: deliberately no bare-stem match. Every asset is referenced by a
        # real path or filename (audio via TRACK_PATHS, images via SYMBOL_ASSETS /
        # EXTRA_ASSETS / BG_ASSETS), whereas a bare stem like "safe" or "empty"
        # collides with ordinary words in comments and code and silently marks
        # dead files as used.
        hit = None
        for needle, why in [
            (rel, "path"),
            (quote(rel), "path(url-enc)"),
            (name, "filename"),
            (quote(name), "filename(url-enc)"),
        ]:
            if needle and needle in code:
                hit = why
                break
        if not hit and skel_dir and f'skel/{skel_dir}' in code:
            hit = "skel dir"
        if not hit and rel in dynamic:
            hit = "audio TrackName fallback"

        (used if hit else unused).append((rel, f.stat().st_size, hit))

    tot_u = sum(s for _, s, _ in unused)
    print(f"USED: {len(used)} file(s)")
    print(f"UNUSED: {len(unused)} file(s), {tot_u/1024/1024:.2f} MB\n")
    for rel, size, _ in sorted(unused, key=lambda x: -x[1]):
        print(f"  {size/1024:9.1f} KB  {rel}")

    if "--delete" in sys.argv:
        for rel, _, _ in unused:
            (ASSETS / rel).unlink()
        print(f"\nDELETED {len(unused)} file(s), freed {tot_u/1024/1024:.2f} MB")
    else:
        print("\n(report only — pass --delete to remove them)")


if __name__ == "__main__":
    main()
