export const toTitleKey = (value: string) => value.trim().replace(/\s+/g, ' ').normalize('NFC').toLowerCase()

export function withoutEmbeddedImages(markdown: string) {
  return markdown.replace(/data:image\/[\w+.-]+;base64,[A-Za-z0-9+/=]+/g, '')
}

export function scanTags(raw: string, properties: Record<string, unknown> | null) {
  const propertyTags = properties?.tags
  const input = Array.isArray(propertyTags) ? propertyTags : typeof propertyTags === 'string' ? propertyTags.split(/[\s,]+/) : []
  const body = raw.replace(/^`{3,}[^\n]*\n[\s\S]*?^\x60{3,}[^\n]*$/gm, '').replace(/`[^`\n]+`/g, '')
  const tags = new Set<string>()
  for (const item of input.concat(Array.from(body.matchAll(/(?:^|[\s(,;])#([\p{L}\p{M}\p{N}_/-]+)/gu), match => match[1]))) {
    if (typeof item !== 'string') continue
    const tag = toTitleKey(item).replace(/^#/, '')
    if (/^[\p{L}\p{M}\p{N}_/-]{1,125}$/u.test(tag) && !/^\p{N}+$/u.test(tag)) tags.add(tag)
  }
  return [...tags]
}

export function importPathKey(path: string) {
  return path.split('/').map(toTitleKey).filter(Boolean).join('/')
}
