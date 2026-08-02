'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'

export function GoogleAnalytics() {
	const pathname = usePathname()

	// Gate analytics on /doc/* routes to prevent document URL/ID leakage
	if (pathname?.startsWith('/doc')) {
		return null
	}

	return (
		<>
			<Script
				src='https://www.googletagmanager.com/gtag/js?id=G-4TP8GGDRFC'
				strategy='afterInteractive'
			/>
			<Script id='google-analytics' strategy='afterInteractive'>
				{`
					window.dataLayer = window.dataLayer || [];
					function gtag(){dataLayer.push(arguments);}
					gtag('js', new Date());

					gtag('config', 'G-4TP8GGDRFC', {
						send_page_view: true
					});
				`}
			</Script>
		</>
	)
}
