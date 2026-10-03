export const metadata = {
  title: 'T-Invest Sandbox MCP',
  description: 'Sandbox-only bridge for a ChatGPT trading agent',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 760, margin: '40px auto', padding: 20 }}>
        {children}
      </body>
    </html>
  );
}
