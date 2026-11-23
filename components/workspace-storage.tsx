const megabyte = 1_000_000
const freeGuide = 30 * megabyte
const paidLimit = 10_000 * megabyte
const decimal = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 MB'
  if (bytes < 1000) return `${bytes} B`
  if (bytes < megabyte) return `${decimal.format(bytes / 1000)} KB`
  if (bytes < 1000 * megabyte) return `${decimal.format(bytes / megabyte)} MB`
  return `${decimal.format(bytes / (1000 * megabyte))} GB`
}

export default function WorkspaceStorage({ images, files, free }: { images: number; files: number; free: boolean }) {
  const used = images + files
  const capacity = free ? freeGuide : paidLimit
  const fill = Math.min(100, Math.round(used / capacity * 100))
  const guidance = free ? `${formatBytes(capacity)} guide` : `${formatBytes(capacity)} limit`
  return <section className="billing-storage" aria-labelledby="workspace-storage">
    <h2 id="workspace-storage">Workspace storage</h2>
    <div className="billing-storage-line"><strong>{formatBytes(used)} used</strong><span>{guidance}</span></div>
    <div className="billing-storage-meter" role="meter" aria-labelledby="workspace-storage" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={fill} aria-valuetext={`${formatBytes(used)} used, ${guidance}`}>
      <span style={{ width: `${fill}%` }} />
    </div>
    <dl className="billing-storage-breakdown">
      <div><dt>Inline images</dt><dd>{formatBytes(images)}</dd></div>
      <div><dt>File attachments</dt><dd>{formatBytes(files)}</dd></div>
    </dl>
    {free && <p>The 30 MB guide is for planning. Your per-file limits still apply.</p>}
  </section>
}
