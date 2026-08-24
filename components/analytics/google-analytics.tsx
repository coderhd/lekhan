'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { GA_MEASUREMENT_ID } from '@/lib/analytics'
import { isEditorPathname } from '@/lib/routes'

export function GoogleAnalytics() {
	const pathname = usePathname()

	// Gate analytics on editor routes to prevent document URL/ID leakage
	if (isEditorPathname(pathname)) {
		return null
	}

	return (
		<>
			<Script
				src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
				strategy='afterInteractive'
			/>
			<Script id='google-analytics' strategy='afterInteractive'>
				{`
					window.dataLayer = window.dataLayer || [];
					function gtag(){dataLayer.push(arguments);}
					gtag('js', new Date());

					gtag('config', '${GA_MEASUREMENT_ID}', {
						send_page_view: true
					});
				`}
			</Script>
		</>
	)
}
