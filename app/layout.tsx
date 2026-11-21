import type { Metadata } from 'next'
import '@fontsource-variable/manrope'
import '@fontsource-variable/newsreader'
import './globals.css'

export const metadata: Metadata = {
  title: 'Lekhan — Workspace',
  description: 'Write, organize, and connect your pages in Lekhan.',
  icons: { icon: '/lekhan-icon.svg' },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
