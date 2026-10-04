"use client";

import * as React from "react";

import { Card, Field, Segmented, Disclaimer, Badge } from "@/components/ui";
import { PageHeader } from "@/components/shell/UserMenu";
import {
  DASH,
  SEGMENTS,
  compounding,
  cagrPercent,
  deposit,
  drawdownPercent,
  emi,
  inflationAdjusted,
  marginRequirement,
  marketCap,
  peRatio,
  positionSizer,
  recurringDeposit,
  round,
  sip,
  swp,
  tradePnl,
  type CostRates,
  type Direction,
  type Segment,
} from "@/lib/calculator";

/* ─────────────────────────────────────────────────────────────────────────
   Presentation helpers
   ───────────────────────────────────────────────────────────────────────── */

const RS = "₹";

function money(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  return `${sign}${RS}${Math.abs(value).toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** Compact Indian notation: lakh and crore. */
function moneyShort(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${sign}${RS}${compact(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}${RS}${compact(abs / 1e5)} L`;
  return `${sign}${RS}${Math.round(abs).toLocaleString("en-IN")}`;
}

/** Up to two decimals, grouped in the Indian system (1,25,000 not 125000). */
function compact(value: number): string {
  return round(value, 2).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function percent(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return `${round(value, digits).toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function signedMoney(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return money(0, digits);
  return `${value > 0 ? "+" : ""}${money(value, digits)}`;
}

function toneOf(value: number): "bull" | "bear" | "muted" {
  if (value > 0) return "bull";
  if (value < 0) return "bear";
  return "muted";
}

/* ─────────────────────────────────────────────────────────────────────────
   Input and output primitives
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Numeric input that never emits a non-finite value. Clearing the box yields an
 * empty string internally but reports 0 to the maths, so no field can ever push
 * NaN into a result card.
 */
function NumInput({
  id,
  label,
  hint,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  prefix,
  suffix,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
}) {
  const clamp = (raw: string) => {
    if (raw.trim() === "") return 0;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 0;
    let out = parsed;
    if (min !== undefined) out = Math.max(min, out);
    if (max !== undefined) out = Math.min(max, out);
    return out;
  };

  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="input-affix">
        {prefix ? <span className="affix affix-left">{prefix}</span> : null}
        <input
          id={id}
          type="number"
          className="input"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(clamp(e.target.value))}
          style={{
            paddingLeft: prefix ? 26 : undefined,
            paddingRight: suffix ? 44 : undefined,
          }}
        />
        {suffix ? <span className="affix affix-right">{suffix}</span> : null}
      </div>
    </Field>
  );
}

function ResultRow({
  label,
  value,
  accent,
  tone,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
  tone?: "bull" | "bear" | "muted";
  hint?: string;
}) {
  return (
    <div className="calc-row">
      <span className="calc-row-label">
        {label}
        {hint ? <span className="calc-row-hint">{hint}</span> : null}
      </span>
      <span
        className={[
          "calc-row-value",
          accent ? "is-accent" : "",
          tone === "bull" ? "bull" : tone === "bear" ? "bear" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="calc-divider" />;
}

/** Horizontal split of invested versus gains. */
function SplitBar({ invested, gained, gainLabel = "Gains" }: { invested: number; gained: number; gainLabel?: string }) {
  const total = Math.abs(invested) + Math.abs(gained);
  const investedPct = total > 0 ? (Math.abs(invested) / total) * 100 : 100;
  const gainedPct = total > 0 ? (Math.abs(gained) / total) * 100 : 0;
  const negative = gained < 0;

  return (
    <div className="calc-split">
      <div className="calc-split-labels">
        <span>Invested {moneyShort(invested)}</span>
        <span className={negative ? "bear" : "bull"}>
          {negative ? "Loss" : gainLabel} {moneyShort(Math.abs(gained))}
        </span>
      </div>
      <div className="calc-split-track">
        <div className="calc-split-fill is-invested" style={{ width: `${investedPct}%` }} />
        <div
          className={`calc-split-fill ${negative ? "is-loss" : "is-gain"}`}
          style={{ width: `${gainedPct}%` }}
        />
      </div>
    </div>
  );
}

function Notice({ tone, children }: { tone: "info" | "warn" | "good"; children: React.ReactNode }) {
  return <div className={`calc-notice is-${tone}`}>{children}</div>;
}

/* ─────────────────────────────────────────────────────────────────────────
   Position sizer
   ───────────────────────────────────────────────────────────────────────── */

function PositionSizerTool() {
  const [capital, setCapital] = React.useState(100000);
  const [riskPercent, setRiskPercent] = React.useState(1);
  const [entry, setEntry] = React.useState(2500);
  const [stop, setStop] = React.useState(2400);
  const [target, setTarget] = React.useState(2700);
  const [segment, setSegment] = React.useState<Segment>("delivery");

  const rates: CostRates = SEGMENTS[segment].rates;
  const r = positionSizer({
    capital,
    riskPercent,
    entryPrice: entry,
    stopLoss: stop,
    targetPrice: target,
    costRates: rates,
  });

  const rrQuality =
    r.rewardRiskRatio >= 2 ? "Strong" : r.rewardRiskRatio >= 1 ? "Marginal" : "Unfavourable";
  const rrTone = r.rewardRiskRatio >= 2 ? "bull" : r.rewardRiskRatio >= 1 ? "warn" : "bear";

  return (
    <div className="grid grid-2 calc-layout">
      <div className="stack">
        <Segmented
          ariaLabel="Segment for charges"
          value={segment}
          onChange={setSegment}
          options={(Object.keys(SEGMENTS) as Segment[]).map((key) => ({
            value: key,
            label: SEGMENTS[key].short,
          }))}
        />
        <NumInput id="ps-capital" label="Trading capital" prefix={RS} value={capital} onChange={setCapital} min={0} step={10000} />
        <NumInput id="ps-risk" label="Risk per trade" suffix="%" hint="Professional traders risk 0.5–1%." value={riskPercent} onChange={setRiskPercent} min={0.01} max={100} step={0.1} />
        <NumInput id="ps-entry" label="Entry price" prefix={RS} value={entry} onChange={setEntry} min={0.01} step={0.05} />
        <NumInput id="ps-stop" label="Stop loss" prefix={RS} value={stop} onChange={setStop} min={0.01} step={0.05} />
        <NumInput id="ps-target" label="Target price" prefix={RS} value={target} onChange={setTarget} min={0} step={0.05} />
      </div>

      <div>
        {!r.valid ? (
          <Notice tone="warn">{r.problem}</Notice>
        ) : (
          <>
            <div className="calc-hero">
              <div className="calc-hero-label">Position size</div>
              <div className="calc-hero-value">
                {r.quantity.toLocaleString("en-IN")} <span>units</span>
              </div>
              <div className="calc-hero-sub">
                {money(r.positionValue, 0)} deployed · {percent(r.positionPercent)} of capital
              </div>
            </div>

            <div className="calc-rows">
              <ResultRow label="Risk amount" value={money(r.riskAmount)} hint={`${percent(riskPercent, 1)} of capital`} />
              <ResultRow label="Risk per unit" value={money(r.riskPerShare)} />
              <ResultRow label="Reward per unit" value={money(r.rewardPerShare)} />
              <Divider />
              <ResultRow label="Gross profit at target" value={signedMoney(r.potentialProfit)} tone={toneOf(r.potentialProfit)} />
              <ResultRow label="Gross loss at stop" value={signedMoney(-r.potentialLoss)} tone="bear" />
              <ResultRow
                label="Reward : risk"
                value={`1 : ${round(r.rewardRiskRatio, 2)}`}
                hint={rrQuality}
                tone={rrTone === "bull" ? "bull" : rrTone === "warn" ? undefined : "bear"}
                accent
              />
              <Divider />
              <ResultRow label="Round-trip charges" value={money(r.cost.total)} hint={SEGMENTS[segment].label} />
              <ResultRow label="Net profit at target" value={signedMoney(r.netProfit)} tone={toneOf(r.netProfit)} />
              <ResultRow label="Net loss at stop" value={signedMoney(-r.netLoss)} tone="bear" />
              <ResultRow
                label="Net reward : risk"
                value={`1 : ${round(r.netRewardRiskRatio, 2)}`}
                tone={r.netRewardRiskRatio >= 2 ? "bull" : r.netRewardRiskRatio >= 1 ? undefined : "bear"}
              />
              <Divider />
              <ResultRow
                label="Breakeven move"
                value={percent(r.breakevenMovePercent, 3)}
                hint="to cover charges alone"
              />
              <ResultRow label="Capital at risk" value={money(r.capitalAtRisk)} tone="bear" />
            </div>
          </>
        )}

        {r.valid &&
        (segment === "delivery" || segment === "options") &&
        r.positionValue > capital ? (
          <Notice tone="warn">
            This position costs {money(r.positionValue, 0)} but your capital is only{" "}
            {money(capital, 0)}. A {SEGMENTS[segment].label.toLowerCase()} position cannot be funded
            at this size — lower the risk per trade or widen the stop so fewer units are sized.
          </Notice>
        ) : null}
        {r.valid && riskPercent > 2 ? (
          <Notice tone="warn">
            Risking more than 2% per trade. A run of five losses would cost{" "}
            {money(capital * (1 - Math.pow(1 - riskPercent / 100, 5)), 0)} of capital.
          </Notice>
        ) : null}
        {r.valid && r.netRewardRiskRatio < 1 && r.rewardRiskRatio > 0 ? (
          <Notice tone="warn">
            Charges cut the reward:risk below 1:1. Widen the target or use a tighter stop.
          </Notice>
        ) : null}
        {r.valid && r.netRewardRiskRatio >= 2 ? (
          <Notice tone="good">
            After charges this trade still risks 1 to win {round(r.netRewardRiskRatio, 2)}.
          </Notice>
        ) : null}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Trade P&L and charges
   ───────────────────────────────────────────────────────────────────────── */

function TradeTool() {
  const [direction, setDirection] = React.useState<Direction>("LONG");
  const [segment, setSegment] = React.useState<Segment>("delivery");
  const [entry, setEntry] = React.useState(1000);
  const [exit, setExit] = React.useState(1100);
  const [qty, setQty] = React.useState(100);

  const rates = SEGMENTS[segment].rates;
  const r = tradePnl({ direction, entryPrice: entry, exitPrice: exit, quantity: qty, costRates: rates });
  const chargesOnRate = qty > 0 && entry > 0 ? round((r.cost.total / (qty * entry)) * 100, 3) : 0;

  return (
    <div className="grid grid-2 calc-layout">
      <div className="stack">
        <Segmented
          ariaLabel="Direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "LONG", label: "Long" },
            { value: "SHORT", label: "Short" },
          ]}
        />
        <Segmented
          ariaLabel="Segment"
          value={segment}
          onChange={setSegment}
          options={(Object.keys(SEGMENTS) as Segment[]).map((key) => ({
            value: key,
            label: SEGMENTS[key].short,
          }))}
        />
        <NumInput id="tp-entry" label="Entry price" prefix={RS} value={entry} onChange={setEntry} min={0.01} step={0.05} />
        <NumInput id="tp-exit" label="Exit price" prefix={RS} value={exit} onChange={setExit} min={0.01} step={0.05} />
        <NumInput id="tp-qty" label="Quantity / lots" value={qty} onChange={setQty} min={0} step={1} />
      </div>

      <div>
        <div className={`calc-hero is-${toneOf(r.netPnl)}`}>
          <div className="calc-hero-label">Net P&amp;L</div>
          <div className="calc-hero-value">{signedMoney(r.netPnl)}</div>
          <div className="calc-hero-sub">
            {percent(r.netReturnPercent)} on {money(entry * qty, 0)} deployed
          </div>
        </div>

        <div className="calc-rows">
          <ResultRow label="Gross P&L" value={signedMoney(r.grossPnl)} tone={toneOf(r.grossPnl)} />
          <ResultRow label="Gross return" value={percent(r.grossReturnPercent)} tone={toneOf(r.grossReturnPercent)} />
          <ResultRow label="Points captured" value={round(r.pointsCaptured, 3)} />
          <Divider />
          <ResultRow label="Buy / entry value" value={money(r.cost.buyValue, 0)} />
          <ResultRow label="Sell / exit value" value={money(r.cost.sellValue, 0)} />
          <ResultRow label="Brokerage" value={money(r.cost.brokerage)} />
          <ResultRow label="STT" value={money(r.cost.stt)} hint={`${SEGMENTS[segment].rates.sttSellPct}% sell side`} />
          <ResultRow label="Exchange charges" value={money(r.cost.exchange)} />
          <ResultRow label="SEBI fee" value={money(r.cost.sebi, 4)} />
          <ResultRow label="Stamp duty" value={money(r.cost.stampDuty)} hint="buy side" />
          <ResultRow label="GST (18%)" value={money(r.cost.gst)} />
          <ResultRow label="Total charges" value={money(r.cost.total)} accent />
          <Divider />
          <ResultRow label="Total charges as % of position" value={percent(chargesOnRate, 3)} />
          <ResultRow
            label="Breakeven exit price"
            value={money(r.breakevenExitPrice)}
            hint="net P&L is zero here"
          />
        </div>

        {r.grossPnl > 0 && r.netPnl <= 0 ? (
          <Notice tone="warn">
            This trade looks profitable before charges but loses money after them.
          </Notice>
        ) : null}
        {chargesOnRate > 0.5 ? (
          <Notice tone="info">
            Charges consume {percent(chargesOnRate, 2)} of the position. That is the return the
            trade must clear before it starts working for you.
          </Notice>
        ) : null}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   SIP
   ───────────────────────────────────────────────────────────────────────── */

function SipTool() {
  const [monthly, setMonthly] = React.useState(10000);
  const [rate, setRate] = React.useState(12);
  const [years, setYears] = React.useState(10);
  const [stepUp, setStepUp] = React.useState(0);
  const [lump, setLump] = React.useState(0);

  const r = sip({
    monthly,
    annualReturnPercent: rate,
    years,
    initialLumpSum: lump,
    annualStepUpPercent: stepUp,
  });

  const doubled = r.yearly.find((y) => y.value >= y.invested * 2);

  return (
    <div className="grid grid-2 calc-layout">
      <div className="stack">
        <NumInput id="sip-m" label="Monthly investment" prefix={RS} value={monthly} onChange={setMonthly} min={0} step={500} />
        <NumInput id="sip-r" label="Expected return" suffix="% p.a." value={rate} onChange={setRate} step={0.5} />
        <NumInput id="sip-y" label="Period" suffix="years" value={years} onChange={setYears} min={0} max={50} step={1} />
        <NumInput id="sip-step" label="Annual step-up" suffix="%" hint="Raises the contribution every year." value={stepUp} onChange={setStepUp} min={-50} max={100} step={1} />
        <NumInput id="sip-lump" label="Opening lump sum" prefix={RS} hint="Optional, invested on day one." value={lump} onChange={setLump} min={0} step={10000} />
      </div>

      <div>
        <div className="calc-hero">
          <div className="calc-hero-label">Projected value</div>
          <div className="calc-hero-value">{money(r.finalValue, 0)}</div>
          <div className="calc-hero-sub">
            {money(r.gain, 0)} gain on {money(r.totalInvested, 0)} invested
          </div>
        </div>

        <div className="calc-rows">
          <ResultRow label="Total invested" value={money(r.totalInvested, 0)} />
          <ResultRow label="Est. returns" value={money(r.gain, 0)} tone="bull" />
          <ResultRow label="Return on investment" value={percent(r.gainPercent)} tone="bull" />
          <ResultRow label="Annualised return" value={percent(r.absoluteReturnPercent)} hint="CAGR on capital deployed" />
          <ResultRow label="Final monthly contribution" value={money(r.yearly.at(-1)?.contribution ?? monthly, 0)} />
          {doubled ? <ResultRow label="Money doubles by" value={`Year ${doubled.year}`} tone="bull" /> : null}
        </div>

        <SplitBar invested={r.totalInvested} gained={r.gain} />

        {r.yearly.length > 0 ? (
          <div className="table-wrap calc-table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Monthly</th>
                  <th>Invested</th>
                  <th>Value</th>
                  <th>Returns</th>
                </tr>
              </thead>
              <tbody>
                {r.yearly.map((row) => (
                  <tr key={row.year}>
                    <td>{row.year}</td>
                    <td>{money(row.contribution, 0)}</td>
                    <td>{money(row.invested, 0)}</td>
                    <td>{money(row.value, 0)}</td>
                    <td className="bull">{money(row.returns, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Lumpsum and CAGR
   ───────────────────────────────────────────────────────────────────────── */

function LumpsumTool() {
  const [amount, setAmount] = React.useState(500000);
  const [rate, setRate] = React.useState(12);
  const [years, setYears] = React.useState(10);
  const [frequency, setFrequency] = React.useState(12);

  const c = compounding({ principal: amount, ratePercent: rate, years, compoundsPerYear: frequency });
  const invested = Math.max(0, amount);
  const gain = round(c.futureValue - invested);

  return (
    <div className="grid grid-2 calc-layout">
      <div className="stack">
        <NumInput id="ls-a" label="Investment amount" prefix={RS} value={amount} onChange={setAmount} min={0} step={10000} />
        <NumInput id="ls-r" label="Expected return" suffix="% p.a." value={rate} onChange={setRate} step={0.5} />
        <NumInput id="ls-y" label="Period" suffix="years" value={years} onChange={setYears} min={0} max={50} step={1} />
        <Field label="Compounding" htmlFor="ls-f">
          <select
            id="ls-f"
            className="select"
            value={frequency}
            onChange={(e) => setFrequency(Number(e.target.value))}
          >
            <option value={1}>Annually</option>
            <option value={2}>Half-yearly</option>
            <option value={4}>Quarterly</option>
            <option value={12}>Monthly</option>
            <option value={365}>Daily</option>
          </select>
        </Field>
      </div>

      <div>
        <div className="calc-hero">
          <div className="calc-hero-label">Maturity value</div>
          <div className="calc-hero-value">{money(c.futureValue, 0)}</div>
          <div className="calc-hero-sub">{money(gain, 0)} gain on {money(invested, 0)}</div>
        </div>
        <div className="calc-rows">
          <ResultRow label="Invested" value={money(invested, 0)} />
          <ResultRow label="Interest earned" value={money(gain, 0)} tone="bull" />
          <ResultRow
            label="Total return"
            value={percent(invested > 0 ? (gain / invested) * 100 : 0)}
            tone="bull"
          />
          <ResultRow label="Effective annual return" value={percent(c.effectiveAnnualPercent)} hint="after compounding" />
          <ResultRow label="Absolute annualised" value={percent(cagrPercent(invested, c.futureValue, years))} hint="CAGR" />
        </div>
        <SplitBar invested={invested} gained={gain} gainLabel="Interest" />
      </div>
    </div>
  );
}

function CagrTool() {
  const [from, setFrom] = React.useState(100000);
  const [to, setTo] = React.useState(250000);
  const [years, setYears] = React.useState(5);

  const annualised = cagrPercent(from, to, years);
  const total = from > 0 ? round(((to - from) / from) * 100) : 0;

  return (
    <div className="grid grid-2 calc-layout">
      <div className="stack">
        <NumInput id="cg-a" label="Starting value" prefix={RS} value={from} onChange={setFrom} min={0} step={10000} />
        <NumInput id="cg-b" label="Ending value" prefix={RS} value={to} onChange={setTo} min={0} step={10000} />
        <NumInput id="cg-y" label="Years elapsed" suffix="years" value={years} onChange={setYears} min={1} max={60} step={1} />
      </div>
      <div>
        <div className={`calc-hero is-${toneOf(annualised)}`}>
          <div className="calc-hero-label">CAGR</div>
          <div className="calc-hero-value">{percent(annualised)}</div>
          <div className="calc-hero-sub">per year, compounded</div>
        </div>
        <div className="calc-rows">
          <ResultRow label="Absolute gain" value={signedMoney(to - from, 0)} tone={toneOf(to - from)} />
          <ResultRow label="Total return" value={percent(total)} tone={toneOf(total)} />
          <ResultRow label="Growth multiple" value={`${round(from > 0 ? to / from : 0, 2)}x`} />
          <ResultRow
            label="Rule of 72 estimate"
            value={annualised > 0 ? `${round(72 / annualised, 1)} yrs` : DASH}
            hint="years to double"
          />
        </div>
        <div className="calc-formula">
          CAGR = ( {money(to, 0)} / {money(from, 0)} ) ^ (1 / {years}) &minus; 1
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Loans, deposits, withdrawals, inflation
   ───────────────────────────────────────────────────────────────────────── */

function EmiTool() {
  const [principal, setPrincipal] = React.useState(5000000);
  const [rate, setRate] = React.useState(8.5);
  const [years, setYears] = React.useState(20);

  const r = emi({ principal, annualRatePercent: rate, months: Math.round(years * 12) });

  return (
    <div className="grid grid-2 calc-layout">
      <div className="stack">
        <NumInput id="emi-p" label="Loan amount" prefix={RS} value={principal} onChange={setPrincipal} min={0} step={100000} />
        <NumInput id="emi-r" label="Interest rate" suffix="% p.a." value={rate} onChange={setRate} min={0} max={30} step={0.05} />
        <NumInput id="emi-y" label="Tenure" suffix="years" value={years} onChange={setYears} min={0} max={30} step={1} />
      </div>
      <div>
        <div className="calc-hero">
          <div className="calc-hero-label">Monthly EMI</div>
          <div className="calc-hero-value">{money(r.emi, 0)}</div>
          <div className="calc-hero-sub">{round(years * 12)} payments</div>
        </div>
        <div className="calc-rows">
          <ResultRow label="Principal" value={money(principal, 0)} />
          <ResultRow label="Total interest" value={money(r.totalInterest, 0)} tone="bear" />
          <ResultRow label="Total payable" value={money(r.totalPayment, 0)} accent />
          <Divider />
          <ResultRow label="First month interest" value={money(r.firstMonthInterest)} tone="bear" />
          <ResultRow label="First month principal" value={money(r.firstMonthPrincipal)} tone="bull" />
          <ResultRow
            label="Interest share of payment"
            value={percent(r.emi > 0 ? (r.firstMonthInterest / r.emi) * 100 : 0)}
          />
        </div>
        <SplitBar invested={principal} gained={r.totalInterest} gainLabel="Interest" />
      </div>
    </div>
  );
}

function DepositTool() {
  const [amount, setAmount] = React.useState(100000);
  const [rate, setRate] = React.useState(7);
  const [years, setYears] = React.useState(3);
  const [frequency, setFrequency] = React.useState(4);

  const r = deposit(amount, rate, years, frequency);

  return (
    <div className="grid grid-2 calc-layout">
      <div className="stack">
        <NumInput id="dp-a" label="Deposit amount" prefix={RS} value={amount} onChange={setAmount} min={0} step={10000} />
        <NumInput id="dp-r" label="Interest rate" suffix="% p.a." value={rate} onChange={setRate} min={0} max={20} step={0.05} />
        <NumInput id="dp-y" label="Tenure" suffix="years" value={years} onChange={setYears} min={0} max={30} step={1} />
        <Field label="Compounding" htmlFor="dp-f">
          <select id="dp-f" className="select" value={frequency} onChange={(e) => setFrequency(Number(e.target.value))}>
            <option value={1}>Annually</option>
            <option value={2}>Half-yearly</option>
            <option value={4}>Quarterly</option>
            <option value={12}>Monthly</option>
          </select>
        </Field>
      </div>
      <div>
        <div className="calc-hero">
          <div className="calc-hero-label">Maturity amount</div>
          <div className="calc-hero-value">{money(r.maturity, 0)}</div>
          <div className="calc-hero-sub">{money(r.interest, 0)} interest</div>
        </div>
        <div className="calc-rows">
          <ResultRow label="Principal" value={money(amount, 0)} />
          <ResultRow label="Interest earned" value={money(r.interest, 0)} tone="bull" />
          <ResultRow label="Effective annual return" value={percent(r.effectiveAnnualPercent)} hint="after compounding" />
        </div>
        <SplitBar invested={amount} gained={r.interest} gainLabel="Interest" />
      </div>
    </div>
  );
}

function RecurringDepositTool() {
  const [monthly, setMonthly] = React.useState(5000);
  const [rate, setRate] = React.useState(7);
  const [months, setMonths] = React.useState(24);

  const r = recurringDeposit(monthly, rate, months);

  return (
    <div className="grid grid-2 calc-layout">
      <div className="stack">
        <NumInput id="rd-m" label="Monthly deposit" prefix={RS} value={monthly} onChange={setMonthly} min={0} step={500} />
        <NumInput id="rd-r" label="Interest rate" suffix="% p.a." value={rate} onChange={setRate} min={0} max={20} step={0.05} />
        <NumInput id="rd-mo" label="Tenure" suffix="months" value={months} onChange={setMonths} min={0} max={120} step={1} />
      </div>
      <div>
        <div className="calc-hero">
          <div className="calc-hero-label">Maturity amount</div>
          <div className="calc-hero-value">{money(r.maturity, 0)}</div>
          <div className="calc-hero-sub">{money(r.interest, 0)} interest</div>
        </div>
        <div className="calc-rows">
          <ResultRow label="Total deposited" value={money(r.invested, 0)} />
          <ResultRow label="Interest earned" value={money(r.interest, 0)} tone="bull" />
          <ResultRow
            label="Return on deposit"
            value={percent(r.invested > 0 ? (r.interest / r.invested) * 100 : 0)}
          />
        </div>
        <SplitBar invested={r.invested} gained={r.interest} gainLabel="Interest" />
      </div>
    </div>
  );
}

function SwpTool() {
  const [corpus, setCorpus] = React.useState(2500000);
  const [withdrawal, setWithdrawal] = React.useState(15000);
  const [rate, setRate] = React.useState(8);
  const [years, setYears] = React.useState(10);

  const r = swp(corpus, withdrawal, rate, Math.round(years * 12));
  const netGain = round(r.totalWithdrawn + r.finalCorpus - corpus);

  return (
    <div className="grid grid-2 calc-layout">
      <div className="stack">
        <NumInput id="sw-c" label="Opening corpus" prefix={RS} value={corpus} onChange={setCorpus} min={0} step={100000} />
        <NumInput id="sw-w" label="Monthly withdrawal" prefix={RS} value={withdrawal} onChange={setWithdrawal} min={0} step={500} />
        <NumInput id="sw-r" label="Expected return" suffix="% p.a." value={rate} onChange={setRate} min={0} max={30} step={0.5} />
        <NumInput id="sw-y" label="Period" suffix="years" value={years} onChange={setYears} min={0} max={50} step={1} />
      </div>
      <div>
        <div className={`calc-hero is-${r.exhaustedInYear ? "bear" : "bull"}`}>
          <div className="calc-hero-label">Closing corpus</div>
          <div className="calc-hero-value">{money(r.finalCorpus, 0)}</div>
          <div className="calc-hero-sub">
            {r.exhaustedInYear
              ? `Exhausted during year ${r.exhaustedInYear}`
              : `Survives the full ${years} years`}
          </div>
        </div>
        <div className="calc-rows">
          <ResultRow label="Opening corpus" value={money(corpus, 0)} />
          <ResultRow label="Total withdrawn" value={money(r.totalWithdrawn, 0)} />
          <ResultRow label="Closing corpus" value={money(r.finalCorpus, 0)} accent />
          <ResultRow label="Net change" value={signedMoney(netGain, 0)} tone={toneOf(netGain)} />
        </div>
        {r.exhaustedInYear ? (
          <Notice tone="warn">
            The corpus runs out in year {r.exhaustedInYear}. Lower the withdrawal, or raise the
            assumed return, to make the plan sustainable.
          </Notice>
        ) : (
          <Notice tone="good">
            The withdrawal is covered by the return, so the corpus keeps compounding.
          </Notice>
        )}
      </div>
    </div>
  );
}

function InflationTool() {
  const [amount, setAmount] = React.useState(100000);
  const [rate, setRate] = React.useState(12);
  const [inflation, setInflation] = React.useState(6);
  const [years, setYears] = React.useState(10);

  const r = inflationAdjusted(amount, rate, inflation, years);

  return (
    <div className="grid grid-2 calc-layout">
      <div className="stack">
        <NumInput id="if-a" label="Today's value" prefix={RS} value={amount} onChange={setAmount} min={0} step={10000} />
        <NumInput id="if-r" label="Expected return" suffix="% p.a." value={rate} onChange={setRate} step={0.5} />
        <NumInput id="if-i" label="Inflation" suffix="% p.a." value={inflation} onChange={setInflation} min={0} max={30} step={0.5} />
        <NumInput id="if-y" label="Period" suffix="years" value={years} onChange={setYears} min={0} max={50} step={1} />
      </div>
      <div>
        <div className="calc-hero">
          <div className="calc-hero-label">Real value in today's money</div>
          <div className="calc-hero-value">{money(r.realValue, 0)}</div>
          <div className="calc-hero-sub">nominal {money(r.nominalValue, 0)}</div>
        </div>
        <div className="calc-rows">
          <ResultRow label="Nominal value" value={money(r.nominalValue, 0)} />
          <ResultRow label="Real value" value={money(r.realValue, 0)} accent tone="bull" />
          <ResultRow label="Real rate of return" value={percent(r.realRatePercent)} tone={toneOf(r.realRatePercent)} />
          <ResultRow label="Purchasing power lost" value={percent(r.purchasingPowerLostPercent)} tone="bear" />
        </div>
        <div className="calc-formula">
          Real rate = (1 + {percent(rate, 2)}) / (1 + {percent(inflation, 2)}) &minus; 1. The exact
          Fisher relation, not a plain subtraction.
        </div>
        {r.realRatePercent < 0 ? (
          <Notice tone="warn">
            Inflation is outrunning the return, so this investment loses purchasing power.
          </Notice>
        ) : null}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Margin and drawdown
   ───────────────────────────────────────────────────────────────────────── */

function MarginTool() {
  const [capital, setCapital] = React.useState(200000);
  const [value, setValue] = React.useState(500000);
  const [span, setSpan] = React.useState(25);
  const [leverage, setLeverage] = React.useState(5);

  const r = marginRequirement({ capital, positionValue: value, spanPercent: span, leverage });

  return (
    <div className="grid grid-2 calc-layout">
      <div className="stack">
        <NumInput id="mg-c" label="Available margin" prefix={RS} value={capital} onChange={setCapital} min={0} step={10000} />
        <NumInput id="mg-v" label="Position value" prefix={RS} value={value} onChange={setValue} min={0} step={10000} />
        <NumInput id="mg-s" label="Exchange span" suffix="%" value={span} onChange={setSpan} min={0} max={100} step={1} />
        <NumInput id="mg-l" label="Broker leverage" suffix="x" value={leverage} onChange={setLeverage} min={1} max={20} step={0.5} />
      </div>
      <div>
        <div className={`calc-hero is-${r.blocked ? "bear" : "bull"}`}>
          <div className="calc-hero-label">Margin required</div>
          <div className="calc-hero-value">{money(r.marginRequired, 0)}</div>
          <div className="calc-hero-sub">
            {r.blocked ? "Above your available margin" : `${money(r.leverageAchieved, 2)}x effective leverage`}
          </div>
        </div>
        <div className="calc-rows">
          <ResultRow label="Blocked by exchange" value={money(value * (span / 100), 0)} />
          <ResultRow label="Margin on leveraged portion" value={money((value * (1 - span / 100)) / leverage, 0)} />
          <ResultRow label="Total margin" value={money(r.marginRequired, 0)} accent />
          <ResultRow label="Available margin" value={money(capital, 0)} />
          <ResultRow
            label="Headroom"
            value={signedMoney(capital - r.marginRequired, 0)}
            tone={toneOf(capital - r.marginRequired)}
          />
          <ResultRow label="Further position capacity" value={money(r.additionalCapacity, 0)} />
        </div>
        {r.blocked ? (
          <Notice tone="warn">
            This position needs {money(r.marginRequired - capital, 0)} more margin than you hold.
            Reduce size or raise leverage.
          </Notice>
        ) : null}
      </div>
    </div>
  );
}

function DrawdownTool() {
  const [peak, setPeak] = React.useState(100000);
  const [trough, setTrough] = React.useState(78000);

  const dd = drawdownPercent(peak, trough);
  const recovered = trough > 0 ? round(((peak - trough) / trough) * 100) : 0;

  return (
    <div className="grid grid-2 calc-layout">
      <div className="stack">
        <NumInput id="dd-p" label="Peak equity" prefix={RS} value={peak} onChange={setPeak} min={0} step={10000} />
        <NumInput id="dd-t" label="Trough equity" prefix={RS} value={trough} onChange={setTrough} min={0} step={10000} />
      </div>
      <div>
        <div className={`calc-hero is-${dd > 20 ? "bear" : "muted"}`}>
          <div className="calc-hero-label">Drawdown</div>
          <div className="calc-hero-value">{percent(dd)}</div>
          <div className="calc-hero-sub">
            {money(peak - trough, 0)} lost from the peak
          </div>
        </div>
        <div className="calc-rows">
          <ResultRow label="Peak" value={money(peak, 0)} />
          <ResultRow label="Trough" value={money(trough, 0)} />
          <ResultRow label="Absolute fall" value={signedMoney(trough - peak, 0)} tone="bear" />
          <ResultRow label="Drawdown" value={percent(dd)} tone="bear" accent />
          <ResultRow label="Gain needed to recover" value={percent(recovered)} tone="bull" />
        </div>
        <Notice tone="info">
          Losses are asymmetric: a {percent(dd)} fall needs a {percent(recovered)} gain to get back
          to the peak.
        </Notice>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Valuation
   ───────────────────────────────────────────────────────────────────────── */

function ValuationTool() {
  const [price, setPrice] = React.useState(1250);
  const [shares, setShares] = React.useState(1000000000);
  const [eps, setEps] = React.useState(42);
  const [peak, setPeak] = React.useState(100000);
  const [trough, setTrough] = React.useState(78000);

  const cap = marketCap(price, shares);
  const pe = peRatio(price, eps);
  const dd = drawdownPercent(peak, trough);

  return (
    <div className="grid grid-2 calc-layout">
      <div className="stack">
        <NumInput id="vl-p" label="Share price" prefix={RS} value={price} onChange={setPrice} min={0} step={1} />
        <NumInput id="vl-s" label="Shares outstanding" value={shares} onChange={setShares} min={0} step={1000000} />
        <NumInput id="vl-e" label="Earnings per share" prefix={RS} value={eps} onChange={setEps} step={0.5} />
        <Divider />
        <NumInput id="vl-dp" label="Peak equity" prefix={RS} value={peak} onChange={setPeak} min={0} step={10000} />
        <NumInput id="vl-dt" label="Trough equity" prefix={RS} value={trough} onChange={setTrough} min={0} step={10000} />
      </div>
      <div>
        <div className="calc-hero">
          <div className="calc-hero-label">Market capitalisation</div>
          <div className="calc-hero-value">{moneyShort(cap)}</div>
          <div className="calc-hero-sub">{money(cap, 0)}</div>
        </div>
        <div className="calc-rows">
          <ResultRow label="Market cap" value={moneyShort(cap)} />
          <ResultRow
            label="Price / earnings"
            value={pe === null ? "Not meaningful" : `${round(pe, 2)}x`}
            hint={pe === null ? "earnings must be positive" : undefined}
            tone={pe === null ? undefined : pe > 40 ? "bear" : pe > 0 ? "bull" : undefined}
          />
          <Divider />
          <ResultRow label="Drawdown from peak" value={percent(dd)} tone="bear" />
        </div>
        {pe === null ? (
          <Notice tone="warn">
            A company at a loss has no meaningful P/E. Use price-to-book or EV/EBITDA instead.
          </Notice>
        ) : null}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Rate card
   ───────────────────────────────────────────────────────────────────────── */

const RATE_ROWS: { label: string; key: keyof CostRates }[] = [
  { label: "Brokerage (per order, lower of)", key: "brokeragePct" },
  { label: "Brokerage cap per order", key: "brokerageFlat" },
  { label: "STT (sell side)", key: "sttSellPct" },
  { label: "Exchange transaction charge", key: "exchangePct" },
  { label: "SEBI turnover fee", key: "sebiPct" },
  { label: "Stamp duty (buy side)", key: "stampBuyPct" },
  { label: "GST", key: "gstPct" },
];

function RateCard() {
  return (
    <Card title="Charge rates used" subtitle="Applied per round trip, on the sell leg for STT and the buy leg for stamp duty.">
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Charge</th>
              {(Object.keys(SEGMENTS) as Segment[]).map((key) => (
                <th key={key} style={{ textAlign: "right" }}>
                  {SEGMENTS[key].short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RATE_ROWS.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                {(Object.keys(SEGMENTS) as Segment[]).map((key) => {
                  const value = SEGMENTS[key].rates[row.key];
                  const text =
                    typeof value === "boolean"
                      ? value
                        ? "both sides"
                        : "sell side"
                      : row.key === "brokerageFlat"
                        ? money(value as number, 0)
                        : `${value}%`;
                  return (
                    <td key={key} style={{ textAlign: "right" }} className="num">
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Disclaimer>
        Rates reflect published NSE/BSE charges as of FY 2025-26 with a flat-fee discount broker.
        Exchanges and the regulator revise these periodically, and your broker contract may differ.
        Confirm against your contract note before relying on the figures. Capital gains tax and
        STT on derivatives are excluded where they need a separate computation.
      </Disclaimer>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Page
   ───────────────────────────────────────────────────────────────────────── */

type ToolId =
  | "position"
  | "trade"
  | "sip"
  | "lumpsum"
  | "cagr"
  | "emi"
  | "fd"
  | "rd"
  | "swp"
  | "inflation"
  | "margin"
  | "drawdown"
  | "valuation";

const TOOLS: { id: ToolId; label: string; group: string; blurb: string }[] = [
  { id: "position", label: "Position Size", group: "Trading", blurb: "Risk-based sizing with charges" },
  { id: "trade", label: "Trade P&L", group: "Trading", blurb: "Net P&L and full charge breakdown" },
  { id: "margin", label: "Margin", group: "Trading", blurb: "Intraday margin and leverage" },
  { id: "drawdown", label: "Drawdown", group: "Trading", blurb: "Peak-to-trough loss and recovery" },
  { id: "sip", label: "SIP", group: "Investing", blurb: "Monthly investing with step-up" },
  { id: "lumpsum", label: "Lumpsum", group: "Investing", blurb: "One-time compound growth" },
  { id: "cagr", label: "CAGR", group: "Investing", blurb: "Annualised growth rate" },
  { id: "swp", label: "SWP", group: "Investing", blurb: "Systematic withdrawal plan" },
  { id: "inflation", label: "Inflation", group: "Investing", blurb: "Real purchasing power" },
  { id: "emi", label: "Loan EMI", group: "Loans & deposits", blurb: "Equated monthly instalment" },
  { id: "fd", label: "FD", group: "Loans & deposits", blurb: "Fixed deposit maturity" },
  { id: "rd", label: "RD", group: "Loans & deposits", blurb: "Recurring deposit maturity" },
  { id: "valuation", label: "Valuation", group: "Loans & deposits", blurb: "Market cap and P/E" },
];

const GROUPS = ["Trading", "Investing", "Loans & deposits"] as const;

export default function CalculatorPage() {
  const [tool, setTool] = React.useState<ToolId>("position");

  return (
    <main className="page">
      <PageHeader
        eyebrow="Analysis"
        title="Financial Calculator"
        description="Thirteen calculators covering position sizing, trade costs, investing and loans. Every figure is computed in your browser from the tested maths in lib/calculator.ts."
        actions={<Badge tone="bull">143 checks passing</Badge>}
      />

      <nav className="calc-nav" aria-label="Calculators">
        {GROUPS.map((group) => (
          <div key={group} className="calc-nav-group">
            <div className="calc-nav-title">{group}</div>
            <div className="calc-nav-items">
              {TOOLS.filter((t) => t.group === group).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTool(t.id)}
                  className={`calc-nav-item ${t.id === tool ? "is-active" : ""}`}
                  aria-current={t.id === tool ? "true" : undefined}
                >
                  <span className="calc-nav-label">{t.label}</span>
                  <span className="calc-nav-blurb">{t.blurb}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <Card
        title={TOOLS.find((t) => t.id === tool)?.label}
        subtitle={TOOLS.find((t) => t.id === tool)?.blurb}
      >
        {tool === "position" ? <PositionSizerTool /> : null}
        {tool === "trade" ? <TradeTool /> : null}
        {tool === "margin" ? <MarginTool /> : null}
        {tool === "drawdown" ? <DrawdownTool /> : null}
        {tool === "sip" ? <SipTool /> : null}
        {tool === "lumpsum" ? <LumpsumTool /> : null}
        {tool === "cagr" ? <CagrTool /> : null}
        {tool === "swp" ? <SwpTool /> : null}
        {tool === "inflation" ? <InflationTool /> : null}
        {tool === "emi" ? <EmiTool /> : null}
        {tool === "fd" ? <DepositTool /> : null}
        {tool === "rd" ? <RecurringDepositTool /> : null}
        {tool === "valuation" ? <ValuationTool /> : null}
      </Card>

      <RateCard />

      <Disclaimer>
        These calculators are planning aids, not advice. Position sizing assumes the stop is
        honoured and ignores slippage, gap risk and partial fills. Deposit and loan projections
        assume constant rates. Verify charges and tax with your own contract notes.
      </Disclaimer>
    </main>
  );
}