export default function Home() {
  return (
    <main>
      <h1>T-Invest Sandbox MCP</h1>
      <p>Облачный шлюз для тестового торгового агента.</p>
      <ul>
        <li>Только T-Invest Sandbox.</li>
        <li>Боевой OrdersService в коде отсутствует.</li>
        <li>Торговля выключена по умолчанию.</li>
        <li>MCP endpoint: <code>/api/mcp</code></li>
        <li>Health endpoint: <code>/api/health</code></li>
      </ul>
    </main>
  );
}
