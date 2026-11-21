import { Inflate, strFromU8 } from 'fflate'

export type VaultEntry = { path: string; data: Uint8Array }
export type VaultContents = { files: VaultEntry[]; directories: string[] }

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_BYTES = 100 * 1024 * 1024
const MAX_IMAGES = 1_000
const COMPRESSION_CHUNK_BYTES = 4 * 1024
const DISCARDED_DIRECTORIES = new Set(['.obsidian', '.trash', '__macosx'])
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i
const MARKDOWN_EXTENSION = /\.(md|markdown)$/i

function canonicalSegments(rawPath: string) {
  const path = rawPath.replaceAll('\\', '/')
  const segments = path.split('/')
  if (
    path.startsWith('/') ||
    /[\u0000-\u001f\u007f]/u.test(path) ||
    segments.includes('..')
  ) {
    throw new Error(`The vault contains an unsafe path: "${rawPath}".`)
  }

  const relative = segments.filter(segment => segment !== '' && segment !== '.')
  if (/^[a-z]:/i.test(relative[0] ?? '')) {
    throw new Error(`The vault contains an unsafe path: "${rawPath}".`)
  }

  return relative
}

function skipDirectory(segments: string[]) {
  return segments.some(segment => DISCARDED_DIRECTORIES.has(segment.toLowerCase()))
}

function isVaultFile(segments: string[]) {
  const name = segments.at(-1) ?? ''
  return !name.startsWith('.') &&
    !skipDirectory(segments.slice(0, -1)) &&
    (MARKDOWN_EXTENSION.test(name) || IMAGE_EXTENSION.test(name))
}

class VaultCollector {
  private readonly files = new Map<string, Uint8Array>()
  private readonly directories = new Set<string>()
  private totalBytes = 0
  private imageCount = 0

  addDirectory(segments: string[]) {
    let path = ''
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment
      if (this.files.has(path)) throw new Error(`The vault contains a duplicate path: "${path}".`)
      this.directories.add(path)
    }
  }

  checkSize(path: string, bytes: number) {
    if (bytes > MAX_FILE_BYTES) {
      throw new Error(`"${path}" exceeds the 10 MB per-file limit.`)
    }
    if (this.totalBytes + bytes > MAX_TOTAL_BYTES) {
      throw new Error('The vault exceeds the 100 MB total unpacked size limit.')
    }
  }

  async addFile(segments: string[], size: number, read: (path: string) => Promise<Uint8Array>) {
    const path = segments.join('/')
    if (this.files.has(path) || this.directories.has(path)) {
      throw new Error(`The vault contains a duplicate path: "${path}".`)
    }
    const isImage = IMAGE_EXTENSION.test(path)
    if (isImage && this.imageCount >= MAX_IMAGES) {
      throw new Error('The vault exceeds the limit of 1,000 image attachments.')
    }

    this.checkSize(path, size)
    const data = await read(path)
    this.checkSize(path, data.byteLength)
    this.addDirectory(segments.slice(0, -1))
    this.files.set(path, data)
    this.totalBytes += data.byteLength
    if (isImage) this.imageCount += 1
  }

  contents(): VaultContents {
    return {
      files: Array.from(this.files, ([path, data]) => ({ path, data })),
      directories: [...this.directories],
    }
  }
}

function invalidZip() {
  return new Error('This file is an invalid ZIP archive.')
}

async function viewOf(blob: Blob, start: number, length: number) {
  const buffer = await blob.slice(start, start + length).arrayBuffer()
  if (buffer.byteLength !== length) throw invalidZip()
  return new DataView(buffer)
}

async function zipDirectory(zip: Blob) {
  const endOffset = Math.max(0, zip.size - (22 + 0xffff))
  const tail = await viewOf(zip, endOffset, zip.size - endOffset)
  for (let offset = tail.byteLength - 22; offset >= 0; offset -= 1) {
    if (tail.getUint32(offset, true) !== 0x06054b50 ||
      offset + 22 + tail.getUint16(offset + 20, true) !== tail.byteLength) continue

    const count = tail.getUint16(offset + 10, true)
    const start = tail.getUint32(offset + 16, true)
    const end = start + tail.getUint32(offset + 12, true)
    if (
      tail.getUint32(offset + 4, true) !== 0 ||
      tail.getUint16(offset + 8, true) !== count ||
      end !== endOffset + offset ||
      count * 46 > end - start
    ) throw invalidZip()

    return { count, start, end }
  }
  throw invalidZip()
}

// Use the central directory for compressed byte ranges, including entries
// written with data descriptors. Their unpacked sizes are only a preflight check.
export async function readVaultZip(zip: File): Promise<VaultContents> {
  const vault = new VaultCollector()
  const directory = await zipDirectory(zip)
  let offset = directory.start

  for (let idx = 0; idx < directory.count; idx += 1) {
    if (offset + 46 > directory.end) throw invalidZip()
    const header = await viewOf(zip, offset, 46)
    if (header.getUint32(0, true) !== 0x02014b50) throw invalidZip()

    const flags = header.getUint16(8, true)
    const method = header.getUint16(10, true)
    const compressedSize = header.getUint32(20, true)
    const size = header.getUint32(24, true)
    const nameSize = header.getUint16(28, true)
    const nameOffset = offset + 46
    const localOffset = header.getUint32(42, true)
    offset = nameOffset + nameSize + header.getUint16(30, true) + header.getUint16(32, true)
    if (offset > directory.end || header.getUint16(34, true) !== 0 || nameSize === 0) {
      throw invalidZip()
    }

    const nameBytes = new Uint8Array((await viewOf(zip, nameOffset, nameSize)).buffer)
    let name: string
    try {
      name = strFromU8(nameBytes, (flags & 0x800) === 0)
    } catch {
      throw invalidZip()
    }
    const segments = canonicalSegments(name)

    if (name.endsWith('/') || name.endsWith('\\')) {
      if (!skipDirectory(segments)) vault.addDirectory(segments)
    } else if (isVaultFile(segments)) {
      await vault.addFile(segments, size, async path => {
        if (flags & 1) throw new Error('The vault contains an encrypted ZIP entry.')
        if (method !== 0 && method !== 8) {
          throw new Error('The ZIP archive uses an unsupported compression method.')
        }

        if (localOffset + 30 > directory.start) throw invalidZip()
        const local = await viewOf(zip, localOffset, 30)
        const dataOffset = localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true)
        if (local.getUint32(0, true) !== 0x04034b50 ||
          local.getUint16(6, true) !== flags ||
          local.getUint16(8, true) !== method ||
          dataOffset + compressedSize > directory.start) throw invalidZip()

        if (method === 0) {
          vault.checkSize(path, compressedSize)
          if (compressedSize !== size) throw invalidZip()
          return new Uint8Array((await viewOf(zip, dataOffset, compressedSize)).buffer)
        }

        let expanded = 0
        const chunks: Uint8Array[] = []
        const inflater = new Inflate(chunk => {
          expanded += chunk.byteLength
          vault.checkSize(path, expanded)
          chunks.push(chunk)
        })

        // Feed small compressed slices so even highly compressible entries
        // cannot allocate their full output before the byte limit is checked.
        const end = dataOffset + compressedSize
        for (let ptr = dataOffset; ptr < end;) {
          const length = Math.min(COMPRESSION_CHUNK_BYTES, end - ptr)
          const chunk = new Uint8Array((await viewOf(zip, ptr, length)).buffer)
          ptr += length
          inflater.push(chunk, ptr === end)
        }
        if (expanded !== size) throw invalidZip()

        const bytes = new Uint8Array(expanded)
        let ptr = 0
        for (const chunk of chunks) {
          bytes.set(chunk, ptr)
          ptr += chunk.byteLength
        }
        return bytes
      })
    }
  }

  if (offset !== directory.end) throw invalidZip()
  return vault.contents()
}

export async function readVaultFiles(files: File[]): Promise<VaultContents> {
  const vault = new VaultCollector()
  for (const file of files) {
    const relativePath = file.webkitRelativePath
    const segments = canonicalSegments(relativePath || file.name).slice(relativePath ? 1 : 0)
    if (isVaultFile(segments)) {
      await vault.addFile(segments, file.size, async () => new Uint8Array(await file.arrayBuffer()))
    }
  }

  return vault.contents()
}

type FileHandle = { kind: 'file'; name: string; getFile(): Promise<File> }
type DirectoryHandle = {
  kind: 'directory'
  name: string
  values(): AsyncIterable<DirectoryHandle | FileHandle>
}

/** Returns null when the browser needs the webkitdirectory fallback. */
export async function pickVaultFolder(): Promise<VaultContents | null> {
  if (typeof window === 'undefined' || !window.isSecureContext) return null
  const picker = (window as Window & {
    showDirectoryPicker?: () => Promise<DirectoryHandle>
  }).showDirectoryPicker
  if (!picker) return null

  const root = await picker.call(window)
  const vault = new VaultCollector()

  async function visit(directory: DirectoryHandle, parent: string[]) {
    for await (const handle of directory.values()) {
      const relative = canonicalSegments(handle.name)
      const segments = [...parent, ...relative]
      if (handle.kind === 'directory' && !skipDirectory(segments)) {
        vault.addDirectory(segments)
        await visit(handle, segments)
      } else if (handle.kind === 'file' && isVaultFile(segments)) {
        const file = await handle.getFile()
        await vault.addFile(segments, file.size, async () => new Uint8Array(await file.arrayBuffer()))
      }
    }
  }

  await visit(root, [])
  return vault.contents()
}
