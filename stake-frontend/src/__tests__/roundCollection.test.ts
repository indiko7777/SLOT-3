import { describe, expect, it } from "vitest";
import { countRoundWilds, sanitizeReceipts } from "../meta/roundCollection";
import type { Board, GameEvent } from "../domain";

const board = (): Board => Array.from({length:5},()=>["CASH","CASH","CASH","CASH"]);
describe("collection recovery", () => {
  it("counts a surviving wild only once while counting new refills", () => {
    const initial=board(); initial[0]![0]="WILD";
    const refill=board(); refill[0]![0]="WILD"; refill[0]![1]="WILD";
    const final=board(); final[0]![1]="WILD"; final[0]![2]="WILD";
    const events:GameEvent[]=[
      {type:"board_settle",board:initial},
      {type:"tumble_remove",positions:[[0,3],[0,3]]},
      {type:"tumble_drop",board:refill},
      {type:"tumble_remove",positions:[[0,3]]},
      {type:"tumble_drop",board:final},
    ];
    expect(countRoundWilds(events)).toBe(2);
  });
  it("preserves a valid award receipt across reload and rejects corrupted values", () => {
    expect(sanitizeReceipts(JSON.parse(JSON.stringify({a:{wilds:3,consumed:true},b:{wilds:-1},c:null})))).toEqual({a:{wilds:3,consumed:true}});
    expect(sanitizeReceipts(undefined)).toEqual({});
  });
});
