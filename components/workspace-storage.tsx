import { getLocale, getTranslations } from 'next-intl/server'
import { Heading } from '@astryxdesign/core/Heading'
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { HStack, VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'

const megabyte = 1_000_000
const freeGuide = 30 * megabyte
const paidLimit = 10_000 * megabyte
function formatBytes(bytes: number, decimal: Intl.NumberFormat) {
  if (bytes === 0) return decimal.format(0) + ' MB'
  if (bytes < 1000) return `${decimal.format(bytes)} B`
  if (bytes < megabyte) return `${decimal.format(bytes / 1000)} KB`
  if (bytes < 1000 * megabyte) return `${decimal.format(bytes / megabyte)} MB`
  return `${decimal.format(bytes / (1000 * megabyte))} GB`
}

export default async function WorkspaceStorage({ images, files, free }: { images: number; files: number; free: boolean }) {
  const [t, locale] = await Promise.all([getTranslations('billing'), getLocale()])
  const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  const used = images + files
  const capacity = free ? freeGuide : paidLimit
  const fill = Math.min(100, Math.round(used / capacity * 100))
  const guidance = t(free ? 'storageGuide' : 'storageLimit', { size: formatBytes(capacity, decimal) })
  const usage = t('storageUsed', { size: formatBytes(used, decimal) })
  return (
    <section className="billing-storage" aria-labelledby="workspace-storage">
      <VStack gap={3}>
        <Heading level={2} id="workspace-storage">{t('workspaceStorage')}</Heading>
        <HStack justify="between" align="center" wrap="wrap" gap={2} className="billing-storage-line">
          <Text weight="semibold">{usage}</Text>
          <Text type="supporting" color="secondary">{guidance}</Text>
        </HStack>
        <ProgressBar label={t('workspaceStorage')} isLabelHidden value={fill} max={100} />
        <MetadataList columns="multi">
          <MetadataListItem label={t('inlineImages')}>{formatBytes(images, decimal)}</MetadataListItem>
          <MetadataListItem label={t('fileAttachments')}>{formatBytes(files, decimal)}</MetadataListItem>
        </MetadataList>
        {free && <Text type="supporting" color="secondary">{t('freeStorageNote')}</Text>}
      </VStack>
    </section>
  )
}
