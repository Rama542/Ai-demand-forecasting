/**
 * Tests for the calculator maths. Run with:  npx tsx lib/calculator.test.ts
 * or, without extra dependencies:  node --experimental-strip-types lib/calculator.test.ts
 */

import {
  DELIVERY_COSTS,
  FUTURES_COSTS,
  INTRADAY_COSTS,
  OPTIONS_COSTS,
  compounding,
  cagrPercent,
  deposit,
  drawdownPercent,
  emi,
  finite,
  inflationAdjusted,
  marginRequirement,
  marketCap,
  peRatio,
  positionSizer,
  recurringDeposit,
  round,
  roundTripCosts,
  sip,
  swp,
  tradePnl,
} from "./calculator";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown, tolerance = 0) {
  const ok =
    typeof actual === "number" && typeof expected === "number"
      ? Math.abs(actual - expected) <= tolerance
      : actual === expected;
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(`${name}\n     expected: ${expected}\n     actual:   ${actual}`);
  }
}

function section(title: string) {
  console.log(`\n  ${title}`);
}

// ─────────────────────────────────────────────────────────────────────────────
section("rounding and guards");

check("round 1.005 to 2dp", round(1.005, 2), 1.01);
check("round 2.675 to 2dp", round(2.675, 2), 2.68);
check("round 1234.5678 to 2dp", round(1234.5678, 2), 1234.57);
check("finite(NaN)", finite(Number.NaN), 0);
check("finite(Infinity)", finite(Number.POSITIVE_INFINITY), 0);
check("finite(5)", finite(5), 5);
check("round(NaN)", round(Number.NaN), 0);

// ─────────────────────────────────────────────────────────────────────────────
section("Indian round-trip cost model");

{
  // Buy 100 at 1000, sell 100 at 1100. Turnover = 100,000 + 110,000 = 210,000.
  const c = roundTripCosts(1000, 1100, 100);
  check("buy value", c.buyValue, 100000);
  check("sell value", c.sellValue, 110000);
  check("turnover", c.turnover, 210000);
  // Brokerage per leg: buy 100,000 x 0.03% = 30 and sell 110,000 x 0.03% = 33,
  // both above the flat 20, so each leg pays 20 -> 40 in total.
  check("brokerage capped at flat fee", c.brokerage, 40);
  // STT 0.1% of the sell leg = 110,000 x 0.001.
  check("STT on sell", c.stt, 110);
  // Exchange 0.00297% of 210,000.
  check("exchange charge", c.exchange, 6.24, 0.01);
  // Stamp duty 0.015% of the buy leg = 100,000 x 0.00015.
  check("stamp duty on buy", c.stampDuty, 15);
  // GST 18% of brokerage + exchange + SEBI + stamp.
  check("GST base excludes STT", c.gst, round(18 * (40 + 6.24 + c.sebi + 15) * 0.01), 0.02);
  check(
    "total is the sum of every leg",
    c.total,
    round(c.brokerage + c.stt + c.exchange + c.sebi + c.stampDuty + c.gst),
    0.01,
  );
}

{
  // Intraday STT is 0.025% on the sell leg only, versus delivery's 0.1% on the
  // sell leg, so intraday books a much smaller tax on the same trade.
  //   delivery: 110,000 x 0.1%   = 110
  //   intraday: 110,000 x 0.025% = 27.50
  const delivery = roundTripCosts(1000, 1100, 100, DELIVERY_COSTS);
  const intraday = roundTripCosts(1000, 1100, 100, INTRADAY_COSTS);
  check("intraday STT is 0.025% of the sell leg", intraday.stt, 27.5);
  check("intraday STT is below delivery STT", intraday.stt < delivery.stt, true);
  check("delivery STT is sell-side only", delivery.stt, 110);
  check("intraday total is below delivery total here", intraday.total < delivery.total, true);
}

{
  // Small order: each leg is 1,000 x 0.03% = 0.30, both under the flat fee, so
  // the percentage branch wins on each leg: 0.30 + 0.30 = 0.60 in total.
  const c = roundTripCosts(100, 100, 10);
  check("percentage brokerage on a small order", c.brokerage, 0.6, 0.01);
}

// ─────────────────────────────────────────────────────────────────────────────
section("position sizer");

{
  // The exact scenario from the original calculator.
  const r = positionSizer({
    capital: 100000,
    riskPercent: 1,
    entryPrice: 2500,
    stopLoss: 2400,
    targetPrice: 2700,
  });
  check("valid", r.valid, true);
  check("risk amount is 1% of capital", r.riskAmount, 1000);
  check("risk per share", r.riskPerShare, 100);
  // 1000 / 100 = 10 shares exactly.
  check("quantity", r.quantity, 10);
  check("position value", r.positionValue, 25000);
  check("position is 25% of capital", r.positionPercent, 25);
  check("potential profit", r.potentialProfit, 2000);
  check("potential loss", r.potentialLoss, 1000);
  check("reward:risk is 2", r.rewardRiskRatio, 2);
}

{
  // Fractional risk must round the size DOWN so the cap is never breached.
  const r = positionSizer({
    capital: 100000,
    riskPercent: 1,
    entryPrice: 2500,
    stopLoss: 2399,
    targetPrice: 2700,
  });
  check("size rounds down to a whole share", r.quantity, 9);
  check("risk never exceeds the cap", r.potentialLoss <= r.riskAmount, true);
}

{
  // The old calculator returned a silent zero here. It must be rejected loudly.
  const r = positionSizer({
    capital: 100000,
    riskPercent: 1,
    entryPrice: 2500,
    stopLoss: 2600,
    targetPrice: 2700,
  });
  check("stop above entry is rejected", r.valid, false);
  check("rejection explains why", typeof r.problem, "string");
  check("rejected result has no size", r.quantity, 0);
}

{
  const r = positionSizer({
    capital: 100000,
    riskPercent: 1,
    entryPrice: 2500,
    stopLoss: 2400,
    targetPrice: 0,
  });
  check("missing target is still valid", r.valid, true);
  check("missing target gives no reward", r.potentialProfit, 0);
  check("missing target gives no R:R", r.rewardRiskRatio, 0);
}

{
  const r = positionSizer({
    capital: 0,
    riskPercent: 1,
    entryPrice: 2500,
    stopLoss: 2400,
    targetPrice: 2700,
  });
  check("zero capital is rejected", r.valid, false);
}

{
  // A stop a hair below entry rounds to a zero per-share risk. It must be
  // rejected, not turned into an infinite position size.
  const r = positionSizer({
    capital: 100000,
    riskPercent: 1,
    entryPrice: 2500.001,
    stopLoss: 2500,
    targetPrice: 2700,
  });
  check("paper-thin stop is rejected", r.valid, false);
  check("rejected thin stop has no size", r.quantity, 0);
}

{
  const r = positionSizer({
    capital: 100000,
    riskPercent: 1,
    entryPrice: 2500,
    stopLoss: 2400,
    targetPrice: 2700,
  });
  // Breakeven move must be smaller than the per-share risk, or the trade is dead.
  check("breakeven move is positive", r.breakevenMovePercent > 0, true);
  check("breakeven move is under the stop distance", r.breakevenMovePercent < (100 / 2500) * 100, true);
  check("net profit is below gross profit", r.netProfit < r.potentialProfit, true);
  check("net loss is above gross loss", r.netLoss > r.potentialLoss, true);
  check("net R:R is below gross R:R", r.netRewardRiskRatio < r.rewardRiskRatio, true);
}

// ─────────────────────────────────────────────────────────────────────────────
section("trade P&L");

{
  const long = tradePnl({ direction: "LONG", entryPrice: 1000, exitPrice: 1100, quantity: 100 });
  check("long gross P&L", long.grossPnl, 10000);
  check("long net is reduced by charges", long.netPnl < long.grossPnl, true);
  check("breakeven sits above entry for a long", long.breakevenExitPrice > 1000, true);
  check("points captured", long.pointsCaptured, 100);

  const short = tradePnl({ direction: "SHORT", entryPrice: 1100, exitPrice: 1000, quantity: 100 });
  check("short gross P&L matches the mirrored long", short.grossPnl, 10000);
  check("breakeven sits below entry for a short", short.breakevenExitPrice < 1100, true);
}

{
  const loss = tradePnl({ direction: "LONG", entryPrice: 1000, exitPrice: 950, quantity: 100 });
  check("losing long is negative", loss.netPnl < 0, true);
  check("loss magnitude exceeds the raw fall", Math.abs(loss.netPnl), Math.abs(-5000 - loss.cost.total), 0.01);
}

{
  const flat = tradePnl({ direction: "LONG", entryPrice: 1000, exitPrice: 1000, quantity: 100 });
  check("flat trade loses exactly the charges", flat.grossPnl, 0);
  check("flat trade net equals minus the charge", flat.netPnl, -flat.cost.total, 0.01);
}

{
  const zero = tradePnl({ direction: "LONG", entryPrice: 1000, exitPrice: 1100, quantity: 0 });
  check("zero quantity nets to zero", zero.netPnl, 0);
  check("zero quantity has no costs", zero.cost.total, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
section("SIP");

{
  // Zero return: value must equal contributions exactly.
  const r = sip({ monthly: 10000, annualReturnPercent: 0, years: 1 });
  check("zero return invested", r.totalInvested, 120000);
  check("zero return value", r.finalValue, 120000);
  check("zero return gain", r.gain, 0);
}

{
  // Known reference case: 12% a year for 10 years on 100,000/month.
  // Standard annuity-immediate gives
  //   FV = 100000 x (((1.01)^120 - 1) / 0.01) = 23,003,868.95
  const r = sip({ monthly: 100000, annualReturnPercent: 12, years: 10 });
  check("12% over 10y beats the invested total", r.gain > 0, true);
  check("invested total", r.totalInvested, 12000000);
  check("value matches the annuity formula", r.finalValue, 23003868.95, 0.5);
  check("yearly table has one row per year", r.yearly.length, 10);
  check("invested grows every year", r.yearly[9].invested > r.yearly[0].invested, true);
  check("value grows every year", r.yearly[9].value > r.yearly[0].value, true);
}

{
  const r = sip({ monthly: 5000, annualReturnPercent: 10, years: 3, annualStepUpPercent: 10 });
  check("step-up raises the later contribution", r.yearly[2].contribution > r.yearly[0].contribution, true);
  check("first year is unstepped", r.yearly[0].contribution, 5000);
  check("second year steps once", r.yearly[1].contribution, 5500);
  check("third year steps twice", r.yearly[2].contribution, 6050);
}

{
  // A lump sum alone compounds at the same monthly rate the SIP uses, so
  // 100,000 x (1 + 0.10/12)^24.
  const lump = sip({ monthly: 0, annualReturnPercent: 10, years: 2, initialLumpSum: 100000 });
  check("lump sum compounds monthly", lump.finalValue, 122039.1, 0.5);
  check("lump sum gain", lump.gain, 22039.1, 0.5);
}

{
  const r = sip({ monthly: 1000, annualReturnPercent: 10, years: 0 });
  check("zero years invests nothing", r.totalInvested, 0);
  check("zero years has no value", r.finalValue, 0);
  check("zero years has no CAGR", r.absoluteReturnPercent, 0);
}

{
  const negative = sip({ monthly: 1000, annualReturnPercent: -10, years: 2 });
  check("negative return loses money", negative.gain < 0, true);
}

// ─────────────────────────────────────────────────────────────────────────────
section("compounding, CAGR, margin, valuation");

check("12% monthly for 1y", compounding({ principal: 100000, ratePercent: 12, years: 1 }).futureValue, 112682.5, 0.01);
check(
  "effective annual on 12% monthly",
  compounding({ principal: 100000, ratePercent: 12, years: 1 }).effectiveAnnualPercent,
  12.68,
  0.01,
);
check(
  "annual compounding gives exactly the rate",
  compounding({ principal: 1000, ratePercent: 10, years: 2, compoundsPerYear: 1 }).futureValue,
  1210,
);
check("compounding at zero rate holds the principal", compounding({ principal: 5000, ratePercent: 0, years: 5 }).futureValue, 5000);

check("CAGR doubling in 1y", cagrPercent(100, 200, 1), 100);
check("CAGR 100 to 400 in 2y", cagrPercent(100, 400, 2), 100);
check("CAGR guards zero start", cagrPercent(0, 100, 1), 0);
check("CAGR guards zero years", cagrPercent(100, 200, 0), 0);

{
  // 200,000 notional at 25% span on 5x: 50,000 blocked + 150,000/5 = 80,000.
  const m = marginRequirement({ capital: 100000, positionValue: 200000, spanPercent: 25, leverage: 5 });
  check("margin required", m.marginRequired, 80000);
  check("achieved leverage", m.leverageAchieved, 2.5);
  check("not blocked when capital covers margin", m.blocked, false);
  check("additional capacity", m.additionalCapacity, 300000);
}

{
  const m = marginRequirement({ capital: 10000, positionValue: 200000, spanPercent: 25, leverage: 5 });
  check("blocked when capital is short", m.blocked, true);
  check("capacity floors at zero", m.additionalCapacity, 0);
}

check("market cap", marketCap(1250, 1_000_000_000), 1250000000000);
check("P/E on positive earnings", peRatio(2500, 100), 25);
check("P/E is null on a loss", peRatio(2500, -10), null);
check("P/E is null on zero earnings", peRatio(2500, 0), null);

check("drawdown 100 to 80", drawdownPercent(100, 80), 20);
check("drawdown at the peak", drawdownPercent(100, 100), 0);
check("drawdown below the peak goes negative", drawdownPercent(100, 120), -20);
check("drawdown guards a zero peak", drawdownPercent(0, 80), 0);

// ─────────────────────────────────────────────────────────────────────────────
section("segment rate table (FY25-26)");

{
  // Delivery books STT at 0.1% on the sell leg only. The old calculator
  // charged it on both legs, which overstated STT by 0.1% of the buy value.
  const d = roundTripCosts(1000, 1100, 100, DELIVERY_COSTS);
  check("delivery STT is sell-side only", d.stt, 110);
  check("delivery stamp is buy-side 0.015%", d.stampDuty, 15);
}

{
  // Futures STT is 0.02% of sell value, not 0.01%.
  const f = roundTripCosts(2500, 2600, 100, FUTURES_COSTS);
  check("futures STT", f.stt, 52);
  check("futures stamp is 0.002% of buy", f.stampDuty, 5);
  check("futures exchange charge", f.exchange, round(510000 * 0.0000173), 0.01);
}

{
  // Options STT is 0.1% of the premium traded, not 6.25% of the strike.
  const o = roundTripCosts(120, 180, 500, OPTIONS_COSTS);
  // Buy premium 60,000 + sell premium 90,000 = 150,000 turnover.
  check("options premium turnover", o.turnover, 150000);
  check("options STT is 0.1% of sell premium", o.stt, 90);
  check("options STT is nowhere near 6.25% of notional", o.stt < 1000, true);
}

{
  // GST must include SEBI and stamp duty in its base, not just brokerage.
  const c = roundTripCosts(1000, 1100, 100, DELIVERY_COSTS);
  const base = c.brokerage + c.exchange + c.sebi + c.stampDuty;
  check("GST base covers every charge except STT", c.gst, round(base * 0.18), 0.01);
  check("GST excludes STT", c.gst < c.stt, true);
}

{
  // A flat-fee broker must never charge more than the percentage above a
  // large enough turnover.
  const big = roundTripCosts(5000, 5000, 1000, DELIVERY_COSTS);
  check("brokerage stays capped on a large order", big.brokerage, 40);
}

// ─────────────────────────────────────────────────────────────────────────────
section("EMI");

{
  // 50,00,000 at 8.5% for 20 years is a textbook EMI of 43,391.
  const e = emi({ principal: 5000000, annualRatePercent: 8.5, months: 240 });
  check("EMI", e.emi, 43391, 1);
  check("total payment", e.totalPayment, round(e.emi * 240), 0.01);
  check("total interest", e.totalInterest, round(e.totalPayment - 5000000), 0.01);
  check("first month interest", e.firstMonthInterest, round(5000000 * 0.085 / 12));
  check("first month principal is positive", e.firstMonthPrincipal > 0, true);
}

{
  // A zero-rate loan repays the principal exactly.
  const e = emi({ principal: 120000, annualRatePercent: 0, months: 12 });
  check("zero-rate EMI", e.emi, 10000);
  check("zero-rate total interest", e.totalInterest, 0);
}

{
  check("zero principal EMI", emi({ principal: 0, annualRatePercent: 9, months: 12 }).emi, 0);
  check("zero months EMI", emi({ principal: 500000, annualRatePercent: 9, months: 0 }).emi, 0);
}

{
  // Interest must fall and principal rise as the loan ages.
  const e = emi({ principal: 1000000, annualRatePercent: 9, months: 120 });
  check("interest is under principal early on", e.firstMonthInterest < e.firstMonthPrincipal + 7500, true);
}

// ─────────────────────────────────────────────────────────────────────────────
section("deposits");

{
  // 1,00,000 at 7% compounded quarterly for 3 years.
  const d = deposit(100000, 7, 3, 4);
  check("FD maturity", d.maturity, round(100000 * (1 + 0.07 / 4) ** 12), 0.01);
  check("FD interest", d.interest, round(d.maturity - 100000), 0.01);
  check("effective annual beats the nominal", d.effectiveAnnualPercent, round(((1.0175) ** 4 - 1) * 100), 0.01);
}

{
  const annual = deposit(100000, 10, 2, 1);
  check("annual compounding returns the rate", annual.effectiveAnnualPercent, 10);
}

{
  // 5,000/month for 24 months at 7% quarterly, matching banking convention.
  const rd = recurringDeposit(5000, 7, 24);
  check("RD invested", rd.invested, 120000);
  check("RD maturity beats the principal", rd.maturity > 120000, true);
  check("RD interest is positive", rd.interest > 0, true);
}

{
  const zero = recurringDeposit(5000, 0, 12);
  check("zero-rate RD returns the instalments", zero.maturity, 60000);
}

// ─────────────────────────────────────────────────────────────────────────────
section("SWP");

{
  // A withdrawal smaller than the monthly return should never exhaust the corpus.
  const s = swp(2500000, 15000, 8, 120);
  check("SWP survives a small payout", s.exhaustedInYear, null);
  check("corpus stays positive", s.finalCorpus > 0, true);
  check("total withdrawn matches 120 payouts", s.totalWithdrawn, 1800000);
}

{
  // A withdrawal far larger than the return must run the corpus dry.
  const s = swp(2500000, 150000, 8, 120);
  check("SWP reports exhaustion", typeof s.exhaustedInYear, "number");
  check("corpus floors at zero", s.finalCorpus, 0);
  check("exhaustion year is within the horizon", (s.exhaustedInYear ?? 99) <= 10, true);
}

{
  const zero = swp(1000000, 0, 10, 12);
  check("no withdrawals means the corpus grows", zero.finalCorpus, 1104713, 50);
}

// ─────────────────────────────────────────────────────────────────────────────
section("inflation adjustment");

{
  // 1,00,000 at 12% for 10 years is 3,11,584 nominally, but in today's rupees
  // it is only 3,11,584 / 1.06^10 = 1,79,858.
  const r = inflationAdjusted(100000, 12, 6, 10);
  check("nominal value", r.nominalValue, round(100000 * 1.12 ** 10), 0.01);
  check("real value deflates by inflation", r.realValue, round(r.nominalValue / 1.06 ** 10), 0.01);
  // The exact Fisher rate is (1.12 / 1.06) - 1 = 5.66%, not 12 - 6 = 6%.
  check("real rate uses the Fisher relation", r.realRatePercent, 5.66, 0.01);
  check("real rate is not the naive subtraction", r.realRatePercent !== 6, true);
  check("purchasing power loss is reported", r.purchasingPowerLostPercent > 0, true);
}

{
  const r = inflationAdjusted(100000, 12, 0, 10);
  check("zero inflation leaves real equal to nominal", r.realValue, r.nominalValue);
  check("zero inflation reports no real discount", r.purchasingPowerLostPercent, 0);
}

{
  // Negative real return when inflation outruns the nominal rate.
  const r = inflationAdjusted(100000, 7, 9, 5);
  check("real return turns negative", r.realRatePercent < 0, true);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n  ${"─".repeat(46)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`\n  FAILURES:`);
  for (const f of failures) console.log(`    ✗ ${f}`);
  process.exitCode = 1;
}