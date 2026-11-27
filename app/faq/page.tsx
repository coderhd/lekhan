import { ArrowUpRight } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { Collapsible, CollapsibleGroup } from '@astryxdesign/core/Collapsible'
import { Heading } from '@astryxdesign/core/Heading'
import { Link } from '@astryxdesign/core/Link'
import { VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { resolveLocale } from '@/lib/i18n/locales'
import MarketingFrame from '@/components/marketing-frame'
import { marketingMetadata } from '@/lib/marketing/metadata'
import { marketingLink } from '@/lib/marketing/routes'

export async function generateMetadata() {
  const t = await getTranslations('marketing')
  return marketingMetadata('/faq', resolveLocale(await getLocale()), t('faq') + ' · Lekhan', t('faqIntro'))
}

export default async function FaqPage() {
  const [t, language] = await Promise.all([getTranslations('marketing'), getLocale()])
  const locale = resolveLocale(language)
  return (
    <MarketingFrame path="/faq">
      <section className="marketing-faq marketing-width" aria-labelledby="faq-title">
        <VStack gap={6}>
          <VStack gap={3} maxWidth={680} className="marketing-lead" data-enter>
            <Heading level={1} id="faq-title" type="display-2">{t('faqTitle')}</Heading>
            <Text size="lg" color="secondary">{t('faqIntro')}</Text>
            <Link href={marketingLink('/contact', locale)}>
              {t('contact')} <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </VStack>
          <CollapsibleGroup defaultValue="transfer" className="marketing-questions">
            {(['transfer', 'storage', 'sharing', 'provider', 'export'] as const).map(item => (
              <Collapsible key={item} id={item} value={item} trigger={<Text weight="semibold">{t(item + 'Question')}</Text>}>
                <Text color="secondary">{t(item + 'Answer')}</Text>
              </Collapsible>
            ))}
          </CollapsibleGroup>
        </VStack>
      </section>
    </MarketingFrame>
  )
}
