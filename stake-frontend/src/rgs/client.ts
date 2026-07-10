import {
  API_AMOUNT_MULTIPLIER,
  type AuthenticateResponse,
  type EndRoundResponse,
  type EventResponse,
  type PlayResponse
} from "./types";
import type { GameSession } from "./session";

/**
 * Minimal, faithful Stake RGS HTTP client (mirrors StakeEngine/web-sdk
 * rgs-requests). Every wallet figure the game shows comes from these
 * responses — the game never invents balance, currency or bet sizing.
 */
export class RgsClient {
  constructor(private readonly session: GameSession) {}

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.session.rgsBase}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new RgsError("ERR_NETWORK", `RGS unreachable: ${String(e)}`);
    }
    const json = (await res.json().catch(() => null)) as
      | (T & { status?: { statusCode: string; statusMessage: string }; error?: string | null })
      | null;
    if (!json) throw new RgsError("ERR_GE", `RGS ${path} returned no JSON`);
    const code = json.status?.statusCode;
    if (code && code !== "SUCCESS") {
      throw new RgsError(code, json.status?.statusMessage || json.error || code);
    }
    return json as T;
  }

  authenticate(): Promise<AuthenticateResponse> {
    return this.post<AuthenticateResponse>("/wallet/authenticate", {
      sessionID: this.session.sessionID,
      language: this.session.lang
    });
  }

  /** `amount` is in DISPLAY units; converted to 6dp integer here. Every play
   *  is debited by the RGS — there is deliberately NO zero-cost play path. */
  play(amount: number, currency: string, mode: string): Promise<PlayResponse> {
    return this.post<PlayResponse>("/wallet/play", {
      sessionID: this.session.sessionID,
      amount: Math.round(amount * API_AMOUNT_MULTIPLIER),
      currency,
      mode
    });
  }

  endRound(): Promise<EndRoundResponse> {
    return this.post<EndRoundResponse>("/wallet/end-round", {
      sessionID: this.session.sessionID
    });
  }

  event(eventIndex: number): Promise<EventResponse> {
    return this.post<EventResponse>("/bet/event", {
      sessionID: this.session.sessionID,
      event: String(eventIndex)
    });
  }

  async getReplayData(game: string, version: string, mode: string, event: string): Promise<any> {
    const url = `${this.session.rgsBase}/bet/replay/${game}/${version}/${mode}/${event}?lang=${this.session.lang}`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new RgsError("ERR_NETWORK", `RGS unreachable for replay: ${String(e)}`);
    }
    const json = await res.json().catch(() => null);
    if (!json) throw new RgsError("ERR_GE", `RGS replay returned no JSON`);
    return json;
  }
}

export class RgsError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "RgsError";
  }
}

export const toDisplay = (apiAmount: number): number =>
  apiAmount / API_AMOUNT_MULTIPLIER;

export const formatBalance = (amount: number): string => amount.toFixed(2);
export const formatWin = (amount: number): string => {
  const parts = amount.toString().split(".");
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]}.${parts[1]!.substring(0, 4)}`;
};
