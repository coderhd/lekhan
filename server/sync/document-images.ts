import * as Y from 'yjs'
import { inlineCloudImages, rasterByteLength } from '../../lib/cloud/image-policy.ts'
import { isEmbeddedRaster } from '../../lib/markdown.ts'

type ImageCounts = Map<string, number>
interface DocumentImages {
  source: ImageCounts
  rich: ImageCounts
}

function count(sources: Iterable<string>): ImageCounts {
  const counts: ImageCounts = new Map()
  for (const source of sources) counts.set(source, (counts.get(source) ?? 0) + 1)
  return counts
}

function* richImageSources(root: Y.XmlFragment) {
  for (const node of root.createTreeWalker(node => node instanceof Y.XmlElement && node.nodeName === 'image')) {
    const source = (node as Y.XmlElement).getAttribute('src')
    if (isEmbeddedRaster(source)) yield source
  }
}

function* markdownImageSources(root: Y.Text) {
  for (const image of inlineCloudImages(root.toString())) yield image.source
}

export function imageRoots(doc: Y.Doc) {
  return { source: doc.getText('source'), rich: doc.getXmlFragment('default') }
}

export function documentImages(
  roots: ReturnType<typeof imageRoots>, previous?: DocumentImages, changed?: ReadonlySet<unknown>,
): DocumentImages {
  return {
    source: previous && changed && !changed.has(roots.source)
      ? previous.source : count(markdownImageSources(roots.source)),
    rich: previous && changed && !changed.has(roots.rich)
      ? previous.rich : count(richImageSources(roots.rich)),
  }
}

export function* addedDocumentImages(previous: DocumentImages, next: DocumentImages) {
  if (previous.source === next.source && previous.rich === next.rich) return
  const seen = new Set<string>()
  for (const images of [next.source, next.rich]) {
    for (const source of images.keys()) {
      if (seen.has(source)) continue
      seen.add(source)
      const before = (previous.source.get(source) ?? 0) + (previous.rich.get(source) ?? 0)
      const after = (next.source.get(source) ?? 0) + (next.rich.get(source) ?? 0)
      if (after > before) yield source
    }
  }
}

export function documentImageBytes(images: DocumentImages) {
  let bytes = 0
  for (const counts of [images.source, images.rich]) {
    for (const [source, occurrences] of counts) bytes += rasterByteLength(source) * occurrences
  }
  return bytes
}
