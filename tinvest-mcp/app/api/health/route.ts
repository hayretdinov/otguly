export const runtime = 'nodejs';

export async function GET() {
  return Response.json({
    ok: true,
    service: 'tinvest-sandbox-mcp',
    sandboxOnly: true,
    tradingEnabled: process.env.TRADING_ENABLED === 'true',
    killSwitch: process.env.KILL_SWITCH === 'true',
    tokenConfigured: Boolean(process.env.TINVEST_SANDBOX_TOKEN),
    mcpAuthConfigured: Boolean(process.env.MCP_ACCESS_TOKEN),
  }, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
