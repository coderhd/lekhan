import { escaped, proseRanges } from '../markdown-references.ts'

export type CloudImagePolicy = 'free' | 'paid'
export const FREE_IMAGE_BYTES = 500_000
export const PAID_IMAGE_BYTES = 20_000_000
export const FREE_IMAGE_EDGE = 1_600

export class CloudImageError extends Error {
  constructor(readonly code: 'imageTooLarge' | 'imageUnsupported' | 'imageUnreadable' | 'imageBrowserUnsupported' | 'imageFreeLimit') {
    super(code)
  }
}

export function* inlineCloudImages(markdown: string) {
  if (!/data:image\//i.test(markdown)) return
  const token = /(`+)|data:image\/(?:png|jpeg|gif|webp|bmp|avif|x-icon);base64,[a-z0-9+/]+={0,2}/gi
  const code = /`+/g
  for (const range of proseRanges(markdown)) {
    const text = markdown.slice(range.start, range.end)
    token.lastIndex = 0
    for (let match = token.exec(text); match; match = token.exec(text)) {
      if (escaped(text, match.index)) continue
      if (match[1]) {
        code.lastIndex = token.lastIndex
        for (let end = code.exec(text); end; end = code.exec(text)) {
          if (end[0].length === match[1].length) {
            token.lastIndex = code.lastIndex
            break
          }
        }
      } else {
        yield { source: match[0], start: range.start + match.index, end: range.start + token.lastIndex }
      }
    }
  }
}

export function rasterByteLength(source: string) {
  const length = source.length - source.indexOf(',') - 1
  if (!length || length % 4 !== 0) return 0
  return Math.floor(length * 3 / 4) - (source.endsWith('==') ? 2 : source.endsWith('=') ? 1 : 0)
}

// Read the canvas from the RIFF header, or from a simple VP8/VP8L bitstream header.
// The renderer still decodes and verifies the bitstream.
function webpCanvas(source: string, length: number) {
  if (!source.toLowerCase().startsWith('data:image/webp;base64,') || length < 30) return null
  const start = source.indexOf(',') + 1
  const data = atob(source.slice(start, start + 40))
  const byte = (offset: number) => data.charCodeAt(offset)
  const little = (offset: number, width: number) => {
    let value = 0
    for (let index = 0; index < width; index++) value += byte(offset + index) * 256 ** index
    return value
  }
  if (data.slice(0, 4) !== 'RIFF' || data.slice(8, 12) !== 'WEBP' || little(4, 4) + 8 !== length) return null
  const chunk = little(16, 4)
  if (20 + chunk + (chunk % 2) > length) return null
  switch (data.slice(12, 16)) {
    case 'VP8X':
      return chunk === 10 ? [little(24, 3) + 1, little(27, 3) + 1] : null
    case 'VP8 ':
      if (chunk < 10 || byte(23) !== 0x9d || byte(24) !== 0x01 || byte(25) !== 0x2a) return null
      return [little(26, 2) & 0x3fff, little(28, 2) & 0x3fff]
    case 'VP8L':
      if (chunk < 5 || byte(20) !== 0x2f) return null
      return [(little(21, 4) & 0x3fff) + 1, ((little(21, 4) >>> 14) & 0x3fff) + 1]
    default:
      return null
  }
}

export function cloudImageAllowed(source: string, policy: CloudImagePolicy) {
  const bytes = rasterByteLength(source)
  if (policy === 'paid') return bytes > 0 && bytes <= PAID_IMAGE_BYTES
  if (bytes > FREE_IMAGE_BYTES || bytes <= 0) return false
  const canvas = webpCanvas(source, bytes)
  return !!canvas && canvas.every(edge => edge > 0 && edge <= FREE_IMAGE_EDGE)
}
