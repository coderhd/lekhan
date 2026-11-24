import { cloudImageAllowed, FREE_IMAGE_BYTES, FREE_IMAGE_EDGE, inlineCloudImages, PAID_IMAGE_BYTES, type CloudImagePolicy } from './image-policy'
import { isEmbeddedRaster } from '../markdown'
import type { CloudImportBatch } from './import-plan'

export interface CloudImportImageContext {
  account?: string
  current: CloudImagePolicy
  batches: { index: number; policy: CloudImagePolicy | null }[]
}

function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Image encoding failed.'))
    reader.onerror = () => reject(reader.error ?? new Error('Image encoding failed.'))
    reader.readAsDataURL(blob)
  })
}

async function resizeForCloud(source: string) {
  const image = new Image()
  image.src = source
  await image.decode()

  let scale = Math.min(1, FREE_IMAGE_EDGE / Math.max(image.naturalHeight, image.naturalWidth))
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser could not prepare images for cloud storage.')

  try {
    // Prefer pixel detail before shrinking again. Keep alpha for screenshots.
    for (let pass = 0; pass < 4; pass++) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      for (const quality of [0.88, 0.75, 0.62]) {
        const encoded = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality))
        if (encoded?.type !== 'image/webp') throw new Error('This browser could not encode a WebP image.')
        if (encoded.size > FREE_IMAGE_BYTES) continue
        return dataUrl(encoded)
      }
      scale *= 0.72
    }
    throw new Error('An image could not fit the Free cloud limit.')
  } finally {
    canvas.width = 0
    canvas.height = 0
    image.removeAttribute('src')
  }
}

export async function prepareCloudImageFile(file: File, policy: CloudImagePolicy) {
  if (policy === 'paid' && file.size > PAID_IMAGE_BYTES) throw new Error('Cloud images can be up to 20 MB.')
  const source = await dataUrl(file)
  if (!isEmbeddedRaster(source)) throw new Error('Choose a supported raster image.')
  if (cloudImageAllowed(source, policy)) return source
  if (policy === 'paid') throw new Error('This image could not be read.')
  return resizeForCloud(source)
}

export async function prepareCloudImportImages(batches: CloudImportBatch[], settings: CloudImportImageContext) {
  const reservations = new Map(settings.batches.map(batch => [batch.index, batch]))
  const optimized = new Map<string, string>()
  const prepared: CloudImportBatch[] = []

  for (const batch of batches) {
    const reserved = reservations.get(batch.index)
    const policy = reserved ? reserved.policy : settings.current
    const pages = []
    for (const page of batch.pages) {
      let markdown = ''
      let cursor = 0
      for (const image of policy === 'free' ? inlineCloudImages(page.markdown) : []) {
        if (cloudImageAllowed(image.source, 'free')) continue
        let replacement = optimized.get(image.source)
        if (!replacement) {
          try {
            replacement = await resizeForCloud(image.source)
          } catch {
            throw new Error(`An image in “${page.title}” could not be prepared for Free cloud import. Try a smaller image or import the vault locally.`)
          }
          optimized.set(image.source, replacement)
        }
        markdown += page.markdown.slice(cursor, image.start) + replacement
        cursor = image.end
      }
      pages.push(cursor ? { ...page, markdown: markdown + page.markdown.slice(cursor) } : page)
    }
    prepared.push({ ...batch, imagePolicy: policy, pages })
  }
  return { batches: prepared, optimized: optimized.size }
}
