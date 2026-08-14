import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Flare Studio',
  description: 'Your Crypto. Your Policy.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Inter, self-hostable later. Loaded here so the type scale is right
            from the first paint -- a font swap mid-demo is very visible. */}
        <link rel="preconnect" href="https://rsms.me/" />
        <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
      </head>
      <body>{children}</body>
    </html>
  )
}
