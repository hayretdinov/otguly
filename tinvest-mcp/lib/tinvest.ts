const BASE = 'https://sandbox-invest-public-api.tbank.ru/rest/tinkoff.public.invest.api.contract.v1';

function requiredEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

export function qfloat(v: any): number {
  if (!v) return 0;
  return Number(v.units ?? 0) + Number(v.nano ?? 0) / 1_000_000_000;
}

export function quotation(value: number) {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  let units = Math.floor(abs);
  let nano = Math.round((abs - units) * 1_000_000_000);
  if (nano >= 1_000_000_000) {
    units += 1;
    nano = 0;
  }
  return { units: String(sign * units), nano: sign * nano };
}

async function post<T = any>(service: string, method: string, body: Record<string, unknown>): Promise<T> {
  const token = requiredEnv('TINVEST_SANDBOX_TOKEN');
  const res = await fetch(`${BASE}.${service}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-app-name': 'openai.tinvest-sandbox-mcp',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}: ${text.slice(0, 700)}`);
  return text ? JSON.parse(text) as T : ({} as T);
}

export function allowedInstruments(): string[] {
  return (process.env.ALLOWED_INSTRUMENTS || 'SBER_TQBR,LKOH_TQBR,YDEX_TQBR,GAZP_TQBR')
    .split(',').map(s => s.trim()).filter(Boolean);
}

export function assertAllowedInstrument(instrumentId: string) {
  if (!allowedInstruments().includes(instrumentId)) {
    throw new Error(`Instrument ${instrumentId} is not in ALLOWED_INSTRUMENTS`);
  }
}

export async function getInstrumentMeta(instrumentId: string) {
  assertAllowedInstrument(instrumentId);
  const idx = instrumentId.lastIndexOf('_');
  if (idx <= 0) throw new Error('Instrument must be ticker_classCode, e.g. SBER_TQBR');
  const ticker = instrumentId.slice(0, idx);
  const classCode = instrumentId.slice(idx + 1);
  const data: any = await post('InstrumentsService', 'GetInstrumentBy', {
    idType: 'INSTRUMENT_ID_TYPE_TICKER',
    classCode,
    id: ticker,
  });
  const instrument = data.instrument;
  if (!instrument) throw new Error(`Instrument metadata not found for ${instrumentId}`);
  if (instrument.apiTradeAvailableFlag === false) throw new Error(`${instrumentId} is not API-tradeable`);
  return {
    id: instrumentId,
    uid: instrument.uid,
    figi: instrument.figi,
    ticker: instrument.ticker,
    classCode: instrument.classCode,
    name: instrument.name,
    lot: Number(instrument.lot || 1),
    currency: instrument.currency,
    apiTradeAvailableFlag: Boolean(instrument.apiTradeAvailableFlag),
  };
}

export async function getCandles(instrumentId: string, days = 10, limit = 1000) {
  assertAllowedInstrument(instrumentId);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  const data: any = await post('MarketDataService', 'GetCandles', {
    from: from.toISOString(),
    to: to.toISOString(),
    interval: 'CANDLE_INTERVAL_HOUR',
    instrumentId,
    candleSourceType: 'CANDLE_SOURCE_EXCHANGE',
    limit,
  });
  return (data.candles || [])
    .filter((c: any) => c.isComplete !== false)
    .map((c: any) => ({
      time: c.time,
      open: qfloat(c.open),
      high: qfloat(c.high),
      low: qfloat(c.low),
      close: qfloat(c.close),
      volume: Number(c.volume || 0),
    }));
}

export async function getSandboxAccounts() {
  const data: any = await post('SandboxService', 'GetSandboxAccounts', { status: 'ACCOUNT_STATUS_OPEN' });
  return data.accounts || [];
}

export async function ensureSandboxAccount() {
  const configured = process.env.TINVEST_SANDBOX_ACCOUNT_ID?.trim();
  if (configured) return configured;

  const accounts = await getSandboxAccounts();
  if (accounts.length) return accounts[0].id as string;

  if (process.env.AUTO_CREATE_SANDBOX_ACCOUNT !== 'true') {
    throw new Error('No sandbox account and AUTO_CREATE_SANDBOX_ACCOUNT is not true');
  }
  const opened: any = await post('SandboxService', 'OpenSandboxAccount', { name: 'ChatGPT Sandbox Agent' });
  const accountId = opened.accountId as string;
  const startRub = Number(process.env.SANDBOX_START_RUB || 1_000_000);
  await post('SandboxService', 'SandboxPayIn', {
    accountId,
    amount: { currency: 'rub', ...quotation(startRub) },
  });
  return accountId;
}

export async function getPortfolio(accountId: string) {
  return post<any>('SandboxService', 'GetSandboxPortfolio', { accountId, currency: 'RUB' });
}

export async function getOperationsToday(accountId: string) {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const data: any = await post('SandboxService', 'GetSandboxOperations', {
    accountId,
    from: from.toISOString(),
    to: now.toISOString(),
    state: 'OPERATION_STATE_EXECUTED',
  });
  return data.operations || [];
}

export async function getActiveOrders(accountId: string) {
  const data: any = await post('SandboxService', 'GetSandboxOrders', { accountId });
  return data.orders || [];
}

export async function getActiveStops(accountId: string) {
  const data: any = await post('SandboxService', 'GetSandboxStopOrders', {
    accountId,
    status: 'STOP_ORDER_STATUS_ACTIVE',
  });
  return data.stopOrders || [];
}

export async function postMarketOrder(accountId: string, instrumentId: string, lots: number, side: 'BUY' | 'SELL') {
  assertAllowedInstrument(instrumentId);
  if (!Number.isInteger(lots) || lots <= 0) throw new Error('lots must be a positive integer');
  return post<any>('SandboxService', 'PostSandboxOrder', {
    quantity: String(lots),
    direction: side === 'BUY' ? 'ORDER_DIRECTION_BUY' : 'ORDER_DIRECTION_SELL',
    accountId,
    orderType: 'ORDER_TYPE_MARKET',
    orderId: crypto.randomUUID(),
    instrumentId,
    timeInForce: 'TIME_IN_FORCE_DAY',
    priceType: 'PRICE_TYPE_CURRENCY',
    confirmMarginTrade: false,
  });
}

async function postProtectiveStop(accountId: string, instrumentId: string, lots: number, price: number, type: 'STOP_ORDER_TYPE_STOP_LOSS' | 'STOP_ORDER_TYPE_TAKE_PROFIT') {
  const body: Record<string, unknown> = {
    quantity: String(lots),
    stopPrice: quotation(price),
    direction: 'STOP_ORDER_DIRECTION_SELL',
    accountId,
    expirationType: 'STOP_ORDER_EXPIRATION_TYPE_GOOD_TILL_CANCEL',
    stopOrderType: type,
    instrumentId,
    exchangeOrderType: 'EXCHANGE_ORDER_TYPE_MARKET',
    priceType: 'PRICE_TYPE_CURRENCY',
    orderId: crypto.randomUUID(),
    confirmMarginTrade: false,
  };
  if (type === 'STOP_ORDER_TYPE_TAKE_PROFIT') body.takeProfitType = 'TAKE_PROFIT_TYPE_REGULAR';
  return post<any>('SandboxService', 'PostSandboxStopOrder', body);
}

export async function postStopLoss(accountId: string, instrumentId: string, lots: number, stopPrice: number) {
  return postProtectiveStop(accountId, instrumentId, lots, stopPrice, 'STOP_ORDER_TYPE_STOP_LOSS');
}

export async function postTakeProfit(accountId: string, instrumentId: string, lots: number, targetPrice: number) {
  return postProtectiveStop(accountId, instrumentId, lots, targetPrice, 'STOP_ORDER_TYPE_TAKE_PROFIT');
}

export async function cancelStopOrder(accountId: string, stopOrderId: string) {
  return post<any>('SandboxService', 'CancelSandboxStopOrder', { accountId, stopOrderId });
}
