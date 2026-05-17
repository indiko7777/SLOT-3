import { describe, expect, it } from "vitest";
import { createFixtureRecords } from "../src/fixtures";
import { applyEvent, INITIAL_SNAPSHOT } from "../src/playback";

describe("event-driven frontend playback", () => {
  it("reaches the exact payoutMultiplier from replayed events", () => {
    const record = createFixtureRecords("base")[2];
    const finalSnapshot = record.events.reduce((snapshot, event) => applyEvent(snapshot, event, record), INITIAL_SNAPSHOT);

    expect(finalSnapshot.roundWin).toBe(record.payoutMultiplier);
    expect(finalSnapshot.state).toBe("big_win");
    expect(finalSnapshot.heatLevel).toBe(5);
    expect(finalSnapshot.globalMultiplier).toBe(8);
  });

  it("renders a capped Grand Escape as a capped max win state", () => {
    const record = createFixtureRecords("super_buy")[3];
    const finalSnapshot = record.events.reduce((snapshot, event) => applyEvent(snapshot, event, record), INITIAL_SNAPSHOT);

    expect(finalSnapshot.roundWin).toBe(5000);
    expect(finalSnapshot.capApplied).toBe(true);
    expect(finalSnapshot.lastMessage).toBe("Max win paid");
  });
});
