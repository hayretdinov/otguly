export type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number };

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    out.push(i === 0 ? values[i] : values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function rsi(values: number[], period = 14): number[] {
  const out = new Array(values.length).fill(NaN);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    gain += Math.max(d, 0); loss += Math.max(-d, 0);
  }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function atr(c: Candle[], period = 14): number[] {
  const tr = c.map((x, i) => i === 0
    ? x.high - x.low
    : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close)));
  const out = new Array(c.length).fill(NaN);
  if (c.length < period) return out;
  let a = tr.slice(0, period).reduce((s, x) => s + x, 0) / period;
  out[period - 1] = a;
  for (let i = period; i < c.length; i++) {
    a = (a * (period - 1) + tr[i]) / period;
    out[i] = a;
  }
  return out;
}

export function snapshot(candles: Candle[]) {
  if (candles.length < 60) throw new Error('Need at least 60 complete H1 candles');
  const closes = candles.map(c => c.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const r14 = rsi(closes, 14);
  const a14 = atr(candles, 14);
  const i = candles.length - 1;
  const last = candles[i];
  const prev20 = candles.slice(Math.max(0, i - 20), i);
  const high20 = Math.max(...prev20.map(c => c.high));
  const avgVol20 = prev20.reduce((s, c) => s + c.volume, 0) / Math.max(prev20.length, 1);
  return {
    time: last.time,
    price: last.close,
    ema20: e20[i],
    ema50: e50[i],
    rsi14: r14[i],
    atr14: a14[i],
    high20,
    volume: last.volume,
    avgVolume20: avgVol20,
    trendUp: e20[i] > e50[i],
    breakout20: last.close > high20,
    volumeConfirmed: last.volume > avgVol20 * 1.2,
    baselineLongSetup: e20[i] > e50[i] && r14[i] >= 50 && r14[i] <= 68 && last.close > high20 && last.volume > avgVol20 * 1.2,
  };
}
