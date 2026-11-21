const leadingFence = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/
const yamlStart = /^\s*(?:#[^\n]*\n\s*)*(?:[^\s:]+[ \t]*:|["'][^"'\r\n]+["'][ \t]*:|[\[{]|-[ \t])/

export function hasYamlFrontmatter(markdown: string): boolean {
  const metadata = leadingFence.exec(markdown)?.[1]
  return !!metadata && yamlStart.test(metadata)
}
