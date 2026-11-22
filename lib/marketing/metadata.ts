import type { Metadata } from 'next'
import { siteOrigin } from '@/lib/auth/config'

export function marketingMetadata(path: string, title: string, description: string): Metadata {
  const origin = siteOrigin()
  const canonical = origin ? new URL(path, origin).href : undefined
  return {
    title, description,
    alternates: canonical ? { canonical } : undefined,
    openGraph: { title, description, url: canonical, siteName: 'Lekhan' },
  }
}
