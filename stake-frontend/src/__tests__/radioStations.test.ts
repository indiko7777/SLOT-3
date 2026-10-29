import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MUSIC_TRACKS, STATION_AUDIO, TRACK_PATHS } from "../audio";
import { RADIO_STATIONS } from "../radio";

const PUBLIC = resolve(__dirname, "../../public");

describe("radio stations and music beds", () => {
  it("every wheel station has audio, and every music file ships", () => {
    for (const st of RADIO_STATIONS) {
      const cfg = STATION_AUDIO[st.id];
      expect(cfg, st.id).toBeDefined();
      if (cfg.kind !== "track") continue;
      const path = TRACK_PATHS[cfg.track];
      expect(path, `${st.id} → ${cfg.track}`).toBeTruthy();
      expect(existsSync(resolve(PUBLIC, path!)), path).toBe(true);
    }
    expect(existsSync(resolve(PUBLIC, TRACK_PATHS.bg_bonus!))).toBe(true);
  });

  it("GROOVY FM replaced VAULT FM in the same slot with the same icon", () => {
    const ids = RADIO_STATIONS.map((s) => s.id);
    expect(ids).not.toContain("vault");
    const i = ids.indexOf("groovy");
    expect(i).toBe(1);
    expect(RADIO_STATIONS[i]!.icon).toBe("💰");
    expect(STATION_AUDIO.groovy).toEqual({ kind: "track", track: "groovy" });
    // The bonus music belongs to the Getaway only, never to a radio station.
    expect(Object.values(STATION_AUDIO).some((c) => c.kind === "track" && c.track === "bg_bonus")).toBe(false);
  });

  it("every long music bed is decoded one at a time on phones", () => {
    // iPhone 12 crash: a fully decoded 2-min stereo bed is ~45-60 MB of PCM.
    for (const c of Object.values(STATION_AUDIO)) if (c.kind === "track") expect(MUSIC_TRACKS.has(c.track), c.track).toBe(true);
    expect(MUSIC_TRACKS.has("bg_bonus")).toBe(true);
  });
});
