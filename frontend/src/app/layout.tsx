import './globals.css'

export const metadata = {
  title: 'Kalshi Trader',
  description: 'Trading Dashboard for Kalshi',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
