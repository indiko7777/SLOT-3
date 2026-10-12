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
    const { res, json } = await this.requestJson(
      `${this.session.rgsBase}${path}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    );
    if (!json) throw new RgsError("ERR_GE", `RGS ${path} returned no JSON`);
    const code = json.status?.statusCode;
    if (code && code !== "SUCCESS") {
      throw new RgsError(code, json.status?.statusMessage || json.error || code);
    }
    // Engine also reports failures as { error: "ERR_…", message }.
    if (!res.ok && typeof json.error === "string" && json.error.startsWith("ERR_")) {
      throw new RgsError(json.error, json.message || json.error);
    }
    if (!res.ok) {
      throw new RgsError(TRANSIENT_HTTP.has(res.status) ? "ERR_UNAVAILABLE" : "ERR_GE", `RGS request failed (${res.status})`);
    }
    return json as T;
  }

  /**
   * Engine's RGS drops idle connections, and browsers never re-send a POST
   * that hit a dead socket: the first request after a quiet spell can fail
   * ("Failed to fetch" / 503) while the same request a second later succeeds.
   * Calls that are safe to repeat are retried with a short backoff.
   */
  private async retrying<T>(call: () => Promise<T>, delays = RETRY_DELAYS): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call();
      } catch (error) {
        if (!isTransientRgsError(error) || attempt >= delays.length) throw error;
        await sleep(delays[attempt]!);
      }
    }
  }

  /** The deadline covers headers AND body, including a server that stalls JSON. */
  private async requestJson(url: string, init: RequestInit = {}): Promise<{res: Response; json: any}> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const res = await fetch(url, { ...init, signal: abort.signal });
      const json = await res.json();
      return { res, json };
    } catch (error) {
      throw new RgsError("ERR_NETWORK", `RGS response could not complete: ${String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  authenticate(): Promise<AuthenticateResponse> {
    return this.retrying(() => this.post<AuthenticateResponse>("/wallet/authenticate", {
      sessionID: this.session.sessionID,
      language: this.session.lang
    }));
  }

  /** `amount` is in DISPLAY units; converted to 6dp integer here. Every play
   *  is debited by the RGS — there is deliberately NO zero-cost play path.
   *
   *  A play is never blindly re-sent: when one fails in transit the RGS is
   *  asked what happened. An active round means it went through (that round is
   *  returned and played); a lower balance means it went through and settled
   *  itself as a zero win; neither means it never arrived, so it is sent again.
   *  `balanceBefore` is the display balance before this play. */
  async play(amount: number, currency: string, mode: string, balanceBefore: number): Promise<PlayResponse> {
    const send = () => this.post<PlayResponse>("/wallet/play", {
      sessionID: this.session.sessionID,
      amount: Math.round(amount * API_AMOUNT_MULTIPLIER),
      currency,
      mode
    });
    for (let attempt = 0; ; attempt++) {
      try {
        return await send();
      } catch (error) {
        if (!isTransientRgsError(error) || attempt >= 2) throw error;
        const auth = await this.authenticate();
        if (auth.round?.active && auth.round.state?.length) {
          return { status: auth.status, balance: auth.balance, round: auth.round, error: null };
        }
        if (toDisplay(auth.balance.amount) < balanceBefore - 1e-9) {
          throw new RgsError("ERR_SETTLED", "The round settled while the connection dropped", auth.balance.amount);
        }
        await sleep(RETRY_DELAYS[attempt]!);
      }
    }
  }

  /** Settles the active round. If an earlier attempt reached the RGS but its
   *  reply was lost, the retry finds no round to end; the balance is then read
   *  from authenticate instead. */
  async endRound(): Promise<EndRoundResponse> {
    let dropped = false;
    try {
      return await this.retrying(async () => {
        try {
          return await this.post<EndRoundResponse>("/wallet/end-round", { sessionID: this.session.sessionID });
        } catch (error) {
          if (isTransientRgsError(error)) dropped = true;
          throw error;
        }
      });
    } catch (error) {
      if (!dropped || isTransientRgsError(error)) throw error;
      const auth = await this.authenticate();
      if (auth.round?.active) throw error;
      return { status: auth.status, balance: auth.balance, error: null };
    }
  }

  event(eventIndex: number): Promise<EventResponse> {
    return this.retrying(() => this.post<EventResponse>("/bet/event", {
      sessionID: this.session.sessionID,
      event: String(eventIndex)
    }));
  }

  async getReplayData(game: string, version: string, mode: string, event: string): Promise<any> {
    const path = [game, version, mode, event].map(encodeURIComponent).join("/");
    const url = `${this.session.rgsBase}/bet/replay/${path}?lang=${encodeURIComponent(this.session.lang)}`;
    const { res, json } = await this.retrying(async () => {
      const r = await this.requestJson(url);
      if (!r.res.ok && TRANSIENT_HTTP.has(r.res.status)) throw new RgsError("ERR_UNAVAILABLE", `RGS replay failed (${r.res.status})`);
      return r;
    });
    if (!res.ok) throw new RgsError("ERR_GE", `RGS replay failed (${res.status})`);
    if (!json || !Array.isArray(json.state) || json.state.length === 0) throw new RgsError("ERR_GE", "RGS replay returned no events");
    return json;
  }
}

const TRANSIENT_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);
/** Backoff between attempts: about 6 s in all before giving up. */
const RETRY_DELAYS = [400, 900, 1800, 3000];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A dropped connection or a busy server: worth asking again. */
export function isTransientRgsError(error: unknown): boolean {
  return error instanceof RgsError && (error.code === "ERR_NETWORK" || error.code === "ERR_UNAVAILABLE");
}

export class RgsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** ERR_SETTLED: the wallet balance (API units) after the settled round. */
    readonly balanceAmount?: number
  ) {
    super(message);
    this.name = "RgsError";
  }
}

export const toDisplay = (apiAmount: number): number =>
  apiAmount / API_AMOUNT_MULTIPLIER;

