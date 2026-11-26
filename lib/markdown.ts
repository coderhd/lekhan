const leadingFence = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/
const yamlStart = /^\s*(?:#[^\n]*\n\s*)*(?:[^\s:]+[ \t]*:|["'][^"'\r\n]+["'][ \t]*:|[\[{]|-[ \t])/

export function hasYamlFrontmatter(markdown: string): boolean {
  return !!splitYamlFrontmatter(markdown)
}

export function splitYamlFrontmatter(markdown: string) {
  const match = leadingFence.exec(markdown)
  if (!match?.[1] || !yamlStart.test(match[1])) return null
  return { yaml: match[1], raw: match[0], body: markdown.slice(match[0].length) }
}

const embeddedRaster = /^data:image\/(?:png|jpeg|gif|webp|bmp|avif|x-icon);base64,[a-z0-9+/]+={0,2}$/i

export function isEmbeddedRaster(source: unknown): source is string {
  return typeof source === 'string' && embeddedRaster.test(source)
}
