"use client";
import { useMemo, useState, useCallback, useEffect } from "react";
import LiveCandlestickChart from "./components/LiveCandlestickChart";

const nav = ["Overview", "Markets", "Asset Allocation", "Strategy Lab", "Market Doctor", "News Intel", "Community", "Backtesting", "Forecast Accuracy", "Watchlist", "Economic Calendar", "Scenario Lab", "Learning"];
const bars = [42, 53, 45, 62, 57, 76, 68, 84, 80, 91, 86, 99];
const stocks = [
  ["RELIANCE", "₹2,942.60", "+1.42%", "up"], ["TCS", "₹3,881.20", "+0.68%", "up"],
  ["HDFCBANK", "₹1,628.40", "−0.37%", "down"], ["INFY", "₹1,461.55", "+2.08%", "up"]
];
const news = [
  ["Markets", "Nifty holds above 22,400 as banking stocks lead the session", "Bullish", "82"],
  ["Earnings", "Reliance expands green-energy investment roadmap", "Bullish", "76"],
  ["Macro", "RBI policy commentary keeps bond markets steady", "Neutral", "61"]
];
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function Sparkline({ positive = true }: { positive?: boolean }) { return <svg viewBox="0 0 120 38" className="spark"><path d={positive ? "M2 31 C16 32,19 18,32 23 S48 9,60 17 S76 22,87 8 S104 10,118 3" : "M2 7 C17 2,24 16,37 12 S51 30,64 19 S79 25,91 26 S103 32,118 35"} fill="none" stroke={positive ? "#42d897" : "#ff697f"} strokeWidth="2.5" /></svg> }
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section> }

/* ── AI Chatbot hook ───────────────────────────────────────────────── */
function useMentor(symbol?: string) {
  const [chat, setChat] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<{from:string;text:string}[]>([
    {from:"AI Mentor", text:"Ask me to explain an indicator, market move, or strategy."}
  ]);
  const send = useCallback(async (question?: string) => {
    const prompt = (question || chat).trim();
    if (!prompt || loading) return;
    setChat(""); setError(""); setLoading(true);
    setMessages(m => [...m, {from:"You", text:prompt}]);
    const offline = "I'm currently in offline mode. I can explain RSI, MACD, portfolio risk, and market context without giving financial advice. Try asking about one of those topics.";
    try {
      const res = await fetch(`${API}/api/mentor/chat`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({message: prompt, symbol: symbol || undefined})
      });
      if (!res.ok) throw new Error("Mentor service unavailable");
      const data: {answer?: string} = await res.json();
      setMessages(m => [...m, {from:"AI Mentor", text: data.answer || offline}]);
    } catch {
      setError("The live mentor service is offline, so an offline research response was used.");
      setMessages(m => [...m, {from:"AI Mentor", text: offline}]);
    } finally { setLoading(false); }
  }, [chat, loading, symbol]);
  return {chat, setChat, loading, error, messages, send};
}

/* ── Learning Progress hook ────────────────────────────────────────── */
const LESSONS = ["RSI", "MACD", "Risk management", "Candlesticks"] as const;
type LessonId = typeof LESSONS[number];

function useLearningProgress() {
  const [completed, setCompleted] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem("mm_learning_progress");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  const toggle = useCallback((id: string) => {
    setCompleted(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem("mm_learning_progress", JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  }, []);

  const isComplete = useCallback((id: string) => completed.has(id), [completed]);
  const progress = Math.round((completed.size / LESSONS.length) * 100);

  return { completed, toggle, isComplete, progress, total: LESSONS.length, done: completed.size };
}

/* ── Risk Management Lesson ────────────────────────────────────────── */
function RiskManagementLesson({ mentorSend }: { mentorSend: (q: string) => void }) {
  const [portfolioSize, setPortfolioSize] = useState(100000);
  const [riskPercent, setRiskPercent] = useState(1);
  const [entryPrice, setEntryPrice] = useState(2500);
  const [stopLoss, setStopLoss] = useState(2400);
  const [targetPrice, setTargetPrice] = useState(2700);

  const riskAmount = portfolioSize * (riskPercent / 100);
  const riskPerShare = entryPrice - stopLoss;
  const positionSize = riskPerShare > 0 ? Math.floor(riskAmount / riskPerShare) : 0;
  const positionValue = positionSize * entryPrice;
  const potentialProfit = positionSize * (targetPrice - entryPrice);
  const potentialLoss = positionSize * riskPerShare;
  const rrRatio = riskPerShare > 0 ? (targetPrice - entryPrice) / riskPerShare : 0;
  const portfolioImpact = portfolioSize > 0 ? ((potentialLoss / portfolioSize) * 100) : 0;

  return (
    <div className="lesson-content">
      <div className="lesson-hero">
        <span className="feature-icon">◇</span>
        <h2>Risk Management</h2>
        <p>Master position sizing, stop-losses, and drawdown discipline to protect your capital.</p>
      </div>

      <div className="lesson-sections">
        <Card className="lesson-card">
          <p className="eyebrow">LESSON 1 · POSITION SIZING</p>
          <h3>The 1% Rule</h3>
          <p>Never risk more than 1–2% of your total portfolio on a single trade. This ensures that even a string of losses won&apos;t devastate your account.</p>
          <div className="lesson-key-point">
            <b>Formula:</b>
            <code>Position Size = Risk Amount ÷ (Entry − Stop Loss)</code>
          </div>
          <p>If your portfolio is ₹1,00,000 and you risk 1%, you can afford to lose ₹1,000 on this trade. If your stop is ₹100 below entry, you buy 10 shares max.</p>
          <button className="link" onClick={() => mentorSend("Explain position sizing and the 1% rule in detail")}>Ask AI Mentor about this →</button>
        </Card>

        <Card className="lesson-card">
          <p className="eyebrow">LESSON 2 · STOP-LOSSES</p>
          <h3>Protecting Downside</h3>
          <p>A stop-loss is your pre-defined exit point. It removes emotion from trading and limits losses automatically.</p>
          <div className="lesson-key-point">
            <b>Types of stops:</b>
            <ul>
              <li><b>Fixed stop:</b> Set at a specific price below entry</li>
              <li><b>ATR stop:</b> Based on Average True Range (volatility-adjusted)</li>
              <li><b>Structure stop:</b> Below the most recent swing low</li>
              <li><b>Time stop:</b> Exit after N days if thesis hasn&apos;t played out</li>
            </ul>
          </div>
          <button className="link" onClick={() => mentorSend("What are the different types of stop-losses and when to use each?")}>Ask AI Mentor about stop types →</button>
        </Card>

        <Card className="lesson-card">
          <p className="eyebrow">LESSON 3 · RISK-REWARD RATIO</p>
          <h3>Asymmetric Bets</h3>
          <p>Only take trades where the potential reward is at least 2× the risk. A 1:2 R:R means you can be wrong 60% of the time and still profit.</p>
          <div className="lesson-key-point">
            <b>R:R Formula:</b>
            <code>R:R = (Target − Entry) ÷ (Entry − Stop Loss)</code>
          </div>
          <div className="lesson-table">
            <div className="lesson-table-header"><span>Win Rate</span><span>Min R:R Needed</span><span>Outcome</span></div>
            <div className="lesson-table-row"><span>40%</span><span>1 : 2.5</span><span className="mint-text">Profitable</span></div>
            <div className="lesson-table-row"><span>50%</span><span>1 : 2.0</span><span className="mint-text">Profitable</span></div>
            <div className="lesson-table-row"><span>60%</span><span>1 : 1.5</span><span className="mint-text">Profitable</span></div>
            <div className="lesson-table-row"><span>30%</span><span>1 : 4.0</span><span className="mint-text">Profitable</span></div>
          </div>
          <button className="link" onClick={() => mentorSend("How do I calculate the minimum win rate needed for a given risk-reward ratio?")}>Ask AI Mentor about R:R →</button>
        </Card>

        <Card className="lesson-card">
          <p className="eyebrow">LESSON 4 · DRAWDOWN</p>
          <h3>Surviving the Troughs</h3>
          <p>Maximum drawdown is the largest peak-to-trough decline. A 50% loss requires a 100% gain just to break even.</p>
          <div className="lesson-key-point">
            <b>Recovery Required:</b>
            <div className="drawdown-table">
              {[[10,11],[20,25],[30,43],[40,67],[50,100]].map(([loss,recovery])=>
                <div key={loss}><span className="red-text">−{loss}% loss</span><span>→ +{recovery}% to recover</span></div>
              )}
            </div>
          </div>
          <button className="link" onClick={() => mentorSend("Explain how drawdowns work and why they are asymmetric")}>Ask AI Mentor about drawdowns →</button>
        </Card>
      </div>

      {/* ── Interactive Position Sizer Calculator ── */}
      <Card className="lesson-calculator">
        <p className="eyebrow">INTERACTIVE TOOL · POSITION SIZE CALCULATOR</p>
        <h3>Calculate your position size</h3>
        <div className="calc-grid">
          <div className="calc-inputs">
            <label>Portfolio Size (₹)
              <input type="number" value={portfolioSize} onChange={e => setPortfolioSize(Math.max(0, Number(e.target.value)))} />
            </label>
            <label>Risk Per Trade (%)
              <input type="number" value={riskPercent} min={0.1} max={5} step={0.1} onChange={e => setRiskPercent(Math.max(0.1, Math.min(5, Number(e.target.value))))} />
            </label>
            <label>Entry Price (₹)
              <input type="number" value={entryPrice} min={1} onChange={e => setEntryPrice(Math.max(1, Number(e.target.value)))} />
            </label>
            <label>Stop Loss (₹)
              <input type="number" value={stopLoss} min={1} onChange={e => setStopLoss(Math.max(1, Number(e.target.value)))} />
            </label>
            <label>Target Price (₹)
              <input type="number" value={targetPrice} min={1} onChange={e => setTargetPrice(Math.max(1, Number(e.target.value)))} />
            </label>
          </div>
          <div className="calc-results">
            <div className="calc-result-card">
              <p>RISK AMOUNT</p>
              <b className="red-text">₹{riskAmount.toLocaleString("en-IN")}</b>
              <small>{riskPercent}% of portfolio</small>
            </div>
            <div className="calc-result-card">
              <p>POSITION SIZE</p>
              <b>{positionSize} shares</b>
              <small>₹{positionValue.toLocaleString("en-IN")} value</small>
            </div>
            <div className="calc-result-card">
              <p>RISK-REWARD</p>
              <b className={rrRatio >= 2 ? "mint-text" : rrRatio >= 1 ? "amber" : "red-text"}>1 : {rrRatio.toFixed(1)}</b>
              <small>{rrRatio >= 2 ? "Excellent" : rrRatio >= 1 ? "Acceptable" : "Poor"} ratio</small>
            </div>
            <div className="calc-result-card">
              <p>POTENTIAL P&L</p>
              <b className="mint-text">+₹{potentialProfit.toLocaleString("en-IN")}</b>
              <small className="red-text">Risk: −₹{potentialLoss.toLocaleString("en-IN")}</small>
            </div>
            <div className="calc-result-card">
              <p>PORTFOLIO IMPACT</p>
              <b className={portfolioImpact <= 2 ? "mint-text" : portfolioImpact <= 3 ? "amber" : "red-text"}>{portfolioImpact.toFixed(1)}%</b>
              <small>max loss if stopped out</small>
            </div>
          </div>
        </div>
        <div className="calc-warning">
          {riskPercent > 2 && <p>⚠ Risk per trade is above 2%. Most professional traders risk 0.5–1% per trade.</p>}
          {rrRatio < 1 && rrRatio > 0 && <p>⚠ Risk-reward ratio is below 1:1. Consider widening your target or tightening your stop.</p>}
          {positionSize === 0 && <p>⚠ Stop loss is above entry price. Position size cannot be calculated.</p>}
        </div>
      </Card>
    </div>
  );
}

/* ── RSI Lesson ────────────────────────────────────────────────────── */
function RSILesson({ mentorSend }: { mentorSend: (q: string) => void }) {
  const [rsiValue, setRsiValue] = useState(50);
  const zone = rsiValue >= 70 ? "Overbought" : rsiValue <= 30 ? "Oversold" : rsiValue >= 50 ? "Bullish" : "Bearish";
  const zoneColor = rsiValue >= 70 ? "red-text" : rsiValue <= 30 ? "mint-text" : rsiValue >= 50 ? "mint-text" : "red-text";

  return (
    <div className="lesson-content">
      <div className="lesson-hero">
        <span className="feature-icon">◇</span>
        <h2>RSI — Relative Strength Index</h2>
        <p>Understand momentum and overbought/oversold zones with the RSI indicator.</p>
      </div>
      <div className="lesson-sections">
        <Card className="lesson-card">
          <p className="eyebrow">WHAT IS RSI?</p>
          <h3>Momentum Oscillator (0–100)</h3>
          <p>RSI measures the speed and magnitude of recent price changes. It oscillates between 0 and 100, with 70+ considered overbought and 30− considered oversold.</p>
          <div className="lesson-key-point">
            <b>RSI Formula:</b>
            <code>RSI = 100 − (100 / (1 + RS))</code>
            <p style={{fontSize:"9px",color:"#8694a0",marginTop:"6px"}}>Where RS = Average Gain ÷ Average Loss over N periods (typically 14)</p>
          </div>
        </Card>
        <Card className="lesson-card">
          <p className="eyebrow">TRADING SIGNALS</p>
          <h3>How to Read RSI</h3>
          <div className="lesson-signals">
            <div className="signal-row"><span className="signal-badge oversold">RSI &lt; 30</span><span>Oversold — potential buy zone. Price may be due for a bounce.</span></div>
            <div className="signal-row"><span className="signal-badge overbought">RSI &gt; 70</span><span>Overbought — potential sell zone. Momentum may be exhausted.</span></div>
            <div className="signal-row"><span className="signal-badge bullish">Bullish divergence</span><span>Price makes lower low but RSI makes higher low — reversal signal.</span></div>
            <div className="signal-row"><span className="signal-badge bearish">Bearish divergence</span><span>Price makes higher high but RSI makes lower high — reversal signal.</span></div>
          </div>
          <button className="link" onClick={() => mentorSend("Explain RSI divergences and how to spot them on a chart")}>Ask AI Mentor about RSI divergences →</button>
        </Card>
      </div>
      <Card className="lesson-calculator">
        <p className="eyebrow">INTERACTIVE TOOL · RSI SIMULATOR</p>
        <h3>Explore RSI zones</h3>
        <div className="rsi-sim">
          <input type="range" min={0} max={100} value={rsiValue} onChange={e => setRsiValue(Number(e.target.value))} className="rsi-slider" />
          <div className="rsi-display">
            <b className={zoneColor}>{rsiValue}</b>
            <span className={zoneColor}>{zone}</span>
          </div>
          <div className="rsi-zones">
            <div className="rsi-zone oversold-zone"><small>0–30</small><span>Oversold</span></div>
            <div className="rsi-zone neutral-zone"><small>30–70</small><span>Neutral</span></div>
            <div className="rsi-zone overbought-zone"><small>70–100</small><span>Overbought</span></div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ── MACD Lesson ───────────────────────────────────────────────────── */
function MACDLesson({ mentorSend }: { mentorSend: (q: string) => void }) {
  return (
    <div className="lesson-content">
      <div className="lesson-hero">
        <span className="feature-icon">◇</span>
        <h2>MACD — Moving Average Convergence Divergence</h2>
        <p>Read trend changes using moving-average convergence and divergence.</p>
      </div>
      <div className="lesson-sections">
        <Card className="lesson-card">
          <p className="eyebrow">COMPONENTS</p>
          <h3>Three Lines to Watch</h3>
          <div className="lesson-key-point">
            <b>1. MACD Line</b> = 12-period EMA − 26-period EMA
            <p style={{fontSize:"10px",color:"#8694a0",marginTop:"4px"}}>Measures short-term vs long-term momentum. Rising = bullish, falling = bearish.</p>
          </div>
          <div className="lesson-key-point">
            <b>2. Signal Line</b> = 9-period EMA of MACD Line
            <p style={{fontSize:"10px",color:"#8694a0",marginTop:"4px"}}>Smoothed version of MACD. Crossovers with MACD line generate trade signals.</p>
          </div>
          <div className="lesson-key-point">
            <b>3. Histogram</b> = MACD − Signal
            <p style={{fontSize:"10px",color:"#8694a0",marginTop:"4px"}}>Visual representation of momentum strength. Growing bars = strengthening trend.</p>
          </div>
        </Card>
        <Card className="lesson-card">
          <p className="eyebrow">SIGNALS</p>
          <h3>MACD Crossovers</h3>
          <div className="lesson-signals">
            <div className="signal-row"><span className="signal-badge bullish">Bullish crossover</span><span>MACD crosses above Signal — momentum shifting up. Consider buying.</span></div>
            <div className="signal-row"><span className="signal-badge bearish">Bearish crossover</span><span>MACD crosses below Signal — momentum shifting down. Consider selling.</span></div>
            <div className="signal-row"><span className="signal-badge bullish">Zero-line cross</span><span>MACD crosses above zero — trend turning bullish on higher timeframe.</span></div>
            <div className="signal-row"><span className="signal-badge neutral">Histogram shrinking</span><span>Bars getting smaller — trend losing steam, potential reversal ahead.</span></div>
          </div>
          <button className="link" onClick={() => mentorSend("Explain MACD crossovers and histogram analysis in simple terms")}>Ask AI Mentor about MACD →</button>
        </Card>
        <Card className="lesson-card">
          <p className="eyebrow">PRO TIP</p>
          <h3>MACD + RSI Combo</h3>
          <p>Use MACD for trend direction and RSI for timing. When MACD gives a bullish crossover and RSI is below 50 (not yet overbought), the signal is stronger. Confluence of indicators reduces false signals.</p>
          <button className="link" onClick={() => mentorSend("How do I combine MACD and RSI for better trade entries?")}>Ask about combining indicators →</button>
        </Card>
      </div>
    </div>
  );
}

/* ── Candlesticks Lesson ───────────────────────────────────────────── */
function CandlestickLesson({ mentorSend }: { mentorSend: (q: string) => void }) {
  return (
    <div className="lesson-content">
      <div className="lesson-hero">
        <span className="feature-icon">◇</span>
        <h2>Candlestick Patterns</h2>
        <p>Learn price-action patterns in context — from single candles to multi-candle formations.</p>
      </div>
      <div className="lesson-sections">
        <Card className="lesson-card">
          <p className="eyebrow">ANATOMY</p>
          <h3>Reading a Candlestick</h3>
          <div className="candle-anatomy">
            <div className="candle-diagram">
              <div className="candle-wick-top"></div>
              <div className="candle-body bullish-body">
                <span>Close</span>
                <span>Open</span>
              </div>
              <div className="candle-wick-bottom"></div>
            </div>
            <div className="candle-labels">
              <div><b>Upper Wick</b><span>Highest price traded</span></div>
              <div><b>Body</b><span>Open → Close range</span></div>
              <div><b>Lower Wick</b><span>Lowest price traded</span></div>
              <div className="mint-text"><b>Green/Bullish</b><span>Close &gt; Open (price rose)</span></div>
              <div className="red-text"><b>Red/Bearish</b><span>Close &lt; Open (price fell)</span></div>
            </div>
          </div>
        </Card>
        <Card className="lesson-card">
          <p className="eyebrow">SINGLE CANDLE PATTERNS</p>
          <h3>Key Patterns to Know</h3>
          <div className="pattern-grid">
            {[
              ["Hammer", "Small body at top, long lower wick. Bullish reversal after downtrend.", "bullish"],
              ["Shooting Star", "Small body at bottom, long upper wick. Bearish reversal after uptrend.", "bearish"],
              ["Doji", "Open ≈ Close. Indecision — trend may be weakening.", "neutral"],
              ["Marubozu", "Full body, no wicks. Strong conviction in direction.", "bullish"],
              ["Spinning Top", "Small body, equal wicks. Market undecided.", "neutral"],
            ].map(([name, desc, mood]) => (
              <div key={name} className="pattern-card">
                <b className={mood === "bullish" ? "mint-text" : mood === "bearish" ? "red-text" : "amber"}>{name}</b>
                <p>{desc}</p>
              </div>
            ))}
          </div>
          <button className="link" onClick={() => mentorSend("Explain the hammer and shooting star candlestick patterns with examples")}>Ask AI Mentor about patterns →</button>
        </Card>
        <Card className="lesson-card">
          <p className="eyebrow">MULTI-CANDLE PATTERNS</p>
          <h3>Two & Three-Candle Formations</h3>
          <div className="pattern-grid">
            {[
              ["Engulfing", "Second candle fully engulfs the first. Strong reversal signal.", "bullish"],
              ["Morning Star", "3-candle bullish reversal: big down, small body, big up.", "bullish"],
              ["Evening Star", "3-candle bearish reversal: big up, small body, big down.", "bearish"],
              ["Three White Soldiers", "Three consecutive bullish candles. Strong uptrend continuation.", "bullish"],
            ].map(([name, desc, mood]) => (
              <div key={name} className="pattern-card">
                <b className={mood === "bullish" ? "mint-text" : "red-text"}>{name}</b>
                <p>{desc}</p>
              </div>
            ))}
          </div>
          <button className="link" onClick={() => mentorSend("What are the most reliable multi-candle patterns for Indian markets?")}>Ask about multi-candle patterns →</button>
        </Card>
      </div>
    </div>
  );
}

/* ── Real Backtest / Strategy / Forecast display components ──────── */
function EquityCurve({ curve, positive = false }: { curve: number[]; positive?: boolean }) {
  if (!curve || curve.length < 2) return <div className="empty-result">Equity curve unavailable.</div>;
  const min = Math.min(...curve), max = Math.max(...curve);
  const span = max - min || 1;
  const pts = curve.map((v, i) => `${(i / (curve.length - 1)) * 100},${34 - ((v - min) / span) * 30}`).join(" ");
  const up = curve[curve.length - 1] >= curve[0];
  return (
    <div className="chart-area">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ height: 90, width: "100%" }}>
        <polyline points={pts} fill="none" stroke={up ? "#48dc9f" : "#ff697f"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function StrategyLabResults({ data }: { data: any }) {
  if (!data) return null;
  if (data.error) return <div className="empty-result red-text">{data.error}</div>;
  const dir = (data.side || "BUY").toUpperCase();
  const bullish = dir.startsWith("BUY");
  return <>
    <div className="levels">
      <div><small>ENTRY ZONE</small><b>{data.entry?.toLocaleString("en-IN")}</b></div>
      <div><small>TARGET 1</small><b className="mint-text">{data.targets?.[0]?.toLocaleString("en-IN")}</b></div>
      <div><small>STOP LOSS</small><b className="red-text">{data.stop_loss?.toLocaleString("en-IN")}</b></div>
      <div><small>R:R</small><b>1 : {data.risk_reward || 0}</b></div>
    </div>
    <div className="metric-row">
      <span>Signal <b className={bullish ? "mint-text" : "red-text"}>{bullish ? "Buy" : "Sell / Avoid"}</b></span>
      <span>Probability <b>{data.probability}%</b></span>
      <span>Strength <b>{data.signal_strength}</b></span>
      <span>Holding time <b>{data.holding_time}</b></span>
    </div>
    {data.trend && <div className="metric-row">
      <span>RSI <b>{data.trend.rsi}</b></span>
      <span>ADX <b>{data.trend.adx}</b></span>
      <span>Support <b>{data.trend.support?.toLocaleString("en-IN")}</b></span>
      <span>Resistance <b>{data.trend.resistance?.toLocaleString("en-IN")}</b></span>
    </div>}
    {data.explanation && <p className="sub" style={{ marginTop: 10 }}>{data.explanation}</p>}
    {data.backtest && data.backtest.trades > 0 && <div className="metric-row" style={{ marginTop: 10 }}>
      <span>Strategy backtest <b>{data.backtest.trades} trades</b></span>
      <span>Win rate <b>{data.backtest.win_rate}%</b></span>
      <span>Return <b className={data.backtest.net_return >= 0 ? "mint-text" : "red-text"}>{data.backtest.net_return > 0 ? "+" : ""}{data.backtest.net_return}%</b></span>
      <span>Sharpe <b>{data.backtest.sharpe}</b></span>
    </div>}
    {data.forecast_accuracy && data.forecast_accuracy.direction_accuracy != null && <p className="sub" style={{ marginTop: 8 }}>Model out-of-sample direction accuracy: <b>{data.forecast_accuracy.direction_accuracy}%</b> · MAE {data.forecast_accuracy.mae}</p>}
  </>;
}

function BacktestResults({ data }: { data: any }) {
  if (!data) return null;
  if (data.error) return <div className="empty-result red-text">{data.error}</div>;
  const curve = Array.isArray(data.equity_curve) ? data.equity_curve : [];
  const ret = Number(data.net_return) || 0;
  return <>
    <div className="metric-grid">
      {[["TRADES", data.trades ?? 0], ["WIN RATE", `${data.win_rate ?? 0}%`], ["NET RETURN", `${ret > 0 ? "+" : ""}${ret}%`], ["MAX DRAWDOWN", `${data.max_drawdown ?? 0}%`], ["SHARPE", data.sharpe ?? 0], ["PROFIT FACTOR", data.profit_factor ?? 0]].map(([k, v]) =>
        <div className="bt-metric" key={k}><small>{k}</small><b className={(k === "NET RETURN" && ret < 0) || k === "MAX DRAWDOWN" ? "red-text" : (k === "NET RETURN" && ret > 0) ? "mint-text" : ""}>{v}</b></div>)}
    </div>
    <p className="eyebrow" style={{ marginTop: 14 }}>EQUITY CURVE</p>
    <EquityCurve curve={curve} />
    <div className="metric-row">
      <span>Strategy <b>{data.strategy}</b></span>
      <span>Interval <b>{data.interval}</b></span>
      <span>Candles <b>{data.candles_analyzed}</b></span>
      <span>Expectancy/trade <b className={data.expectancy_pct >= 0 ? "mint-text" : "red-text"}>{data.expectancy_pct}%</b></span>
    </div>
    {data.recent_40pct && <div className="metric-row" style={{ marginTop: 8 }}>
      <span>Recent 40% <b>{data.recent_40pct.trades} trades</b></span>
      <span>Win rate <b>{data.recent_40pct.win_rate}%</b></span>
      <span>Return <b>{data.recent_40pct.net_return}%</b></span>
      <span>Drawdown <b className="red-text">{data.recent_40pct.max_drawdown}%</b></span>
    </div>}
    {Array.isArray(data.trade_log) && data.trade_log.length > 0 && <>
      <p className="eyebrow" style={{ marginTop: 14 }}>TRADE LOG</p>
      <div className="bt-log">{data.trade_log.slice(-12).reverse().map((t: any, i: number) =>
        <div key={i}><span className={t.direction === "LONG" ? "mint-text" : "red-text"}>{t.direction}</span><span>{t.entry_price} → {t.exit_price}</span><b className={t.pnl_pct >= 0 ? "mint-text" : "red-text"}>{t.pnl_pct > 0 ? "+" : ""}{t.pnl_pct}%</b><small>{t.reason}</small></div>)}</div>
    </>}
  </>;
}

function ForecastAccuracyPanel() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`${API}/api/forecast/accuracy`)
      .then(r => r.json())
      .then(d => { if (d?.error) setError(d.error); else setData(d); })
      .catch(() => setError("Forecast service unavailable. Is the backend running on :8000?"));
  }, []);
  if (error) return <div className="empty-result red-text">{error}</div>;
  if (!data) return <Card className="result-card"><div className="empty-result">Computing walk-forward forecast…</div></Card>;
  const bars = (data.rolling_accuracy || []).map((b: any) => b.accuracy);
  const latest = data.latest_forecast || {};
  return <>
    <Card>
      <p className="eyebrow">{data.model?.toUpperCase()} / OUT-OF-SAMPLE</p>
      <h2>{data.direction_accuracy ?? "—"}% direction accuracy</h2>
      <div className="accuracy">
        <div><b>{data.mae ?? "—"}</b><span>Mean absolute error</span></div>
        <div><b>{data.rmse ?? "—"}</b><span>RMSE</span></div>
        <div><b>{data.confidence_calibration ?? "—"}</b><span>Confidence calibration</span></div>
        <div><b>{data.brier ?? "—"}</b><span>Brier score</span></div>
      </div>
      {data.precision != null && <div className="metric-row" style={{ marginBottom: 8 }}>
        <span>Precision <b>{data.precision}%</b></span><span>Recall <b>{data.recall}%</b></span><span>F1 <b>{data.f1}</b></span>
        <span>Samples <b>{data.samples?.train} train / {data.samples?.test} test</b></span>
      </div>}
      <div className="mini-bars big-bars">{bars.length ? bars.map((x, i) => <i key={i} style={{ height: `${Math.max(3, x)}%` }} className={x > 55 ? "hot" : ""} />) : <p className="sub">Rolling accuracy warming up…</p>}</div>
      <p className="sub" style={{ marginTop: 6 }}>Bars show rolling out-of-sample accuracy over the untouched test window.</p>
    </Card>
    <Card className="result-card">
      <p className="eyebrow">LATEST FORECAST · NEXT CANDLE</p>
      <h2>{data.symbol || "NIFTY 50"}</h2>
      <div className="empty-result">
        Direction: <b className={latest.direction === "UP" ? "mint-text" : "red-text"}>{latest.direction}</b><br />
        Probability: <b>{latest.probability}%</b><br />
        Last close: {latest.last_close?.toLocaleString("en-IN")}<br /><br />
        <span className="sub">Out-of-sample accuracy is computed only on bars the model never trained on — a true measure of how it performs on unseen market data.</span>
      </div>
    </Card>
  </>;
}

/* ── Main Dashboard ────────────────────────────────────────────────── */
export default function Dashboard() {
  const [active, setActive] = useState("Overview");
  const [period, setPeriod] = useState("Today");
  const [query, setQuery] = useState("");
  const [watching, setWatching] = useState(false);
  const strategy = useMemo(() => ({ symbol: query || "RELIANCE", entry: "₹2,928", target: "₹3,055", stop: "₹2,870" }), [query]);
  const progress = useLearningProgress();
  const [acc, setAcc] = useState<{ accuracy: number; mae: number; bars: number[] }>({ accuracy: 71.4, mae: 1.87, bars });
  useEffect(() => {
    fetch(`${API}/api/dashboard`).then(r => r.json()).then(d => {
      const f = d?.forecast;
      if (f && typeof f.direction_accuracy === "number") {
        setAcc({
          accuracy: f.direction_accuracy,
          mae: f.mae,
          bars: Array.isArray(d?.bars) && d.bars.length ? d.bars : bars,
        });
      }
    }).catch(() => {});
  }, []);
  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">M</span><span>marketmind<span className="ai">.ai</span></span></div>
      <div className="workspace"><span className="avatar">SA</span><div><b>Sharma Analytics</b><small>Pro workspace</small></div><span className="chevron">⌄</span></div>
      <nav>{nav.map((n, i) => <button key={n} onClick={() => setActive(n)} className={active === n ? "active" : ""}><span className="nav-icon">{["⌘", "◈", "◐", "✦", "⊕", "◌", "◉", "⌁", "◫", "☆", "▣", "◒", "◇"][i]}</span>{n}{n === "News Intel" && <i>7</i>}</button>)}</nav>
      <div className="sidebar-bottom"><button><span className="nav-icon">?</span>Help center</button><button><span className="nav-icon">⚙</span>Settings</button><div className="upgrade"><span>✦</span><div><b>Unlock more insight</b><small>Upgrade to Pro</small></div><strong>›</strong></div></div>
    </aside>
    <div className="content">
      <header><div className="crumb">Workspace <span>/</span> <b>{active}</b></div><div className="header-actions"><button className="search">⌕ <span>Search a stock, news or concept</span><kbd>⌘ K</kbd></button><button className="icon-button">◌</button><button className="profile">SG <span>⌄</span></button></div></header>
      {active === "Overview" ? <><div className="page-head"><div><p className="eyebrow">MARKET OVERVIEW</p><h1>Good morning, Sagar <span>✦</span></h1><p className="sub">Here&apos;s the pulse of the Indian market today.</p></div><div className="period"><button onClick={() => setPeriod("Today")} className={period === "Today" ? "selected" : ""}>Today</button><button onClick={() => setPeriod("This week")} className={period === "This week" ? "selected" : ""}>This week</button><button className="calendar">▣</button></div></div>
      <div className="market-ticker"><div className="live"><span></span> MARKET LIVE</div><b>NIFTY 50</b><strong>22,493.55</strong><em>+187.40 (0.84%)</em><div className="ticker-line"/><b>SENSEX</b><strong>74,742.50</strong><em>+0.71%</em><div className="ticker-line"/><b>INDIA VIX</b><strong>12.84</strong><em className="red">−4.12%</em><div className="ticker-note">Last updated 2 mins ago <span>↻</span></div></div>
      <div className="chart-section"><LiveCandlestickChart /></div>
      <div className="grid top-grid"><Card className="market-card"><div className="card-title"><div><p>MARKET SENTIMENT</p><h2>Bullish <span className="pill green">↑ 12%</span></h2></div><button className="more">•••</button></div><div className="sentiment"><div className="gauge"><div className="gauge-inner"><b>72</b><small>/ 100</small></div></div><div className="legend"><p><span className="dot mint"/>Bullish <b>58%</b></p><p><span className="dot neutral"/>Neutral <b>26%</b></p><p><span className="dot red-dot"/>Bearish <b>16%</b></p><small>Based on technicals, news &amp; community</small></div></div><div className="market-foot"><span>AI confidence <b>High</b></span><button>View analysis <span>→</span></button></div></Card>
        <Card className="index-card"><div className="card-title"><div><p>BENCHMARK INDEX</p><h2>NIFTY 50</h2></div><span className="pill green">+0.84%</span></div><div className="index-price">22,493.55 <small>+187.40 today</small></div><div className="chart-area"><div className="chart-labels"><span>22.6k</span><span>22.4k</span><span>22.2k</span></div><svg viewBox="0 0 500 132" preserveAspectRatio="none"><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#44d59b" stopOpacity=".28"/><stop offset="1" stopColor="#44d59b" stopOpacity="0"/></linearGradient></defs><path d="M0 99 C28 92 30 110 55 96 S86 98 106 82 S137 95 158 72 S190 95 210 68 S244 82 267 55 S288 66 314 46 S352 61 370 37 S405 54 431 32 S460 42 500 8 L500 132 L0 132Z" fill="url(#fill)"/><path d="M0 99 C28 92 30 110 55 96 S86 98 106 82 S137 95 158 72 S190 95 210 68 S244 82 267 55 S288 66 314 46 S352 61 370 37 S405 54 431 32 S460 42 500 8" fill="none" stroke="#48dc9f" strokeWidth="3"/></svg></div><div className="chart-times"><span>09:15</span><span>11:00</span><span>12:45</span><span>14:30</span><span>15:30</span></div></Card>
        <Card className="portfolio-card"><div className="card-title"><div><p>PORTFOLIO HEALTH</p><h2>Looking strong <span className="pulse"/></h2></div><button className="more">•••</button></div><div className="score-row"><div className="score"><b>82</b><span>Excellent</span></div><div><p>Overall score</p><div className="progress"><i/></div><small>+4 points this month</small></div></div><div className="portfolio-stats"><div><small>RISK LEVEL</small><b className="amber">Moderate</b></div><div><small>DIVERSIFICATION</small><b>Good</b></div></div><button className="outline-button">Open Market Doctor <span>→</span></button></Card></div>
      <div className="section-title"><div><p className="eyebrow">AI-POWERED INSIGHT</p><h2>Your market brief</h2></div><button className="link">View all insights <span>→</span></button></div>
      <div className="grid insight-grid"><Card className="strategy-card"><div className="strategy-top"><span className="feature-icon">✦</span><span className="label">STRATEGY SIGNAL</span><span className="pill green">High confidence</span></div><h3>{strategy.symbol}: Swing opportunity detected</h3><p>Strong momentum with a clean breakout above the 20-day EMA. Volume confirmation remains healthy.</p><div className="levels"><div><small>ENTRY ZONE</small><b>{strategy.entry}</b></div><div><small>TARGET</small><b className="mint-text">{strategy.target}</b></div><div><small>STOP LOSS</small><b className="red-text">{strategy.stop}</b></div><div><small>R:R</small><b>1 : 2.7</b></div></div><div className="strategy-bottom"><span><b>73%</b> probability · Swing · 3–7 days</span><button onClick={() => setQuery("")}>Explore strategy <span>→</span></button></div></Card>
        <Card className="accuracy-card"><div className="card-title"><div><p>MODEL PERFORMANCE</p><h3>Forecast accuracy <span className="pill green">↑ {acc.accuracy > 60 ? "Strong" : "Developing"}</span></h3></div><button className="more">•••</button></div><div className="accuracy"><div><b>{acc.accuracy.toFixed(1)}%</b><span>Direction accuracy (out-of-sample)</span></div><div className="mini-bars">{acc.bars.map((x,i) => <i key={i} style={{height:`${x}%`}} className={i > 7 ? "hot" : ""}/>)}</div></div><div className="accuracy-foot"><span>Powered by <b>XGBoost walk-forward</b></span><button>View accuracy <span>→</span></button></div></Card></div>
      <div className="grid lower-grid"><Card className="watch-card"><div className="card-title"><div><p>WATCHLIST</p><h2>On your radar</h2></div><button className="add" onClick={() => setWatching(!watching)}>{watching ? "✓ Added" : "+ Add stock"}</button></div><div className="stock-table">{stocks.map(([name,price,change,dir]) => <div key={name}><span className="stock-logo">{name[0]}</span><b>{name}<small>NSE</small></b><strong>{price}</strong><span className={dir}>{change}</span><Sparkline positive={dir === "up"}/><button>⋮</button></div>)}</div></Card>
        <Card className="news-card"><div className="card-title"><div><p>NEWS INTELLIGENCE</p><h2>What&apos;s moving markets</h2></div><button className="more">•••</button></div>{news.map(([tag, title, mood, score]) => <article key={title}><span className={`news-tag ${mood.toLowerCase()}`}>{tag}</span><div><h4>{title}</h4><small>AI impact: <b className={mood === "Bullish" ? "mint-text" : ""}>{mood}</b> · Confidence {score}%</small></div><button>→</button></article>)}<button className="news-link">Open News Intelligence <span>→</span></button></Card></div>
      <footer><span>⚠ Predictions are AI-generated research insights and should not be considered financial advice.</span><span>MarketMind AI · v0.1.0</span></footer></> : <FeatureWorkspace active={active} progress={progress} />}
    </div>
  </main>;
}

/* ── Feature Workspace ─────────────────────────────────────────────── */
function FeatureWorkspace({ active, progress }: { active: string; progress: ReturnType<typeof useLearningProgress> }) {
  const [symbol, setSymbol] = useState("RELIANCE");
  const [result, setResult] = useState("");
  const [selected, setSelected] = useState<string[]>(["RSI", "MACD", "EMA"]);
  const [learningLesson, setLearningLesson] = useState<string | null>(null);
  const mentor = useMentor(symbol);
  const [riskLevel, setRiskLevel] = useState("Medium");
  const [style, setStyle] = useState("Swing");
  const [btStrategy, setBtStrategy] = useState("Moving Average Crossover");
  const [btPeriod, setBtPeriod] = useState("Last 2 years");
  const [strategyResult, setStrategyResult] = useState<any>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [backtestResult, setBacktestResult] = useState<any>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const toggle = (item: string) => setSelected(x => x.includes(item) ? x.filter(v => v !== item) : [...x, item]);
  const title: Record<string, [string,string]> = {"Markets":["Markets", "Live pricing, breadth, sectors and macro pulse."],"Asset Allocation":["AI Asset Allocation Advisor", "Build a diversified, adaptive investment plan for current market conditions."],"Strategy Lab":["AI Strategy Lab","Build a rule-based trade thesis with explainable AI."],"Market Doctor":["AI Market Doctor","Diagnose portfolio concentration, risk and quality."],"News Intel":["News Intelligence","Research the stories moving markets and their likely impact."],"Community":["Community Pulse","Social-market sentiment from Reddit and Stocktwits."],"Backtesting":["Strategy Backtesting","Validate an idea before risking capital."],"Forecast Accuracy":["Forecast accuracy", "Track model quality against real market outcomes."],"Watchlist":["Watchlist", "Monitor the names that matter to your process."],"Economic Calendar":["Economic calendar", "Know the macro and corporate events that can move markets."],"Scenario Lab":["Scenario simulator", "Explore possible market reactions before they happen."],"Learning":["Learning mode","Build practical market knowledge, one concept at a time."]};
  const [heading, description] = title[active] || [active, "Explore MarketMind intelligence."];
  const run = (message: string) => setResult(message);

  const generateStrategy = useCallback(async () => {
    setStrategyLoading(true);
    try {
      const res = await fetch(`${API}/api/strategies/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, risk_level: riskLevel, style, indicators: selected }),
      });
      if (!res.ok) throw new Error("Strategy service unavailable");
      setStrategyResult(await res.json());
    } catch {
      setStrategyResult({ error: "Strategy service unavailable. Is the backend running on :8000?" });
    } finally { setStrategyLoading(false); }
  }, [symbol, riskLevel, style, selected]);

  const runBacktest = useCallback(async (s?: string) => {
    setBacktestLoading(true);
    try {
      const res = await fetch(`${API}/api/backtests/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, risk_level: riskLevel, style, strategy: s || btStrategy, period: btPeriod }),
      });
      if (!res.ok) throw new Error("Backtest service unavailable");
      setBacktestResult(await res.json());
    } catch {
      setBacktestResult({ error: "Backtest service unavailable. Is the backend running on :8000?" });
    } finally { setBacktestLoading(false); }
  }, [symbol, riskLevel, style, btStrategy, btPeriod]);

  const mentorPrompts = active === "Learning" && learningLesson
    ? (learningLesson === "Risk management" ? ["Explain the 1% rule", "How do I set stop-losses?", "What is position sizing?", "How to calculate R:R ratio?"]
      : learningLesson === "RSI" ? ["Explain RSI simply", "What is RSI divergence?", "How to use RSI for entries?", "RSI vs RSI divergences?"]
      : learningLesson === "MACD" ? ["What is MACD?", "Explain MACD crossovers", "How to read MACD histogram?", "MACD vs RSI which is better?"]
      : ["Explain candlestick anatomy", "What is a hammer pattern?", "Engulfing pattern explained", "Morning star setup?"])
    : ["Explain RSI in simple words", "What does MACD tell me?", "Why is Nifty moving today?", "How do I diversify my portfolio?"];

  return <div className="feature-page"><div className="page-head"><div><p className="eyebrow">MARKETMIND AI / {active.toUpperCase()}</p><h1>{heading}</h1><p className="sub">{description}</p></div></div>
    {active === "Asset Allocation" && <AllocationAdvisor />}
    {active === "Strategy Lab" && <div className="feature-grid"><Card className="tool-card"><h2>Create a strategy</h2><label>Symbol<input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} /></label><label>Risk profile<select value={riskLevel} onChange={e=>setRiskLevel(e.target.value)}><option>Medium</option><option>Low</option><option>High</option></select></label><label>Trading style<select value={style} onChange={e=>setStyle(e.target.value)}><option>Swing</option><option>Intraday</option><option>Positional</option><option>Long Term</option></select></label><p className="form-label">INDICATORS</p><div className="chips">{["RSI","MACD","EMA","VWAP","Bollinger","ADX","ATR"].map(i=><button key={i} className={selected.includes(i)?"chip selected-chip":"chip"} onClick={()=>toggle(i)}>{selected.includes(i)?"✓ ":""}{i}</button>)}</div><button className="primary" onClick={()=>generateStrategy()} disabled={strategyLoading}>{strategyLoading ? "Analyzing…" : "Generate AI strategy"} <span>✦</span></button></Card><Card className="result-card"><p className="eyebrow">EXPLAINABLE OUTPUT</p><h2>{strategyResult ? (strategyResult.error ? "Generation failed" : `${strategyResult.symbol} · ${strategyResult.side}`) : "Your AI strategy will appear here"}</h2><div className="empty-result">{strategyResult ? <StrategyLabResults data={strategyResult} /> : "Select your risk, style and preferred indicators, then generate a research-backed trade plan."}</div></Card></div>}
    {active === "Market Doctor" && <div className="feature-grid"><Card className="tool-card"><h2>Analyze your portfolio</h2><label>Holdings (comma-separated)<textarea placeholder="RELIANCE, TCS, HDFCBANK, INFY" /></label><label>Investment horizon<select><option>Long term</option><option>Swing</option><option>Intraday</option></select></label><button className="primary" onClick={()=>run("Portfolio score 82/100 · Moderate risk · Good diversification. AI suggests reducing financial concentration and adding healthcare/FMCG exposure.")}>Run Market Doctor <span>✦</span></button></Card><Card className="result-card"><p className="eyebrow">PORTFOLIO DIAGNOSIS</p><h2>{result ? "Healthy, with one alert" : "No diagnosis yet"}</h2><div className="empty-result">{result || "Add holdings to receive risk, diversification, drawdown, beta and correlation analysis."}</div></Card></div>}
    {active === "Backtesting" && <div className="feature-grid"><Card className="tool-card"><h2>Validate a strategy</h2><label>Symbol<input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())}/></label><label>Strategy<select value={btStrategy} onChange={e=>setBtStrategy(e.target.value)}><option>Moving Average Crossover</option><option>Momentum</option><option>Mean Reversion</option><option>Breakout</option></select></label><label>Trading style<select value={style} onChange={e=>setStyle(e.target.value)}><option>Swing</option><option>Intraday</option><option>Positional</option><option>Long Term</option></select></label><label>Test period<select value={btPeriod} onChange={e=>setBtPeriod(e.target.value)}><option>Last 2 years</option><option>Last 1 year</option><option>Last 5 years</option></select></label><button className="primary" onClick={()=>runBacktest()} disabled={backtestLoading}>{backtestLoading ? "Running…" : "Run backtest"} <span>▶</span></button></Card><Card className="result-card"><p className="eyebrow">OUT-OF-SAMPLE WALK-FORWARD RESULT</p><h2>{backtestResult ? (backtestResult.error ? "Backtest failed" : `${backtestResult.symbol} · ${backtestResult.strategy}`) : "Ready to test"}</h2><div className="empty-result">{backtestResult ? <BacktestResults data={backtestResult} /> : "Runs use out-of-sample-style entries (price at the bar after the signal) and include transaction costs before interpreting results."}</div></Card></div>}
    {active === "News Intel" && <Card className="feed-card"><div className="filter-row"><button className="chip selected-chip">All news</button><button className="chip">Bullish</button><button className="chip">Bearish</button><button className="chip">Macro</button></div>{news.concat([["Corporate", "IT sector guidance improves after latest global demand data", "Bullish", "74"], ["Macro", "Oil prices rise ahead of central-bank decisions", "Neutral", "59"]]).map(([tag,title,mood,score])=><article key={title}><span className="news-tag">{tag}</span><div><h3>{title}</h3><p>AI summary: This development may influence the affected sector over the next few sessions.</p><small>Impact <b className={mood === "Bullish" ? "mint-text" : "amber"}>{mood}</b> · Confidence {score}%</small></div><button className="outline-button" onClick={()=>run(`Saved: ${title}`)}>Save</button></article>)}{result&&<p className="toast">{result}</p>}</Card>}
    {active === "Community" && <div className="feature-grid"><Card><p className="eyebrow">REDDIT + STOCKTWITS</p><h2>Community sentiment <span className="mint-text">64% bullish</span></h2><div className="sentiment-mini"><b>RELIANCE</b><span>▲ 71% bullish</span><b>TATAMOTORS</b><span>▲ 68% bullish</span><b>INFY</b><span>— 52% neutral</span></div></Card><Card className="result-card"><p className="eyebrow">TRENDING DISCUSSIONS</p><h3>Bank Nifty breaks out after a strong opening.</h3><p>r/IndianStreetBets · AI sentiment: <b className="mint-text">Bullish</b></p><hr/><h3>Traders are watching IT earnings guidance.</h3><p>Stocktwits · AI sentiment: Neutral</p></Card></div>}
    {active === "Markets" && <><div className="chart-section"><LiveCandlestickChart /></div><div className="feature-grid"><Card><p className="eyebrow">CORRELATION ENGINE</p><h2>Market relationships</h2><div className="heatmap">{["NIFTY","SENSEX","BANK","GOLD","USDINR","VIX"].map((a,i)=><div key={a}><b>{a}</b>{[.96,.84,.62,.22,-.18,-.58].map((v,j)=><i key={j} style={{opacity:Math.abs(v)-(i===j?0:.1)}}>{i===j?"1.0":v}</i>)}</div>)}</div><p className="sub">Nifty and Sensex remain tightly correlated; VIX has an inverse relationship with equity indices.</p></Card><Card className="result-card"><p className="eyebrow">SECTOR ROTATION</p><h2>Leaders today</h2><div className="rank"><span>1</span> Banking <b>+1.8%</b><span>2</span> Auto <b>+1.2%</b><span>3</span> IT <b>+0.9%</b></div></Card></div></>}
    {active === "Forecast Accuracy" && <div className="feature-grid"><ForecastAccuracyPanel /></div>}
    {active === "Watchlist" && <Card className="watch-card"><div className="card-title"><div><p>PERSONAL WATCHLIST</p><h2>Research queue</h2></div><button className="add" onClick={()=>run("New stock added to watchlist")}>+ Add symbol</button></div><div className="stock-table">{stocks.concat([["TATAMOTORS","₹1,014.20","+1.94%","up"]]).map(([name,price,change,dir])=><div key={name}><span className="stock-logo">{name[0]}</span><b>{name}<small>NSE</small></b><strong>{price}</strong><span className={dir}>{change}</span><Sparkline positive={dir==="up"}/><button onClick={()=>run(`${name} alert configured`)}>⋮</button></div>)}</div>{result&&<p className="toast">{result}</p>}</Card>}
    {active === "Economic Calendar" && <Card className="feed-card"><p className="eyebrow">UPCOMING EVENTS</p>{[["SEP 10","RBI monetary policy meeting","High"],["SEP 12","India CPI inflation release","High"],["SEP 18","US FOMC rate decision","High"],["SEP 24","Reliance quarterly results","Medium"]].map(([date,event,impact])=><article key={event}><span className="news-tag">{date}</span><div><h3>{event}</h3><p>AI expected impact: volatility may increase around the release. Review exposure and event risk.</p></div><span className={impact==="High"?"pill red-text":"pill amber"}>{impact} impact</span></article>)}</Card>}
    {active === "Scenario Lab" && <div className="feature-grid"><Card className="tool-card"><h2>Run a market scenario</h2><label>Scenario<select><option>RBI cuts rates by 25 bps</option><option>Crude oil rises 10%</option><option>USDINR falls 3%</option><option>Gold rises 5%</option></select></label><label>Horizon<select><option>1 month</option><option>1 week</option><option>3 months</option></select></label><button className="primary" onClick={()=>run("Scenario result: Banking and rate-sensitive sectors may benefit; INR-sensitive exporters could face pressure. Confidence: medium.")}>Simulate impact ✦</button></Card><Card className="result-card"><p className="eyebrow">AI SCENARIO ANALYSIS</p><h2>{result ? "Possible market reaction" : "Select a scenario"}</h2><div className="empty-result">{result || "MarketMind will explain likely sector, index and portfolio effects. Scenarios are exploratory research, not forecasts."}</div></Card></div>}
    {active === "Learning" && !learningLesson && <>
      <div className="learn-progress-bar">
        <div className="learn-progress-header">
          <p className="eyebrow">YOUR PROGRESS</p>
          <span>{progress.done}/{progress.total} lessons completed</span>
        </div>
        <div className="learn-progress-track"><div className="learn-progress-fill" style={{width:`${progress.progress}%`}}/></div>
        {progress.progress === 100 && <div className="learn-all-done">🎉 All lessons completed! You&apos;re ready to apply these concepts.</div>}
      </div>
      <div className="learn-grid">{[
        ["RSI","Understand momentum and overbought/oversold zones."],
        ["MACD","Read trend changes using moving-average convergence."],
        ["Risk management","Position size, stops and drawdown discipline."],
        ["Candlesticks","Learn price-action patterns in context."]
      ].map(([name,copy])=><Card key={name} className="learn-clickable"><div className="learn-card-top"><span className="feature-icon">◇</span>{progress.isComplete(name) && <span className="learn-badge">✓ Done</span>}</div><h2>{name}</h2><p>{copy}</p><div className="learn-card-actions"><button className="link" onClick={()=>setLearningLesson(name)}>Start lesson →</button><button className="learn-toggle" onClick={(e)=>{e.stopPropagation();progress.toggle(name)}}>{progress.isComplete(name) ? "Mark incomplete" : "Mark complete"}</button></div></Card>)}</div>
    </>}
    {active === "Learning" && learningLesson === "Risk management" && <><div className="learn-nav"><button className="link" onClick={()=>setLearningLesson(null)}>← Back to all lessons</button>{!progress.isComplete("Risk management") && <button className="learn-toggle" onClick={()=>progress.toggle("Risk management")}>Mark as complete ✓</button>}</div><RiskManagementLesson mentorSend={mentor.send} /></>}
    {active === "Learning" && learningLesson === "RSI" && <><div className="learn-nav"><button className="link" onClick={()=>setLearningLesson(null)}>← Back to all lessons</button>{!progress.isComplete("RSI") && <button className="learn-toggle" onClick={()=>progress.toggle("RSI")}>Mark as complete ✓</button>}</div><RSILesson mentorSend={mentor.send} /></>}
    {active === "Learning" && learningLesson === "MACD" && <><div className="learn-nav"><button className="link" onClick={()=>setLearningLesson(null)}>← Back to all lessons</button>{!progress.isComplete("MACD") && <button className="learn-toggle" onClick={()=>progress.toggle("MACD")}>Mark as complete ✓</button>}</div><MACDLesson mentorSend={mentor.send} /></>}
    {active === "Learning" && learningLesson === "Candlesticks" && <><div className="learn-nav"><button className="link" onClick={()=>setLearningLesson(null)}>← Back to all lessons</button>{!progress.isComplete("Candlesticks") && <button className="learn-toggle" onClick={()=>progress.toggle("Candlesticks")}>Mark as complete ✓</button>}</div><CandlestickLesson mentorSend={mentor.send} /></>}
    <Card className="mentor"><div><span className="feature-icon">✦</span><div><p className="eyebrow">AI MARKET MENTOR</p><h3>Ask anything about the markets</h3></div><span className={mentor.loading ? "mentor-status thinking" : "mentor-status"}>{mentor.loading ? "Thinking…" : "● Online"}</span></div><div className="mentor-prompts">{mentorPrompts.map(prompt=><button type="button" key={prompt} onClick={()=>mentor.send(prompt)}>{prompt}</button>)}</div><div className="chat-log" aria-live="polite">{mentor.messages.map((m,i)=><div className={m.from === "You" ? "chat-message user-message" : "chat-message"} key={i}><b>{m.from}</b><p>{m.text}</p></div>)}{mentor.loading && <div className="chat-message"><b>AI Mentor</b><p className="typing">Thinking<span>.</span><span>.</span><span>.</span></p></div>}</div>{mentor.error && <p className="mentor-error">{mentor.error}</p>}<form onSubmit={e=>{e.preventDefault();mentor.send()}}><input value={mentor.chat} onChange={e=>mentor.setChat(e.target.value)} disabled={mentor.loading} placeholder="e.g. Explain why Nifty is rising today"/><button className="primary" disabled={mentor.loading}>{mentor.loading ? "Thinking…" : "Ask AI →"}</button></form><small className="mentor-disclaimer">Educational research only. The mentor does not provide financial advice.</small></Card>
    <footer><span>⚠ Predictions are AI-generated research insights and should not be considered financial advice.</span><span>MarketMind AI · v0.1.0</span></footer>
  </div>
}

/* ── Allocation Advisor (unchanged) ────────────────────────────────── */
function AllocationAdvisor() {
  const [amount, setAmount] = useState(500000);
  const [risk, setRisk] = useState("Moderate");
  const [goal, setGoal] = useState("Wealth Creation");
  const [horizon, setHorizon] = useState("3 Years");
  const [market, setMarket] = useState("Indian Market");
  const [signal, setSignal] = useState("Current conditions");
  const allocation = useMemo(() => {
    const base: Record<string, [string, number, string][]> = {
      Conservative: [["Gold",25,"#f2bd55"],["Nifty 50",25,"#58dca4"],["FMCG",10,"#68aef7"],["Pharma",10,"#b98cf5"],["IT",5,"#ff8f9b"],["Silver",5,"#bbc7d1"],["Cash",20,"#64748b"]],
      Moderate: [["Gold",15,"#f2bd55"],["Nifty 50",25,"#58dca4"],["Bank Nifty",10,"#68aef7"],["IT",10,"#b98cf5"],["Auto",7,"#ff8f9b"],["Pharma",8,"#77cdb5"],["Midcap",10,"#5e83e7"],["Silver",5,"#bbc7d1"],["Cash",10,"#64748b"]],
      Aggressive: [["Nifty 50",25,"#58dca4"],["Midcap",15,"#5e83e7"],["Smallcap",10,"#b98cf5"],["IT",12,"#ff8f9b"],["Banking",10,"#68aef7"],["Auto",8,"#77cdb5"],["Pharma",5,"#cb92f4"],["Gold",5,"#f2bd55"],["Silver",5,"#bbc7d1"],["Cash",5,"#64748b"]]
    };
    const values = base[risk].map(x => [...x] as [string,number,string]);
    const move = (from:string,to:string,p:number) => { const f=values.find(x=>x[0]===from); const t=values.find(x=>x[0]===to); if(f&&t){f[1]-=p;t[1]+=p;} };
    if(signal === "VIX spike") move(values.some(x=>x[0] === "Bank Nifty") ? "Bank Nifty" : "Nifty 50", "Cash", 5);
    if(signal === "Gold bullish") move("Cash", "Gold", 5);
    if(signal === "RBI rate cut") move("Gold", "Bank Nifty", 5);
    if(signal === "Banking weak") move(values.some(x=>x[0] === "Bank Nifty") ? "Bank Nifty" : "Banking", "Cash", 5);
    if(signal === "IT earnings improve") move("Cash", "IT", 5);
    return values;
  },[risk,signal]);
  const total = allocation.reduce((sum,x)=>sum+x[1],0);
  const pie = `conic-gradient(${allocation.reduce((s,x,i)=>{const start=allocation.slice(0,i).reduce((a,v)=>a+v[1],0);return `${s}${x[2]} ${start}% ${start+x[1]}%,`;},"").slice(0,-1)})`;
  const fmt = new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0});
  const expected = risk === "Conservative" ? "8–11%" : risk === "Moderate" ? "11–15%" : "14–21%";
  const volatility = risk === "Conservative" ? "9.5%" : risk === "Moderate" ? "14.2%" : "21.8%";
  return <div className="allocation-page">
    <div className="allocation-layout"><Card className="tool-card allocation-form"><p className="eyebrow">PERSONALIZED ALLOCATION</p><h2>Build your investment plan</h2><label>Investment amount<input type="number" min="1000" value={amount} onChange={e=>setAmount(Math.max(0,Number(e.target.value)))} /></label><label>Risk profile<select value={risk} onChange={e=>setRisk(e.target.value)}><option>Conservative</option><option>Moderate</option><option>Aggressive</option></select></label><label>Investment goal<select value={goal} onChange={e=>setGoal(e.target.value)}><option>Wealth Creation</option><option>Retirement</option><option>Swing Trading</option><option>Monthly Income</option><option>Capital Preservation</option></select></label><label>Investment horizon<select value={horizon} onChange={e=>setHorizon(e.target.value)}>{["1 Week","1 Month","3 Months","6 Months","1 Year","3 Years","5 Years"].map(x=><option key={x}>{x}</option>)}</select></label><label>Preferred market<select value={market} onChange={e=>setMarket(e.target.value)}><option>Indian Market</option><option>US Market</option><option>Global</option></select></label><p className="form-label">DYNAMIC REBALANCE SIGNAL</p><div className="chips">{["Current conditions","VIX spike","Gold bullish","RBI rate cut","Banking weak","IT earnings improve"].map(x=><button type="button" onClick={()=>setSignal(x)} className={signal===x?"chip selected-chip":"chip"} key={x}>{x}</button>)}</div></Card>
      <Card className="allocation-summary"><div className="card-title"><div><p>AI RECOMMENDATION</p><h2>{risk} allocation <span className="pill green">{total}% allocated</span></h2></div><span className="live"><span/> LIVE SIGNALS</span></div><div className="allocation-hero"><div className="pie" style={{background:pie}}><div><b>{total}%</b><small>invested</small></div></div><div className="summary-copy"><b>{fmt.format(amount)}</b><span>recommended capital</span><p>Built for <strong>{goal}</strong> over <strong>{horizon}</strong> in the <strong>{market}</strong>.</p><div className="confidence"><span>AI confidence</span><b>78 / 100</b><i><em/></i></div></div></div><div className="allocation-list">{allocation.map(([name,percent,color])=><div key={name}><i style={{background:color}}/><b>{name}</b><span>{fmt.format(amount*percent/100)}</span><strong>{percent}%</strong></div>)}</div></Card></div>
    <div className="grid allocation-metrics"><Card><p className="eyebrow">PORTFOLIO HEALTH</p><b className="large-metric">84<span>/100</span></b><p className="mint-text">Well diversified</p></Card><Card><p className="eyebrow">EXPECTED RETURN</p><b className="large-metric">{expected}</b><p>Annualized research range</p></Card><Card><p className="eyebrow">EXPECTED VOLATILITY</p><b className="large-metric">{volatility}</b><p>Risk-adjusted estimate</p></Card><Card><p className="eyebrow">MAX DRAWDOWN</p><b className="large-metric red-text">−{risk === "Aggressive" ? "18" : risk === "Moderate" ? "12" : "7"}%</b><p>Historical stress estimate</p></Card><Card><p className="eyebrow">SHARPE ESTIMATE</p><b className="large-metric">{risk === "Aggressive" ? "1.18" : risk === "Moderate" ? "1.36" : "1.22"}</b><p>Return per unit of risk</p></Card></div>
    <div className="grid allocation-bottom"><Card><p className="eyebrow">AI REASONING</p><h2>Why this mix</h2><div className="reasoning"><div><b>Gold · {allocation.find(x=>x[0]==="Gold")?.[1] || 0}%</b><p>Gold provides a diversification hedge while volatility and macro uncertainty remain elevated.</p></div><div><b>Nifty 50 · {allocation.find(x=>x[0]==="Nifty 50")?.[1] || 0}%</b><p>Broad-market exposure participates in the prevailing uptrend without single-stock concentration.</p></div><div><b>Cash · {allocation.find(x=>x[0]==="Cash")?.[1] || 0}%</b><p>Liquidity protects capital and preserves flexibility around calendar-driven volatility.</p></div></div><p className="rebalance-note">✦ Dynamic rebalance active: <b>{signal}</b>. Review this allocation when macro conditions or your goals change.</p></Card><Card><p className="eyebrow">SECTOR ROTATION ENGINE</p><h2>Forward-looking sector posture</h2>{[["Technology","Bullish","72%"],["Pharma","Bullish","76%"],["Banking","Neutral","58%"],["Auto","Bullish","67%"]].map(([sector,status,chance])=><div className="rotation" key={sector}><b>{sector}</b><span className={status==="Bullish"?"pill green":"pill amber"}>{status}</span><strong>{chance} probability</strong><small>next 20 days</small></div>)}</Card><Card><p className="eyebrow">HISTORICAL COMPARISON</p><h2>Similar allocation regimes</h2><div className="historical"><span>Backtested return <b className="mint-text">+14.8%</b></span><span>Maximum drawdown <b className="red-text">−10.6%</b></span><span>Sharpe ratio <b>1.31</b></span><span>Positive periods <b>68%</b></span></div><button className="outline-button">Open full allocation backtest →</button></Card></div>
    <p className="allocation-disclaimer">⚠ Allocation recommendations are AI-generated research insights and should not be considered financial advice. Historical performance does not guarantee future results.</p>
  </div>
}
