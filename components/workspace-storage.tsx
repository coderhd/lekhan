import { getLocale, getTranslations } from 'next-intl/server'

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
  return <section className="billing-storage" aria-labelledby="workspace-storage">
    <h2 id="workspace-storage">{t('workspaceStorage')}</h2>
    <div className="billing-storage-line"><strong>{usage}</strong><span>{guidance}</span></div>
    <div className="billing-storage-meter" role="meter" aria-labelledby="workspace-storage" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={fill} aria-valuetext={`${usage}, ${guidance}`}>
      <span style={{ width: `${fill}%` }} />
    </div>
    <dl className="billing-storage-breakdown">
      <div><dt>{t('inlineImages')}</dt><dd>{formatBytes(images, decimal)}</dd></div>
      <div><dt>{t('fileAttachments')}</dt><dd>{formatBytes(files, decimal)}</dd></div>
    </dl>
    {free && <p>{t('freeStorageNote')}</p>}
  </section>
}
