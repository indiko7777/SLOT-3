"""Rebuild only the brass motion; preserve its art, pivots and source rig."""
import json
import sys
from pathlib import Path

folder = Path(__file__).resolve().parent
sys.path.insert(0, str(folder.parents[1]))
from symbol_motion import build_for

rig = json.loads((folder / "brass_knuckles_source.json").read_text())
manifest = json.loads((folder / "manifest.json").read_text())
ctx = {"slots": [s["name"] for s in rig["slots"]],
       "bones": {b["name"]: b for b in rig["bones"]}, "manifest": manifest, "meta": {}}
canvas = manifest["canvas"]
rig["animations"] = build_for("brass_knuckles", [], canvas["h"], max(canvas.values()), ctx)
rig["events"] = {e["name"]: {} for anim in rig["animations"].values() for e in anim.get("events", [])}
(folder / "brass_knuckles.json").write_text(json.dumps(rig, separators=(",", ":")))
