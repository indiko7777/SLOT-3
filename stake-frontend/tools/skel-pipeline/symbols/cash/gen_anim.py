"""Regenerate wad and falling-note motion without rebuilding its illustrated art."""
import json
import sys
from pathlib import Path
folder = Path(__file__).resolve().parent
sys.path.insert(0, str(folder.parents[1]))
from symbol_motion import build_for
rig = json.loads((folder / "cash_source.json").read_text(encoding="utf-8"))
manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
ctx = {"slots": [s["name"] for s in rig["slots"]], "bones": {b["name"]: b for b in rig["bones"]},
       "manifest": manifest, "meta": json.loads((folder / "meta.json").read_text(encoding="utf-8"))}
canvas = manifest["canvas"]
rig["animations"] = build_for("cash", [], canvas["h"], max(canvas.values()), ctx)
rig["events"] = {e["name"]: {} for anim in rig["animations"].values() for e in anim.get("events", [])}
(folder / "cash.json").write_text(json.dumps(rig, separators=(",", ":")), encoding="utf-8")
