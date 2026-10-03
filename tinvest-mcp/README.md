# T-Invest Sandbox MCP for ChatGPT

Remote MCP bridge intended for a ChatGPT trading agent. It is **sandbox-only**.

## Safety properties

- The only T-Invest API base URL in the code is `https://sandbox-invest-public-api.tbank.ru/rest/...`.
- No production `OrdersService/PostOrder` implementation exists.
- `TRADING_ENABLED=false` by default.
- `KILL_SWITCH=true` blocks new trade writes.
- Instruments are allowlisted by `ALLOWED_INSTRUMENTS`.
- Independent hard caps: per-trade risk, position count, trades/day, notional and cooldown.
- A protected buy immediately creates sandbox stop-loss and take-profit orders.
- If protection placement fails, the bridge attempts to cancel partial protection and emergency-close the sandbox position.
- MCP requests require a separate bearer token (`MCP_ACCESS_TOKEN`).
- T-Invest token is stored only in Vercel environment secrets, never in Git.

## MCP tools

- `get_status`
- `market_snapshot`
- `sandbox_portfolio`
- `execute_sandbox_buy`
- `close_sandbox_position`

## Required Vercel environment variables

Copy the keys from `.env.example` into Vercel Project Settings → Environment Variables.
Do **not** commit real tokens.

Keep `TRADING_ENABLED=false` until the health endpoint and read-only MCP tools are verified.

## Endpoints

- `/api/health` — public health check; never returns secret values.
- `/api/mcp` — authenticated Streamable HTTP MCP endpoint.
