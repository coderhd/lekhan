import { Marked } from 'marked'
import { wikiLinks } from '../lib/markdown-references'
import type { VaultAsset } from './vault-storage'

const lexer = new Marked({ gfm: true })
const filename = (path: string) => path.split('/').at(-1) ?? ''
const directory = (path: string) => path.split('/').slice(0, -1)
const localTarget = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i
export const rasterFilename = /\.(?:png|jpe?g|gif|webp|bmp|avif|ico)$/i
export const maxAttachment = 50 * 1024 * 1024

function resolvePath(parts: string[], target: string) {
  if (localTarget.test(target) || /[\\:\u0000-\u001f]/.test(target)) return
  const result = target.startsWith('/') ? [] : [...parts]
  for (const step of target.split('/')) {
    if (!step || step === '.') continue
    if (step === '..') {
      if (!result.length) return
      result.pop()
    } else {
      if (step.startsWith('.')) return
      result.push(step)
    }
  }
  return result.join('/')
}

export type VaultAttachment = VaultAsset & { preview: boolean; label: string }

export function referencedAttachments(markdown: string, from: string, assets: VaultAsset[]) {
  const byPath = new Map(assets.map(asset => [asset.path, asset]))
  const found = new Map<string, VaultAttachment>()
  const parent = directory(from)

  function add(asset: VaultAsset | undefined, embedded: boolean, label?: string) {
    if (!asset) return
    const previous = found.get(asset.path)
    if (previous && (!embedded || previous.preview)) return
    found.set(asset.path, { ...asset, preview: embedded && rasterFilename.test(asset.path), label: label || filename(asset.path) })
  }

  for (const link of wikiLinks(markdown, true)) {
    const target = link.target.split('#', 1)[0].trim()
    if (!target || localTarget.test(target)) continue
    const direct = byPath.get(resolvePath(parent, target) ?? '') ??
      byPath.get(resolvePath([], target) ?? '')
    const matches = !direct && !target.includes('/') && resolvePath([], target) ? assets.filter(asset => filename(asset.path) === target) : []
    add(direct ?? (matches.length === 1 ? matches[0] : undefined), link.embed,
      link.alias && !/^\d+(?:x\d+)?$/.test(link.alias) ? link.alias : undefined)
  }

  lexer.walkTokens(lexer.lexer(markdown), token => {
    if (token.type !== 'image' && token.type !== 'link') return
    const target = token.href.split(/[?#]/, 1)[0]
    if (!target || localTarget.test(target)) return
    try {
      const path = resolvePath(parent, decodeURIComponent(target))
      if (path) add(byPath.get(path), token.type === 'image', token.text)
    } catch {
      // A malformed percent escape is not a vault path.
    }
  })
  return [...found.values()]
}

export function attachmentMarkdown(path: string, from: string) {
  const parts = path.split('/')
  const parent = directory(from)
  let shared = 0
  while (shared < parent.length && parts[shared] === parent[shared]) shared++
  const relative = [...parent.slice(shared).map(() => '..'), ...parts.slice(shared).map(segment => encodeURIComponent(segment))].join('/')
  const label = filename(path).replace(/[\\[\]]/g, '\\$&')
  return (rasterFilename.test(path) ? '!' : '') + `[${label}](<${relative}>)`
}
