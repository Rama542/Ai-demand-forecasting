"use client";
import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries, ColorType, createChart,
  type CandlestickData, type IChartApi, type ISeriesApi, type UTCTimestamp,
} from "lightweight-charts";

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type WsMessage =
  | { type: "history"; symbol: string; interval: string; candles: Candle[] }
  | { type: "candle_update"; symbol: string; interval: string; candle: Candle };

const INTERVALS = ["1m", "5m", "15m", "1H", "1D"];
const FALLBACK_SYMBOLS = ["NIFTY 50", "SENSEX", "BANKNIFTY", "RELIANCE", "TCS", "HDFCBANK", "INFY", "TATAMOTORS"];
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const formatINR = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export default function LiveCandlestickChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staleRef = useRef(false);
  const lastTimeRef = useRef<number | null>(null);
  const prevCloseRef = useRef<number | null>(null);
  const currentCloseRef = useRef<number | null>(null);
  const fittedRef = useRef(false);

  const [symbol, setSymbol] = useState("NIFTY 50");
  const [interval, setInterval] = useState("1m");
  const [symbols, setSymbols] = useState<string[]>(FALLBACK_SYMBOLS);
  const [price, setPrice] = useState<number | null>(null);
  const [changePct, setChangePct] = useState<number | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");

  useEffect(() => {
    fetch(`${API_URL}/api/market/symbols`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => { if (Array.isArray(data) && data.length) setSymbols(data.map((d: { symbol: string }) => d.symbol)); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#0b111a" }, textColor: "#8d9aa5", fontFamily: "Manrope, sans-serif", fontSize: 11 },
      grid: { vertLines: { color: "rgba(38,51,63,0.35)" }, horzLines: { color: "rgba(38,51,63,0.35)" } },
      rightPriceScale: { borderColor: "#25313a" },
      timeScale: { borderColor: "#25313a", timeVisible: true, secondsVisible: false, rightOffset: 3 },
      crosshair: { mode: 0 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#45d69e", downColor: "#ff5d73", borderUpColor: "#45d69e", borderDownColor: "#ff5d73",
      wickUpColor: "#45d69e", wickDownColor: "#ff5d73",
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, []);

  useEffect(() => {
    let disposed = false;
    staleRef.current = false;
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    const connect = () => {
      if (staleRef.current || disposed) return;
      setStatus("connecting");
      const url = `${API_URL.replace(/^http/, "ws")}/ws/market/${encodeURIComponent(symbol)}?interval=${interval}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => setStatus("live");
      ws.onmessage = (event) => {
        const message: WsMessage = JSON.parse(String(event.data));
        if (!seriesRef.current) return;
        if (message.type === "history") {
          const last = message.candles[message.candles.length - 1];
          if (last) {
            lastTimeRef.current = last.time;
            currentCloseRef.current = last.close;
            prevCloseRef.current = message.candles.length > 1 ? message.candles[message.candles.length - 2].close : null;
            setPrice(last.close);
            setChangePct(prevCloseRef.current ? ((last.close - prevCloseRef.current) / prevCloseRef.current) * 100 : null);
          }
          const candles: CandlestickData[] = message.candles.map(mapCandle);
          seriesRef.current.setData(candles);
          if (!fittedRef.current && chartRef.current) { chartRef.current.timeScale().fitContent(); fittedRef.current = true; }
        } else if (message.type === "candle_update") {
          const { candle } = message;
          if (candle.time !== lastTimeRef.current) {
            prevCloseRef.current = currentCloseRef.current;
            lastTimeRef.current = candle.time;
          }
          currentCloseRef.current = candle.close;
          seriesRef.current.update(mapCandle(candle));
          setPrice(candle.close);
          setChangePct(prevCloseRef.current ? ((candle.close - prevCloseRef.current) / prevCloseRef.current) * 100 : null);
        }
      };
      ws.onerror = () => setStatus("offline");
      ws.onclose = () => {
        if (staleRef.current || disposed) return;
        setStatus("offline");
        retryRef.current = setTimeout(connect, 2500);
      };
    };
    connect();
    return () => {
      staleRef.current = true;
      disposed = true;
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null; }
      fittedRef.current = false;
      prevCloseRef.current = null;
      currentCloseRef.current = null;
      lastTimeRef.current = null;
      setPrice(null); setChangePct(null);
    };
  }, [symbol, interval]);

  const positive = changePct !== null && changePct >= 0;
  return (
    <section className="card chart-card">
      <div className="chart-head">
        <div className="chart-titles">
          <p className="eyebrow">LIVE MARKET DATA</p>
          <h2>Live Candlestick Chart</h2>
          <span className={`chart-live-pill ${status}`}><span /> {status === "live" ? "LIVE" : status === "connecting" ? "CONNECTING" : "OFFLINE"}</span>
        </div>
        <div className="chart-controls">
          <label className="chart-symbol">
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Instrument">
              {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div className="interval-tabs">
            {INTERVALS.map((iv) => (
              <button key={iv} type="button" className={interval === iv ? "selected" : ""} onClick={() => setInterval(iv)}>{iv}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="chart-quote">
        <b>{symbol}</b>
        <strong>{price !== null ? formatINR(price) : "—"}</strong>
        <em className={changePct !== null && changePct < 0 ? "red" : "green"}>
          {changePct !== null ? `${positive ? "+" : "−"}${Math.abs(changePct).toFixed(2)}%` : "—"}
        </em>
      </div>
      <div className="chart-box" ref={containerRef} />
      <p className="chart-notice">Simulated intraday feed for demo. Hook the Upstox WebSocket (or another provider) behind the backend to stream real NSE data.</p>
    </section>
  );
}

function mapCandle(c: Candle): CandlestickData {
  return { time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close };
}