import { Marked } from 'marked'
import { parse, postprocess, preprocess } from 'micromark'
import { decodeString } from 'micromark-util-decode-string'
import { splitYamlFrontmatter } from '../lib/markdown'
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

function wikiAttachment(target: string, parent: string[], assets: Map<string, VaultAsset>) {
  if (!target || localTarget.test(target)) return
  const direct = assets.get(resolvePath(parent, target) ?? '') ?? assets.get(resolvePath([], target) ?? '')
  if (direct || target.includes('/') || !resolvePath([], target)) return direct
  const matches = [...assets.values()].filter(asset => filename(asset.path) === target)
  return matches.length === 1 ? matches[0] : undefined
}

function markdownAttachment(target: string, parent: string[], assets: Map<string, VaultAsset>) {
  if (!target || localTarget.test(target)) return
  try {
    const path = resolvePath(parent, decodeURIComponent(target))
    if (path) return assets.get(path)
  } catch {
    // A malformed percent escape is not a vault path.
  }
}

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
    add(wikiAttachment(target, parent, byPath), link.embed,
      link.alias && !/^\d+(?:x\d+)?$/.test(link.alias) ? link.alias : undefined)
  }

  lexer.walkTokens(lexer.lexer(markdown), token => {
    if (token.type !== 'image' && token.type !== 'link') return
    const target = token.href.split(/[?#]/, 1)[0]
    add(markdownAttachment(target, parent, byPath), token.type === 'image', token.text)
  })
  return [...found.values()]
}

function attachmentRelativePath(path: string, from: string) {
  const parts = path.split('/')
  const parent = directory(from)
  let shared = 0
  while (shared < parent.length && parts[shared] === parent[shared]) shared++
  return [...parent.slice(shared).map(() => '..'), ...parts.slice(shared).map(segment => encodeURIComponent(segment))].join('/')
}

export function attachmentMarkdown(path: string, from: string) {
  const relative = attachmentRelativePath(path, from)
  const label = filename(path).replace(/[\\[\]]/g, '\\$&')
  return (rasterFilename.test(path) ? '!' : '') + `[${label}](<${relative}>)`
}

export function rebaseAttachmentReferences(markdown: string, from: string, to: string, assets: Map<string, VaultAsset>) {
  const oldParent = directory(from)
  const newParent = directory(to)
  if (oldParent.join('/') === newParent.join('/') || !assets.size || !markdown.includes('[')) return markdown
  const frontmatter = splitYamlFrontmatter(markdown)
  const body = frontmatter?.body ?? markdown
  const bom = body.startsWith('\uFEFF') ? '\uFEFF' : ''
  const source = body.slice(bom.length)
  const events = postprocess(parse().document().write(preprocess()(source, undefined, true)))
  const changes: { start: number; end: number; value: string }[] = []
  const literalRanges: { start: number; end: number }[] = []
  for (const [action, token] of events) {
    if (action !== 'enter') continue
    const { start, end } = token
    if (['codeFenced', 'codeIndented', 'codeText', 'htmlFlow', 'htmlText', 'definition', 'resource'].includes(token.type)) {
      literalRanges.push({ start: start.offset, end: end.offset })
    }
    if (token.type !== 'resourceDestinationString' && token.type !== 'definitionDestinationString') continue
    const raw = source.slice(start.offset, end.offset)
    const decoded = decodeString(raw)
    const delimiter = decoded.search(/[?#]/)
    const target = delimiter < 0 ? decoded : decoded.slice(0, delimiter)
    if (target.startsWith('/')) continue
    const asset = markdownAttachment(target, oldParent, assets)
    if (!asset || markdownAttachment(target, newParent, assets)?.path === asset.path) continue
    const path = attachmentRelativePath(asset.path, to).replace(/[()]/g, character => character === '(' ? '%28' : '%29')
    // Keep the source spelling of a direct query or fragment, including encoded URLs.
    const rawDelimiter = raw.search(/[?#]/)
    const tail = delimiter < 0 ? '' : rawDelimiter >= 0 && decodeString(raw.slice(0, rawDelimiter)) === target
      ? raw.slice(rawDelimiter) : decoded.slice(delimiter)
    changes.push({ start: start.offset, end: end.offset, value: path + tail })
  }

  // Wiki syntax is outside CommonMark. Use the workspace's code-aware link scanner.
  let range = 0
  for (const link of wikiLinks(source, true)) {
    while (range < literalRanges.length && literalRanges[range].end <= link.start) range++
    const literal = literalRanges[range]
    if (literal && literal.start <= link.start && literal.end >= link.end) continue
    const target = link.target.split('#', 1)[0].trimEnd()
    if (target.startsWith('/')) continue
    const asset = wikiAttachment(target, oldParent, assets)
    if (!asset || wikiAttachment(target, newParent, assets)?.path === asset.path) continue
    const start = source.indexOf(target, link.start + (link.embed ? 3 : 2))
    changes.push({ start, end: start + target.length, value: '/' + asset.path })
  }

  let rewritten = ''
  let position = 0
  for (const { start, end, value } of changes.sort((first, second) => first.start - second.start)) {
    if (start < position) continue
    rewritten += source.slice(position, start) + value
    position = end
  }
  return (frontmatter?.raw ?? '') + bom + rewritten + source.slice(position)
}
