/**
 * Financial maths for the calculators.
 *
 * Everything here is a pure function with no React and no formatting, so the
 * numbers can be unit-tested and reasoned about independently of the UI.
 *
 * Cost model reflects Indian equity trading as of the FY25-26 regulatory
 * position. Rates are collected in one place so they can be corrected in one
 * edit if a broker or the regulator changes them.
 */

export const DASH = "—";

/** Guard against NaN/Infinity leaking into the UI as a blank or a crash. */
export function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Round to `digits` decimals without float drift (e.g. 1.005 -> 1.01). */
export function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  // The epsilon nudge avoids 1.0049999999 rounding down because of binary float.
  return Math.round((value + Number.EPSILON * Math.abs(value)) * factor) / factor;
}

// ─────────────────────────────────────────────────────────────────────────────
// Indian equity trading cost model
// ─────────────────────────────────────────────────────────────────────────────

export interface CostRates {
  /** Per executed order, whichever is lower: flat fee or % of turnover. */
  brokerageFlat: number;
  brokeragePct: number;
  /** STT rate as a percent, applied to the sell leg unless both sides apply. */
  sttSellPct: number;
  /** When true, intraday STT is charged on the buy leg as well. */
  sttBothSides: boolean;
  /** Exchange transaction charge, applied to both sides. */
  exchangePct: number;
  /** SEBI turnover fee, INR 10 per crore of turnover. */
  sebiPct: number;
  /** Stamp duty, applied to the buy side only. */
  stampBuyPct: number;
  /** GST, charged on brokerage + SEBI + exchange + stamp. */
  gstPct: number;
}

export const DELIVERY_COSTS: CostRates = {
  brokerageFlat: 20,
  brokeragePct: 0.03,
  sttSellPct: 0.1,
  sttBothSides: false,
  exchangePct: 0.00297,
  sebiPct: 0.000001,
  stampBuyPct: 0.015,
  gstPct: 18,
};

/** Intraday equity: STT drops to 0.025% of the sell leg, still sell-side only. */
export const INTRADAY_COSTS: CostRates = {
  brokerageFlat: 20,
  brokeragePct: 0.03,
  sttSellPct: 0.025,
  sttBothSides: false,
  exchangePct: 0.00297,
  sebiPct: 0.000001,
  stampBuyPct: 0.015,
  gstPct: 18,
};

/** Futures STT is 0.02% of sell value; stamp duty is 0.002% of buy value. */
export const FUTURES_COSTS: CostRates = {
  brokerageFlat: 20,
  brokeragePct: 0.03,
  sttSellPct: 0.02,
  sttBothSides: false,
  exchangePct: 0.00173,
  sebiPct: 0.000001,
  stampBuyPct: 0.002,
  gstPct: 18,
};

/**
 * Options charges apply to the premium, not the strike. STT is 0.1% of the
 * premium traded on the sell leg.
 */
export const OPTIONS_COSTS: CostRates = {
  brokerageFlat: 20,
  brokeragePct: 0.03,
  sttSellPct: 0.1,
  sttBothSides: false,
  exchangePct: 0.053,
  sebiPct: 0.000001,
  stampBuyPct: 0.003,
  gstPct: 18,
};

export type Segment = "delivery" | "intraday" | "futures" | "options";

export const SEGMENTS: Record<Segment, { label: string; short: string; rates: CostRates }> = {
  delivery: { label: "Equity Delivery", short: "DEL", rates: DELIVERY_COSTS },
  intraday: { label: "Equity Intraday", short: "INT", rates: INTRADAY_COSTS },
  futures: { label: "Equity Futures", short: "FUT", rates: FUTURES_COSTS },
  options: { label: "Equity Options", short: "OPT", rates: OPTIONS_COSTS },
};

export interface CostBreakdown {
  buyValue: number;
  sellValue: number;
  turnover: number;
  brokerage: number;
  stt: number;
  exchange: number;
  sebi: number;
  stampDuty: number;
  gst: number;
  total: number;
}

/**
 * Every charge on one round trip.
 *
 * Brokerage is charged per executed order, so a buy and a sell are two orders.
 * STT on delivery equity is levied on the sell leg only; stamp duty on the buy.
 * GST applies to brokerage + exchange + SEBI + stamp duty, never to STT.
 */
export function roundTripCosts(
  buyPrice: number,
  sellPrice: number,
  quantity: number,
  rates: CostRates = DELIVERY_COSTS,
): CostBreakdown {
  const qty = Math.max(0, finite(quantity));
  const buy = Math.max(0, finite(buyPrice));
  const sell = Math.max(0, finite(sellPrice));

  const buyValue = round(buy * qty);
  const sellValue = round(sell * qty);
  const turnover = round(buyValue + sellValue);

  // Brokerage is charged per executed order, so the buy and sell legs are
  // priced separately and each is capped at the flat fee. Applying the floor to
  // the combined turnover would double the percentage charge on small orders.
  const brokerage = round(
    Math.min(rates.brokerageFlat, (rates.brokeragePct / 100) * buyValue) +
      Math.min(rates.brokerageFlat, (rates.brokeragePct / 100) * sellValue),
  );
  const stt = round(
    rates.sttBothSides
      ? (rates.sttSellPct / 100) * turnover
      : (rates.sttSellPct / 100) * sellValue,
  );
  const exchange = round((rates.exchangePct / 100) * turnover);
  const sebi = round((rates.sebiPct / 100) * turnover);
  const stampDuty = round((rates.stampBuyPct / 100) * buyValue);

  const gst = round(
    (rates.gstPct / 100) * (brokerage + exchange + sebi + stampDuty),
  );

  return {
    buyValue,
    sellValue,
    turnover,
    brokerage,
    stt,
    exchange,
    sebi,
    stampDuty,
    gst,
    total: round(brokerage + stt + exchange + sebi + stampDuty + gst),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Position sizer
// ─────────────────────────────────────────────────────────────────────────────

export interface PositionSizerInput {
  capital: number;
  riskPercent: number;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  quantity?: number;
  costRates?: CostRates;
}

export interface PositionSizerResult {
  valid: boolean;
  /** Why the input was rejected, ready to show under the form. */
  problem: string | null;
  riskAmount: number;
  riskPerShare: number;
  rewardPerShare: number;
  quantity: number;
  positionValue: number;
  positionPercent: number;
  potentialProfit: number;
  potentialLoss: number;
  rewardRiskRatio: number;
  /** Fraction of risk consumed by round-trip charges. */
  breakevenMovePercent: number;
  cost: CostBreakdown;
  netProfit: number;
  netLoss: number;
  netRewardRiskRatio: number;
  capitalAtRisk: number;
}

export function positionSizer(input: PositionSizerInput): PositionSizerResult {
  const capital = Math.max(0, finite(input.capital));
  const riskPercent = finite(input.riskPercent);
  const entry = Math.max(0, finite(input.entryPrice));
  const stop = Math.max(0, finite(input.stopLoss));
  const target = Math.max(0, finite(input.targetPrice));
  const rates = input.costRates ?? DELIVERY_COSTS;

  const empty = {
    riskAmount: 0,
    riskPerShare: 0,
    rewardPerShare: 0,
    quantity: 0,
    positionValue: 0,
    positionPercent: 0,
    potentialProfit: 0,
    potentialLoss: 0,
    rewardRiskRatio: 0,
    breakevenMovePercent: 0,
    cost: roundTripCosts(0, 0, 0, rates),
    netProfit: 0,
    netLoss: 0,
    netRewardRiskRatio: 0,
    capitalAtRisk: 0,
  };

  if (capital <= 0) return { ...empty, valid: false, problem: "Enter a capital amount above zero." };
  if (riskPercent <= 0) return { ...empty, valid: false, problem: "Enter a risk percentage above zero." };
  if (entry <= 0) return { ...empty, valid: false, problem: "Enter an entry price above zero." };

  // A stop above entry inverts the position. This is the exact case the old
  // calculator silently turned into a size of zero, which read as a bug.
  if (stop >= entry) {
    return {
      ...empty,
      valid: false,
      problem: "Stop loss must be below the entry price for a long position.",
    };
  }

  const riskPerShare = round(entry - stop);
  // A stop a hair under entry rounds to a zero per-share risk, which would
  // divide by zero and size an infinite position. Reject it explicitly.
  if (riskPerShare <= 0) {
    return {
      ...empty,
      valid: false,
      problem: "Entry and stop are too close to define a per-share risk. Widen the stop distance.",
    };
  }

  const riskAmount = round((capital * riskPercent) / 100);
  const quantity = Math.floor(riskAmount / riskPerShare);
  const positionValue = round(quantity * entry);
  const rewardPerShare = round(Math.max(0, target - entry));
  const potentialProfit = round(quantity * rewardPerShare);
  const potentialLoss = round(quantity * riskPerShare);
  const rewardRiskRatio = round(rewardPerShare / riskPerShare);
  const positionPercent = capital > 0 ? round((positionValue / capital) * 100) : 0;

  const cost = roundTripCosts(entry, target > 0 ? target : entry, quantity, rates);

  // How far the price must move just to cover the round-trip charges.
  const breakevenMovePercent = quantity > 0 ? round((cost.total / (quantity * entry)) * 100) : 0;

  // Net figures treat the charge as paid on the losing leg too, which is the
  // conservative and correct way to judge whether a trade is worth taking.
  const netProfit = round(potentialProfit - cost.total);
  const netLoss = round(potentialLoss + cost.total);
  const netRewardRiskRatio = netLoss > 0 ? round(netProfit / netLoss) : 0;

  return {
    valid: true,
    problem: null,
    riskAmount,
    riskPerShare,
    rewardPerShare,
    quantity,
    positionValue,
    positionPercent,
    potentialProfit,
    potentialLoss,
    rewardRiskRatio,
    breakevenMovePercent,
    cost,
    netProfit,
    netLoss,
    netRewardRiskRatio,
    capitalAtRisk: round(potentialLoss),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Trade net P&L
// ─────────────────────────────────────────────────────────────────────────────

export type Direction = "LONG" | "SHORT";

export interface TradePnlInput {
  direction: Direction;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  costRates?: CostRates;
}

export interface TradePnlResult {
  direction: Direction;
  grossPnl: number;
  grossReturnPercent: number;
  cost: CostBreakdown;
  netPnl: number;
  netReturnPercent: number;
  breakevenExitPrice: number;
  /** Value of one pip/point: for options and futures this is the multiplier. */
  pointsCaptured: number;
}

export function tradePnl(input: TradePnlInput): TradePnlResult {
  const direction = input.direction;
  const entry = Math.max(0, finite(input.entryPrice));
  const exit = Math.max(0, finite(input.exitPrice));
  const qty = Math.max(0, finite(input.quantity));
  const rates = input.costRates ?? DELIVERY_COSTS;

  const perShare = direction === "LONG" ? exit - entry : entry - exit;
  const grossPnl = round(perShare * qty);
  const turnoverValue = round(entry * qty);
  const grossReturnPercent = turnoverValue > 0 ? round((grossPnl / turnoverValue) * 100) : 0;

  // For a short the buy leg is the cover, so the charge profile mirrors.
  const cost =
    direction === "LONG"
      ? roundTripCosts(entry, exit, qty, rates)
      : roundTripCosts(exit, entry, qty, rates);

  const netPnl = round(grossPnl - cost.total);
  const netReturnPercent = turnoverValue > 0 ? round((netPnl / turnoverValue) * 100) : 0;

  // The exit price at which the trade nets to zero after charges.
  const costPerShare = qty > 0 ? cost.total / qty : 0;
  const breakevenExitPrice = round(
    direction === "LONG" ? entry + costPerShare : entry - costPerShare,
  );

  return {
    direction,
    grossPnl,
    grossReturnPercent,
    cost,
    netPnl,
    netReturnPercent,
    breakevenExitPrice,
    pointsCaptured: round(Math.abs(perShare)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Systematic investment plan
// ─────────────────────────────────────────────────────────────────────────────

export interface SipInput {
  monthly: number;
  annualReturnPercent: number;
  years: number;
  /** Extra lump sum invested at the start. */
  initialLumpSum?: number;
  /** Step-up applied to the contribution every year, in percent. */
  annualStepUpPercent?: number;
}

export interface YearRow {
  year: number;
  contribution: number;
  invested: number;
  value: number;
  returns: number;
}

export interface SipResult {
  totalInvested: number;
  finalValue: number;
  gain: number;
  gainPercent: number;
  /** Absolute return earned per year, in rupees. */
  absoluteReturnPercent: number;
  yearly: YearRow[];
}

/**
 * Future value of a monthly SIP.
 *
 * The monthly rate compounds `n` times per year against the monthly
 * contribution, and the yearly table applies the step-up to the contribution
 * from the second year onward.
 */
export function sip(input: SipInput): SipResult {
  const monthly = Math.max(0, finite(input.monthly));
  const years = Math.max(0, Math.floor(finite(input.years)));
  const annualPct = finite(input.annualReturnPercent);
  const lump = Math.max(0, finite(input.initialLumpSum ?? 0));
  const stepUp = Math.max(-100, finite(input.annualStepUpPercent ?? 0));

  const monthlyRate = annualPct / 100 / 12;
  const yearly: YearRow[] = [];

  let value = lump;
  let invested = lump;
  let contribution = monthly;

  for (let year = 1; year <= years; year += 1) {
    if (year > 1) contribution = round(contribution * (1 + stepUp / 100));

    let contributed = 0;
    for (let month = 0; month < 12; month += 1) {
      // Standard annuity-immediate: the existing balance compounds first, then
      // the month's contribution lands. This matches
      //   FV = P x (((1 + i)^n - 1) / i)
      // so a SIP projection can be checked against any standard reference.
      if (monthlyRate === 0) {
        value += contribution;
      } else {
        value = value * (1 + monthlyRate) + contribution;
      }
      contributed += contribution;
    }

    invested = round(invested + contributed);
    value = round(value);
    yearly.push({
      year,
      contribution: round(contribution),
      invested,
      value,
      returns: round(value - invested),
    });
  }

  const finalValue = round(value);
  const totalInvested = round(invested);
  const gain = round(finalValue - totalInvested);

  // Absolute annualised return (CAGR) on the actual capital deployed.
  let cagr = 0;
  if (finalValue > 0 && invested > 0 && years > 0) {
    cagr = round(((finalValue / invested) ** (1 / years) - 1) * 100);
  }

  return {
    totalInvested,
    finalValue,
    gain,
    gainPercent: totalInvested > 0 ? round((gain / totalInvested) * 100) : 0,
    absoluteReturnPercent: cagr,
    yearly,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compounding and annualised return
// ─────────────────────────────────────────────────────────────────────────────

export interface CompoundingInput {
  principal: number;
  ratePercent: number;
  years: number;
  compoundsPerYear?: number;
}

export interface CompoundingResult {
  futureValue: number;
  interestEarned: number;
  effectiveAnnualPercent: number;
}

/** Compound growth, plus the effective annual rate after compounding. */
export function compounding(input: CompoundingInput): CompoundingResult {
  const principal = Math.max(0, finite(input.principal));
  const rate = finite(input.ratePercent) / 100;
  const years = Math.max(0, finite(input.years));
  const n = Math.max(1, Math.floor(finite(input.compoundsPerYear ?? 12)));

  const futureValue = round(principal * (1 + rate / n) ** (n * years));
  const interestEarned = round(futureValue - principal);
  const effective = rate === 0 || years === 0 ? 0 : round(((1 + rate / n) ** n - 1) * 100);

  return { futureValue, interestEarned, effectiveAnnualPercent: effective };
}

/** CAGR between two values over a number of years. */
export function cagrPercent(from: number, to: number, years: number): number {
  const a = finite(from);
  const b = finite(to);
  const y = finite(years);
  if (a <= 0 || y <= 0) return 0;
  return round(((b / a) ** (1 / y) - 1) * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Margin and leverage
// ─────────────────────────────────────────────────────────────────────────────

export interface MarginInput {
  capital: number;
  positionValue: number;
  /** Exchange-side span requirement as a percent of position value. */
  spanPercent?: number;
  /** Leverage the broker grants on the funded portion. */
  leverage?: number;
}

export interface MarginResult {
  ownCapital: number;
  marginRequired: number;
  leverageAchieved: number;
  /** How much further the position can grow before the account is stressed. */
  additionalCapacity: number;
  blocked: boolean;
}

/**
 * Intraday equity margin: a portion of the position is blocked by the exchange
 * and the remainder is funded by the broker at the chosen leverage.
 */
export function marginRequirement(input: MarginInput): MarginResult {
  const capital = Math.max(0, finite(input.capital));
  const value = Math.max(0, finite(input.positionValue));
  const spanPct = Math.max(0, finite(input.spanPercent ?? 25)) / 100;
  const leverage = Math.max(1, finite(input.leverage ?? 5));

  const blocked = value * spanPct;
  const funded = value - blocked;
  const marginRequired = round(blocked + funded / leverage);
  const leverageAchieved = marginRequired > 0 ? round(value / marginRequired) : 0;
  const additionalCapacity = round(Math.max(0, capital * leverage - value));

  return {
    ownCapital: capital,
    marginRequired,
    leverageAchieved,
    additionalCapacity,
    blocked: marginRequired > capital,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Valuation helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Market cap from price and shares, in rupees. */
export function marketCap(price: number, sharesOutstanding: number): number {
  return round(Math.max(0, finite(price)) * Math.max(0, finite(sharesOutstanding)));
}

/** Price/earnings, or null when earnings are not positive. */
export function peRatio(price: number, eps: number): number | null {
  const e = finite(eps);
  if (e <= 0) return null;
  return round(finite(price) / e);
}

/** Risk on capital from a peak equity value down to a trough. */
export function drawdownPercent(peak: number, trough: number): number {
  const p = finite(peak);
  if (p <= 0) return 0;
  return round(((p - finite(trough)) / p) * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Loans, deposits and withdrawals
// ─────────────────────────────────────────────────────────────────────────────

export interface EmiInput {
  principal: number;
  annualRatePercent: number;
  months: number;
}

export interface EmiResult {
  emi: number;
  totalPayment: number;
  totalInterest: number;
  /** Share of the first payment that goes to interest. */
  firstMonthInterest: number;
  firstMonthPrincipal: number;
}

/** Standard reducing-balance EMI: P x r x (1+r)^n / ((1+r)^n - 1). */
export function emi(input: EmiInput): EmiResult {
  const principal = Math.max(0, finite(input.principal));
  const months = Math.max(0, Math.floor(finite(input.months)));
  const r = finite(input.annualRatePercent) / 100 / 12;

  if (principal <= 0 || months <= 0) {
    return { emi: 0, totalPayment: 0, totalInterest: 0, firstMonthInterest: 0, firstMonthPrincipal: 0 };
  }

  // A zero-interest loan simply repays the principal.
  const payment = r === 0 ? principal / months : (principal * r * (1 + r) ** months) / ((1 + r) ** months - 1);
  const rounded = round(ceilingToPaisa( payment));
  const totalPayment = round(rounded * months);
  const firstMonthInterest = round(principal * r);

  return {
    emi: rounded,
    totalPayment,
    totalInterest: round(totalPayment - principal),
    firstMonthInterest,
    firstMonthPrincipal: round(rounded - firstMonthInterest),
  };
}

/** EMIs are quoted to the paisa, rounded up so the loan always clears. */
function ceilingToPaisa(value: number): number {
  return Math.ceil(value * 100) / 100;
}

/** Fixed and recurring deposits, both with selectable compounding frequency. */
export function deposit(
  amount: number,
  annualRatePercent: number,
  years: number,
  compoundsPerYear = 4,
): { maturity: number; interest: number; effectiveAnnualPercent: number } {
  const p = Math.max(0, finite(amount));
  const n = Math.max(1, Math.floor(finite(compoundsPerYear)));
  const y = Math.max(0, finite(years));
  const r = finite(annualRatePercent) / 100;

  const maturity = round(p * (1 + r / n) ** (n * y));
  return {
    maturity,
    interest: round(maturity - p),
    effectiveAnnualPercent: r === 0 ? 0 : round(((1 + r / n) ** n - 1) * 100),
  };
}

/**
 * Recurring deposit under Indian banking convention: each monthly instalment
 * earns simple interest for the remaining fraction of the tenure, and the
 * whole balance is compounded quarterly once.
 */
export function recurringDeposit(
  monthly: number,
  annualRatePercent: number,
  months: number,
): { maturity: number; invested: number; interest: number } {
  const m = Math.max(0, finite(monthly));
  const n = Math.max(0, Math.floor(finite(months)));
  const quarterlyRate = finite(annualRatePercent) / 100 / 4;

  let balance = 0;
  for (let i = 1; i <= n; i += 1) {
    // The i-th of n instalments compounds for the quarters that remain.
    balance += m * (1 + quarterlyRate) ** ((n - i + 1) / 3);
  }

  const maturity = round(balance);
  const invested = round(m * n);
  return { maturity, invested, interest: round(maturity - invested) };
}

export interface SwpResult {
  finalCorpus: number;
  totalWithdrawn: number;
  /** Year in which the corpus was exhausted, or null if it survived. */
  exhaustedInYear: number | null;
}

/** Systematic withdrawal plan: the balance grows by the return, then pays out. */
export function swp(
  corpus: number,
  monthlyWithdrawal: number,
  annualRatePercent: number,
  months: number,
): SwpResult {
  let balance = Math.max(0, finite(corpus));
  const payout = Math.max(0, finite(monthlyWithdrawal));
  const n = Math.max(0, Math.floor(finite(months)));
  const r = finite(annualRatePercent) / 100 / 12;

  let withdrawn = 0;
  let exhaustedInYear: number | null = null;

  for (let i = 1; i <= n; i += 1) {
    balance = balance * (1 + r) - payout;
    if (balance <= 0) {
      // The final, part-month payment only returns what was actually there.
      withdrawn += Math.max(0, balance + payout);
      balance = 0;
      exhaustedInYear = Math.ceil(i / 12);
      break;
    }
    withdrawn += payout;
  }

  return {
    finalCorpus: round(balance),
    totalWithdrawn: round(withdrawn),
    exhaustedInYear,
  };
}

export interface InflationResult {
  nominalValue: number;
  /** Worth in today's money once inflation is stripped out. */
  realValue: number;
  realRatePercent: number;
  purchasingPowerLostPercent: number;
}

/** Inflation adjustment using the exact Fisher relation, not a naive subtraction. */
export function inflationAdjusted(
  presentValue: number,
  nominalRatePercent: number,
  inflationPercent: number,
  years: number,
): InflationResult {
  const pv = Math.max(0, finite(presentValue));
  const y = Math.max(0, finite(years));
  const nominal = finite(nominalRatePercent) / 100;
  const infl = finite(inflationPercent) / 100;

  const nominalValue = round(pv * (1 + nominal) ** y);
  // Real value in today's rupees is the nominal amount deflated by inflation.
  const realValue = infl === 0 ? nominalValue : round(nominalValue / (1 + infl) ** y);
  const realRate = (1 + nominal) / (1 + infl) - 1;

  return {
    nominalValue,
    realValue,
    realRatePercent: round(realRate * 100),
    purchasingPowerLostPercent:
      nominalValue > 0 ? round(((nominalValue - realValue) / nominalValue) * 100) : 0,
  };
}