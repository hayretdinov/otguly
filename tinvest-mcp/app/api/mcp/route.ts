import { timingSafeEqual } from 'node:crypto';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  allowedInstruments,
  assertAllowedInstrument,
  cancelStopOrder,
  ensureSandboxAccount,
  getActiveOrders,
  getActiveStops,
  getCandles,
  getInstrumentMeta,
  getOperationsToday,
  getPortfolio,
  postMarketOrder,
  postStopLoss,
  postTakeProfit,
  qfloat,
} from '@/lib/tinvest';
import { snapshot } from '@/lib/indicators';

export const runtime = 'nodejs';
export const maxDuration = 60;

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function envNumber(name: string, fallback: number) {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

async function sandboxState() {
  const accountId = await ensureSandboxAccount();
  const [portfolio, orders, stops, operations] = await Promise.all([
    getPortfolio(accountId),
    getActiveOrders(accountId),
    getActiveStops(accountId),
    getOperationsToday(accountId),
  ]);
  const equityRub = qfloat(portfolio.totalAmountPortfolio);
  const positions = (portfolio.positions || []).filter((p: any) => Math.abs(qfloat(p.quantity)) > 1e-9);
  const buysToday = operations.filter((o: any) => String(o.operationType || o.type || '').includes('BUY'));
  return { accountId, portfolio, orders, stops, operations, equityRub, positions, buysToday };
}

function assertTradingSafety(state: Awaited<ReturnType<typeof sandboxState>>) {
  if (process.env.TRADING_ENABLED !== 'true') throw new Error('TRADING_ENABLED=false');
  if (process.env.KILL_SWITCH === 'true') throw new Error('KILL_SWITCH=true');

  const maxPositions = envNumber('MAX_OPEN_POSITIONS', 2);
  if (state.positions.length >= maxPositions) throw new Error(`Open-position limit reached (${maxPositions})`);

  const maxTrades = envNumber('MAX_TRADES_PER_DAY', 4);
  if (state.buysToday.length >= maxTrades) throw new Error(`Daily trade limit reached (${maxTrades})`);

  const cooldown = envNumber('MIN_SECONDS_BETWEEN_TRADES', 900);
  const lastBuyTs = state.buysToday
    .map((o: any) => Date.parse(o.date || o.operationDate || ''))
    .filter((x: number) => Number.isFinite(x))
    .sort((a: number, b: number) => b - a)[0];
  if (lastBuyTs && Date.now() - lastBuyTs < cooldown * 1000) throw new Error('Trade cooldown is active');

  const startRub = envNumber('SANDBOX_START_RUB', 1_000_000);
  const maxDd = envNumber('MAX_CUMULATIVE_DRAWDOWN_PCT', 0.02);
  if (state.equityRub > 0 && state.equityRub <= startRub * (1 - maxDd)) {
    throw new Error(`Cumulative drawdown safety gate reached (${(maxDd * 100).toFixed(2)}%)`);
  }
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'get_status',
      {
        title: 'T-Invest Sandbox Status',
        description: 'Read-only status of the sandbox bridge, account, positions, orders and safety gates.',
        inputSchema: z.object({}),
      },
      async () => {
        const base = {
          sandboxOnly: true,
          tradingEnabled: process.env.TRADING_ENABLED === 'true',
          killSwitch: process.env.KILL_SWITCH === 'true',
          tokenConfigured: Boolean(process.env.TINVEST_SANDBOX_TOKEN),
          allowedInstruments: allowedInstruments(),
          limits: {
            maxRiskPerTrade: envNumber('MAX_RISK_PER_TRADE', 0.005),
            maxOpenPositions: envNumber('MAX_OPEN_POSITIONS', 2),
            maxTradesPerDay: envNumber('MAX_TRADES_PER_DAY', 4),
            maxTradeNotionalRub: envNumber('MAX_TRADE_NOTIONAL_RUB', 250_000),
            minSecondsBetweenTrades: envNumber('MIN_SECONDS_BETWEEN_TRADES', 900),
          },
        };
        if (!process.env.TINVEST_SANDBOX_TOKEN) return text(base);
        const s = await sandboxState();
        return text({
          ...base,
          accountId: s.accountId,
          equityRub: s.equityRub,
          openPositions: s.positions.length,
          activeOrders: s.orders.length,
          activeStops: s.stops.length,
          buysToday: s.buysToday.length,
        });
      },
    );

    server.registerTool(
      'market_snapshot',
      {
        title: 'Market Snapshot H1',
        description: 'Get complete H1 candle indicators for one allowlisted instrument. Read-only; does not place orders.',
        inputSchema: z.object({ instrumentId: z.string().min(3).max(40) }),
      },
      async ({ instrumentId }) => {
        assertAllowedInstrument(instrumentId);
        const [meta, candles] = await Promise.all([
          getInstrumentMeta(instrumentId),
          getCandles(instrumentId, 14, 600),
        ]);
        return text({ instrument: meta, timeframe: '1h', snapshot: snapshot(candles), candleCount: candles.length });
      },
    );

    server.registerTool(
      'sandbox_portfolio',
      {
        title: 'Sandbox Portfolio',
        description: 'Read current T-Invest sandbox portfolio and protective orders.',
        inputSchema: z.object({}),
      },
      async () => {
        const s = await sandboxState();
        return text({
          accountId: s.accountId,
          equityRub: s.equityRub,
          positions: s.portfolio.positions || [],
          activeOrders: s.orders,
          activeStops: s.stops,
          buysToday: s.buysToday.length,
        });
      },
    );

    server.registerTool(
      'execute_sandbox_buy',
      {
        title: 'Execute Protected Sandbox Buy',
        description: 'Buy an allowlisted instrument in T-Invest Sandbox only. The bridge independently sizes risk and immediately creates server-side stop-loss and take-profit orders. If protection fails, it attempts an emergency close.',
        inputSchema: z.object({
          instrumentId: z.string().min(3).max(40),
          stopPrice: z.number().positive(),
          takeProfitPrice: z.number().positive(),
          riskPct: z.number().positive().max(0.005).default(0.005),
          rationale: z.string().max(500).optional(),
        }),
      },
      async ({ instrumentId, stopPrice, takeProfitPrice, riskPct, rationale }) => {
        assertAllowedInstrument(instrumentId);
        const state = await sandboxState();
        assertTradingSafety(state);

        const [meta, candles] = await Promise.all([
          getInstrumentMeta(instrumentId),
          getCandles(instrumentId, 4, 200),
        ]);
        if (!candles.length) throw new Error('No market candles');
        const marketPrice = candles[candles.length - 1].close;
        if (!(stopPrice < marketPrice && marketPrice < takeProfitPrice)) {
          throw new Error(`Invalid protection: require stop < market (${marketPrice}) < take profit`);
        }

        const maxRisk = envNumber('MAX_RISK_PER_TRADE', 0.005);
        const effectiveRisk = Math.min(riskPct, maxRisk);
        const maxNotional = envNumber('MAX_TRADE_NOTIONAL_RUB', 250_000);
        const lotSize = Math.max(1, meta.lot);
        const riskCash = state.equityRub * effectiveRisk;
        const riskPerLot = (marketPrice - stopPrice) * lotSize;
        const lotsByRisk = Math.floor(riskCash / Math.max(riskPerLot, 1e-9));
        const lotsByNotional = Math.floor(maxNotional / Math.max(marketPrice * lotSize, 1e-9));
        const lots = Math.max(0, Math.min(lotsByRisk, lotsByNotional));
        if (lots < 1) throw new Error('Position size resolved to 0 lots under safety limits');

        const buy = await postMarketOrder(state.accountId, instrumentId, lots, 'BUY');
        const executedLots = Math.max(0, Number(buy.lotsExecuted ?? lots));
        if (executedLots < 1) throw new Error(`Buy was not executed: ${JSON.stringify(buy)}`);

        let sl: any | undefined;
        let tp: any | undefined;
        try {
          sl = await postStopLoss(state.accountId, instrumentId, executedLots, stopPrice);
          tp = await postTakeProfit(state.accountId, instrumentId, executedLots, takeProfitPrice);
        } catch (protectionError) {
          try {
            if (sl?.stopOrderId) await cancelStopOrder(state.accountId, sl.stopOrderId);
            if (tp?.stopOrderId) await cancelStopOrder(state.accountId, tp.stopOrderId);
          } catch {}
          let emergencyClose: any;
          try {
            emergencyClose = await postMarketOrder(state.accountId, instrumentId, executedLots, 'SELL');
          } catch (closeError) {
            throw new Error(`CRITICAL: protection failed and emergency close also failed. Protection=${String(protectionError)} Close=${String(closeError)}`);
          }
          throw new Error(`Protection failed; position emergency-closed. ${String(protectionError)} Close=${JSON.stringify(emergencyClose)}`);
        }

        return text({
          sandboxOnly: true,
          instrumentId,
          name: meta.name,
          marketPrice,
          lots: executedLots,
          lotSize,
          estimatedNotionalRub: marketPrice * lotSize * executedLots,
          riskPct: effectiveRisk,
          riskCashRub: riskCash,
          stopPrice,
          takeProfitPrice,
          rationale: rationale || null,
          buyOrder: buy,
          stopLossOrderId: sl?.stopOrderId,
          takeProfitOrderId: tp?.stopOrderId,
        });
      },
    );

    server.registerTool(
      'close_sandbox_position',
      {
        title: 'Close Sandbox Position',
        description: 'Close an existing allowlisted sandbox position. Cancels active protective stops for that instrument first.',
        inputSchema: z.object({
          instrumentId: z.string().min(3).max(40),
          rationale: z.string().min(1).max(500),
        }),
      },
      async ({ instrumentId, rationale }) => {
        if (process.env.TRADING_ENABLED !== 'true') throw new Error('TRADING_ENABLED=false');
        if (process.env.KILL_SWITCH === 'true') throw new Error('KILL_SWITCH=true');
        assertAllowedInstrument(instrumentId);
        const state = await sandboxState();
        const meta = await getInstrumentMeta(instrumentId);
        const position = state.positions.find((p: any) => p.instrumentUid === meta.uid || p.figi === meta.figi);
        if (!position) return text({ closed: false, reason: 'No open position for instrument' });
        const shares = Math.abs(qfloat(position.quantity));
        const lots = Math.floor(shares / Math.max(1, meta.lot));
        if (lots < 1) throw new Error('Position is smaller than one lot');

        const matchingStops = state.stops.filter((s: any) => s.instrumentUid === meta.uid || s.figi === meta.figi || `${s.ticker}_${s.classCode}` === instrumentId);
        for (const s of matchingStops) {
          if (s.stopOrderId) {
            try { await cancelStopOrder(state.accountId, s.stopOrderId); } catch {}
          }
        }
        const sell = await postMarketOrder(state.accountId, instrumentId, lots, 'SELL');
        return text({ sandboxOnly: true, closed: true, instrumentId, lots, rationale, sellOrder: sell });
      },
    );
  },
  {
    serverInfo: { name: 'tinvest-sandbox-agent', version: '0.1.0' },
    maxSubscriptions: 0,
  },
);

const authed = withMcpAuth(
  handler,
  async (_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> => {
    const expected = process.env.MCP_ACCESS_TOKEN?.trim();
    if (!expected || !bearerToken || !safeEqual(expected, bearerToken)) return undefined;
    return { token: bearerToken, clientId: 'chatgpt-owner', scopes: ['sandbox:read', 'sandbox:trade'] };
  },
  { required: true },
);

export { authed as GET, authed as POST };
