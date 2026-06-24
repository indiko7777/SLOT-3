import { describe, expect, it } from "vitest";
import {
  GALLERY_MASTER_UNLOCK,
  GIRLS,
  addWilds,
  collectWild,
  currentGirl,
  displayedPieces,
  emptyGallery,
  isGalleryComplete,
  sanitize
} from "../src/meta/collection";
import { MemoryGalleryStore } from "../src/meta/GalleryStore";

describe("collection: 1 WILD = 1 body part", () => {
  it("reveals exactly one part per WILD", () => {
    const a = collectWild(emptyGallery());
    expect(a.data.pieces).toBe(1);
    expect(a.gain?.pieceIndex).toBe(1);
    expect(a.gain?.completedGirl).toBe(false);
    const b = collectWild(a.data);
    expect(b.data.pieces).toBe(2);
    expect(b.gain?.pieceIndex).toBe(2);
  });

  it("displayedPieces tracks the revealed parts", () => {
    const { data } = addWilds(emptyGallery(), 3);
    expect(displayedPieces(data)).toBe(3);
  });
});

describe("collection: girl completion", () => {
  it("completes girl 1 on her last WILD and grants her unlock", () => {
    const girl = GIRLS[0]!;
    const { data, gains } = addWilds(emptyGallery(), girl.pieces);
    expect(data.completed).toEqual([0]);
    expect(data.currentGirl).toBe(1);
    expect(data.pieces).toBe(0);
    expect(data.unlocks).toContain(girl.unlockId);
    const last = gains[gains.length - 1]!;
    expect(last.pieceIndex).toBe(girl.pieces);
    expect(last.completedGirl).toBe(true);
    expect(last.galleryComplete).toBe(false);
  });

  it("masters the whole gallery and grants the master unlock", () => {
    const total = GIRLS.reduce((a, g) => a + g.pieces, 0);
    const { data, gains } = addWilds(emptyGallery(), total);
    expect(isGalleryComplete(data)).toBe(true);
    expect(data.completed).toEqual([0, 1, 2]);
    expect(data.unlocks).toContain(GALLERY_MASTER_UNLOCK);
    expect(gains[gains.length - 1]!.galleryComplete).toBe(true);
    expect(currentGirl(data)).toBeNull();
    expect(displayedPieces(data)).toBe(GIRLS[GIRLS.length - 1]!.pieces);
  });

  it("never regresses once mastered and ignores further WILDs", () => {
    const total = GIRLS.reduce((a, g) => a + g.pieces, 0);
    const mastered = addWilds(emptyGallery(), total).data;
    const after = collectWild(mastered);
    expect(after.gain).toBeNull();
    expect(after.data.completed).toEqual([0, 1, 2]);
    expect(isGalleryComplete(after.data)).toBe(true);
  });
});

describe("collection: persistence", () => {
  it("round-trips through MemoryGalleryStore", () => {
    const store = new MemoryGalleryStore();
    const saved = addWilds(emptyGallery(), 5).data;
    store.save(saved);
    expect(store.load()).toEqual(sanitize(saved));
  });

  it("sanitizes corrupt data to a safe gallery", () => {
    expect(sanitize(null)).toEqual(emptyGallery());
    const repaired = sanitize({ currentGirl: 99, pieces: -3, completed: [1, 9], unlocks: [1 as never] });
    expect(repaired.currentGirl).toBe(GIRLS.length);
    expect(repaired.pieces).toBe(0);
    expect(repaired.completed).toEqual([1]);
    expect(repaired.unlocks).toEqual([]);
  });
});
