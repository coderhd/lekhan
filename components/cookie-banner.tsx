'use client'

import NextLink from 'next/link'
import { Cookie } from 'lucide-react'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Link } from '@astryxdesign/core/Link'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { setAnalyticsConsent } from '@/lib/analytics'
import { useTranslations } from '@/lib/i18n/client'
import { useAnalyticsConsentChoice } from './usage-analytics'

export default function CookieBanner() {
	const t = useTranslations('cookie-banner')
	const choice = useAnalyticsConsentChoice()

	if (choice !== null) return null

	return (
		<aside className="cookie-banner-anchor" aria-label={t('title')}>
			<Card padding={3} elevation="high">
				<VStack gap={2}>
					<HStack gap={2} align="center">
						<Cookie size={16} aria-hidden="true" />
						<Text weight="semibold" size="sm">{t('title')}</Text>
					</HStack>
					<Text size="sm" color="secondary">
						{t('description')}{' '}
						<Link as={NextLink} href="/privacy-policy" hasUnderline>{t('privacyPolicy')}</Link>
					</Text>
					<HStack gap={2} justify="end" wrap="wrap">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							label={t('decline')}
							onClick={() => setAnalyticsConsent(false)}
						/>
						<Button
							type="button"
							variant="primary"
							size="sm"
							label={t('accept')}
							onClick={() => setAnalyticsConsent(true)}
						/>
					</HStack>
				</VStack>
			</Card>
		</aside>
	)
}
