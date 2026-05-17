import type { GameEvent } from "../domain";

/**
 * Stake RGS wire types. Source of truth: StakeEngine/web-sdk
 * (packages/rgs-fetcher schema + packages/rgs-requests). All money is integer
 * with 6 decimals of precision (API_AMOUNT_MULTIPLIER = 1_000_000).
 */
export const API_AMOUNT_MULTIPLIER = 1_000_000;
/** Book/event payout multipliers are 2dp integers (BOOK_AMOUNT_MULTIPLIER). */
export const BOOK_AMOUNT_MULTIPLIER = 100;

export type StatusCode =
  | "SUCCESS"
  | "ERR_SCR"
  | "ERR_OPT"
  | "ERR_IPB"
  | "ERR_IS"
  | "ERR_ATE"
  | "ERR_GLE"
  | "ERR_BNF"
  | "ERR_UE"
  | "ERR_GE"
  | "ERR_VAL";

export interface StatusObject {
  statusCode: StatusCode;
  statusMessage: string;
}

export interface BalanceObject {
  amount: number; // integer, 6dp
  currency: string;
}

export interface BetModeObject {
  mode: string;
  costMultiplier: number;
  feature: boolean;
}

export interface Jurisdiction {
  socialCasino: boolean;
  disabledFullscreen: boolean;
  disabledTurbo: boolean;
  disabledSuperTurbo: boolean;
  disabledAutoplay: boolean;
  disabledSlamstop: boolean;
  disabledSpacebar: boolean;
  disabledBuyFeature: boolean;
  displayNetPosition: boolean;
  displayRTP: boolean;
  displaySessionTimer: boolean;
  minimumRoundDuration: number;
}

export interface RgsConfig {
  minBet: number; // 6dp
  maxBet: number; // 6dp
  stepBet: number; // 6dp
  defaultBetLevel: number; // 6dp
  betLevels: number[]; // 6dp
  betModes: Record<string, BetModeObject>;
  jurisdiction: Jurisdiction;
}

export interface RoundDetail {
  roundID: number;
  amount: number; // 6dp wagered
  payout: number; // 6dp
  payoutMultiplier: number; // float, x of bet
  active: boolean;
  mode: string;
  event: string | null;
  state: GameEvent[]; // the chosen book's event stream
}

export interface AuthenticateResponse {
  status: StatusObject;
  balance: BalanceObject;
  config: RgsConfig;
  round: RoundDetail | null;
  error: string | null;
}

export interface PlayResponse {
  status: StatusObject;
  balance: BalanceObject;
  round: RoundDetail;
  error: string | null;
}

export interface EndRoundResponse {
  status: StatusObject;
  balance: BalanceObject;
  error: string | null;
}

export interface EventResponse {
  status: StatusObject;
  event: string;
  error: string | null;
}
