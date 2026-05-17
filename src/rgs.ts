import type { BetMode, RoundRecord } from "./domain";
import { validateRoundRecord } from "./domain";
import { createFixtureRecords } from "./fixtures";

export interface OutcomeRequest {
  mode: BetMode;
  stakeMultiplier: number;
}

export interface OutcomeProvider {
  requestOutcome(request: OutcomeRequest): Promise<RoundRecord>;
}

export class PrecomputedBookOutcomeProvider implements OutcomeProvider {
  private readonly books: Record<BetMode, RoundRecord[]>;
  private readonly cursors: Record<BetMode, number> = {
    base: 0,
    ante: 0,
    buy: 0,
    super_buy: 0
  };

  constructor() {
    this.books = {
      base: createFixtureRecords("base"),
      ante: createFixtureRecords("ante"),
      buy: createFixtureRecords("buy"),
      super_buy: createFixtureRecords("super_buy")
    };

    Object.values(this.books).flat().forEach(validateRoundRecord);
  }

  async requestOutcome({ mode }: OutcomeRequest): Promise<RoundRecord> {
    const book = this.books[mode];
    const cursor = this.cursors[mode] % book.length;
    this.cursors[mode] += 1;
    return structuredClone(book[cursor]);
  }

  getPreviewBoard(): RoundRecord {
    return structuredClone(this.books.base[2]);
  }
}
