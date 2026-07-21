import { MetadataRoute } from 'next'
 
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/doc/', '/settings/'],
    },
    sitemap: 'https://lekhan.online/sitemap.xml',
  }
}
