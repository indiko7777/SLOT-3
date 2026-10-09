/**
 * Currency display, exactly as Engine's RGS docs list it (studio.engine.io/docs/rgs,
 * "Currencies"): the symbol, its side, and the currency's own decimals — USD
 * "$10.00", JPY "¥10", DKK "10.00 kr", XSC "10.00 SC".
 *
 * Two rules on top of the table (Engine approval #219 / #273):
 *  - the BALANCE is rounded to the currency's decimals;
 *  - every other amount (bet, win, cost) is EXACT: it keeps the currency's
 *    decimals as a minimum and adds as many more as the value needs, up to the
 *    RGS's six (a 0.05x win on a 0.01 bet is "$0.0005", never "$0.00").
 */

interface CurrencyFormat {
  symbol: string;
  decimals: number;
  /** true → "10.00 kr" (symbol after the number); false → "$10.00". */
  after: boolean;
}

const pre = (symbol: string, decimals = 2): CurrencyFormat => ({ symbol, decimals, after: false });
const post = (symbol: string, decimals = 2): CurrencyFormat => ({ symbol, decimals, after: true });

const TABLE: Record<string, CurrencyFormat> = {
  USD: pre("$"), CAD: pre("CA$"), JPY: pre("¥", 0), EUR: pre("€"), RUB: pre("₽"),
  CNY: pre("CN¥"), PHP: pre("₱"), INR: pre("₹"), IDR: pre("Rp", 0), KRW: pre("₩", 0),
  BRL: pre("R$"), MXN: pre("MX$"), DKK: post("kr"), PLN: post("zł"), VND: post("₫", 0),
  TRY: pre("₺"), CLP: post("CLP", 0), ARS: post("ARS"), PEN: pre("S/"), NGN: pre("₦"),
  SAR: post("SAR"), ILS: pre("₪"), AED: post("AED"), TWD: pre("NT$"), NOK: post("kr"),
  KWD: pre("KD", 3), JOD: pre("JD", 3), CRC: pre("₡"), TND: post("TND", 3), SGD: pre("SG$"),
  MYR: pre("RM"), OMR: post("OMR", 3), QAR: post("QAR"), BHD: pre("BD", 3), PKR: pre("₨"),
  EGP: post("EGP"), NZD: pre("NZ$"), BOB: pre("Bs"), GHS: pre("GH₵"), KES: pre("KSh"),
  MAD: post("MAD"), BAM: pre("KM"), ISK: post("kr", 0), TZS: pre("TSh"), UGX: pre("USh", 0),
  XOF: post("CFA", 0), XGC: post("GC"), XSC: post("SC"), XEC: post("SC"),
  // Display codes the game already maps social currencies to.
  GC: post("GC"), SC: post("SC"),
};

const MAX_DECIMALS = 6;

let active: CurrencyFormat = TABLE.USD!;

/** Set once from the RGS balance currency (or the URL `currency`). Unknown codes
 *  fall back to "10.00 CODE" so nothing ever shows a wrong symbol. */
export function setActiveCurrency(code: string): void {
  const key = (code || "").toUpperCase();
  active = TABLE[key] ?? post(key || "USD");
}

export function currencyDecimals(): number {
  return active.decimals;
}

/** The currency mark on its own (for labels that style it separately). */
export function currencySymbol(): string {
  return active.symbol;
}

/** Decimals needed to show `amount` exactly, never fewer than the currency's own. */
export function exactDecimals(amount: number, min = active.decimals): number {
  const micro = Math.round(Math.abs(amount) * 10 ** MAX_DECIMALS);
  let decimals = MAX_DECIMALS;
  while (decimals > min && micro % 10 ** (MAX_DECIMALS - decimals + 1) === 0) decimals--;
  return decimals;
}

/** Just the number, grouped, at a fixed precision. */
export function moneyNumber(amount: number, decimals: number): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: true,
  });
}

function withSymbol(num: string): string {
  return active.after ? `${num} ${active.symbol}` : `${active.symbol}${num}`;
}

/** An exact amount (bet, win, cost): "$1.50", "$0.0005", "¥1,200", "10.00 SC". */
export function money(amount: number, decimals = exactDecimals(amount)): string {
  return withSymbol(moneyNumber(amount, decimals));
}

/** The balance: rounded to the currency's decimals. */
export function moneyBalance(amount: number): string {
  return withSymbol(moneyNumber(amount, active.decimals));
}
