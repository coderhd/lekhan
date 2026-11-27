import type { Metadata } from 'next'
import '@fontsource-variable/manrope'
import '@fontsource-variable/newsreader'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_DOCS_URL || 'https://docs.lekhan.online'),
  title: { default: 'Lekhan Docs', template: '%s · Lekhan Docs' },
  description: 'Learn to write, link pages, import Markdown, share cloud pages, and choose an AI connection in Lekhan.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return <html lang="en" suppressHydrationWarning>
    <body className="flex min-h-screen flex-col antialiased">{children}</body>
  </html>
}
