'use client'

import { Languages } from 'lucide-react'
import { useMemo, useState, useTransition } from 'react'
import { Selector } from '@astryxdesign/core/Selector'
import { VStack } from '@astryxdesign/core/Stack'
import { useLocale, useTranslations } from '@/lib/i18n/client'
import { localeNames, locales, resolveLocale, type Locale } from '@/lib/i18n/locales'

export default function LocaleSelect({ onSelect, fullWidth = true }: { onSelect: (locale: Locale) => Promise<void>; fullWidth?: boolean }) {
	const t = useTranslations('settings')
	const locale = useLocale()
	const [pending, startTransition] = useTransition()
	const [failure, setFailure] = useState(false)
	const options = useMemo(
		() => locales.map(language => ({ value: language, label: localeNames[language] })),
		[],
	)
	return (
		<VStack gap={1} width={fullWidth ? '100%' : 'auto'} className="locale-select-field">
			<Selector
				label={t('language')}
				isLabelHidden
				value={resolveLocale(locale)}
				options={options}
				isDisabled={pending}
				isLoading={pending}
				startIcon={<Languages size={15} aria-hidden="true" />}
				size="sm"
				variant="secondary"
				presentation="adaptive"
				width={fullWidth ? '100%' : undefined}
				onChange={value => {
					const selected = resolveLocale(value)
					setFailure(false)
					startTransition(async () => {
						try {
							await onSelect(selected)
						} catch {
							setFailure(true)
						}
					})
				}}
			/>
			{failure && <p className="locale-error" role="alert">{t('switchFailed')}</p>}
		</VStack>
	)
}
