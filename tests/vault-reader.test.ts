import { strToU8, zipSync } from "fflate"
import { afterEach, describe, expect, it, vi } from "vitest"
import { pickVaultFolder, readVaultFiles, readVaultZip } from "../lib/vault-reader"

const MiB = 1024 * 1024

function archive(files: Record<string, Uint8Array>) {
  return new File([new Uint8Array(zipSync(files))], "vault.zip")
}

function selectedFile(path: string, bytes: string | Uint8Array) {
  const file = new File(
    [typeof bytes === "string" ? bytes : new Uint8Array(bytes)],
    path.split("/").at(-1)!,
  )
  Object.defineProperty(file, "webkitRelativePath", { value: path })
  return file
}

describe("vault ZIP reader", () => {
  it("preserves empty folders, parent chains and raw image bytes", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const result = await readVaultZip(archive({
      "Notes/2026/Intro.MARKDOWN": strToU8("# Hello"),
      "./Notes/media/photo.png": png,
      "Notes/Empty/Child/": new Uint8Array(),
      ".obsidian/config.md": strToU8("ignore"),
      "Notes/.trash/old.md": strToU8("ignore"),
      "Notes/roadmap.canvas": strToU8("ignore"),
      "Notes/video.mp4": new Uint8Array([42]),
    }))

    expect(result.files).toEqual([
      { path: "Notes/2026/Intro.MARKDOWN", data: strToU8("# Hello") },
      { path: "Notes/media/photo.png", data: png },
    ])
    expect(result.directories).toEqual([
      "Notes", "Notes/2026", "Notes/media", "Notes/Empty", "Notes/Empty/Child",
    ])
  })

  it.each(["../escape.md", "safe/../../escape.md", "/root.md", "C:\\root.md", "safe\\..\\escape.md"])(
    "rejects the unsafe path %s",
    async (path) => {
      await expect(readVaultZip(archive({ [path]: strToU8("note") }))).rejects.toThrow(/unsafe path/i)
    },
  )

  it("rejects duplicate canonical file paths", async () => {
    await expect(readVaultZip(archive({
      "Notes/Intro.md": strToU8("first"),
      "Notes/./Intro.md": strToU8("second"),
    }))).rejects.toThrow(/duplicate path/i)
  })

  it("rejects a truncated archive", async () => {
    const zip = archive({ "Intro.md": strToU8("note") })
    const truncated = new File([zip.slice(0, zip.size - 22)], "vault.zip")

    await expect(readVaultZip(truncated)).rejects.toThrow(/invalid ZIP/i)
  })

  it("rejects entries that exceed the per-file limit during decompression", async () => {
    const zip = zipSync({ "Huge.md": new Uint8Array(10 * MiB + 1) })
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    const centralDirectory = view.getUint32(zip.byteLength - 6, true)
    view.setUint32(22, 1, true)
    view.setUint32(centralDirectory + 24, 1, true)

    const file = new File([new Uint8Array(zip)], "vault.zip")
    await expect(readVaultZip(file)).rejects.toThrow(/per-file limit/i)
  })

  it("enforces the aggregate unpacked limit across files", { timeout: 15_000 }, async () => {
    const data = new Uint8Array(10 * MiB)
    const files = Object.fromEntries(Array.from({ length: 11 }, (_, idx) => [`Note ${idx}.md`, data]))

    await expect(readVaultZip(archive(files))).rejects.toThrow(/total unpacked size limit/i)
  })

  it("enforces the image count independently of their size", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 1001 }, (_, idx) => [`Image ${idx}.png`, new Uint8Array(0)]),
    )

    await expect(readVaultZip(archive(files))).rejects.toThrow(/image attachments/i)
  })
})

describe("vault folder reader", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("strips the selected root and keeps ordinary File names", async () => {
    const result = await readVaultFiles([
      selectedFile("Vault/Journals/Today.md", "# Today"),
      selectedFile("Vault/Journals/.obsidian/config.md", "ignore"),
      new File(["root"], "README.md"),
    ])

    expect(result.files).toEqual([
      { path: "Journals/Today.md", data: strToU8("# Today") },
      { path: "README.md", data: strToU8("root") },
    ])
    expect(result.directories).toEqual(["Journals"])
  })

  it("rejects unsafe paths before stripping the selected root", async () => {
    await expect(readVaultFiles([selectedFile("../Entry.md", "note")])).rejects.toThrow(/unsafe path/i)
  })

  it("collects empty directories exposed by the native picker", async () => {
    const empty = {
      kind: "directory",
      name: "Empty",
      async *values() {},
    }
    const note = {
      kind: "file",
      name: "Intro.md",
      async getFile() { return new File(["intro"], "Intro.md") },
    }
    vi.stubGlobal("window", {
      isSecureContext: true,
      async showDirectoryPicker() {
        return {
          async *values() {
            yield empty
            yield note
          },
        }
      },
    })

    await expect(pickVaultFolder()).resolves.toEqual({
      directories: ["Empty"],
      files: [{ path: "Intro.md", data: strToU8("intro") }],
    })
  })

  it("signals the fallback when the native picker is unavailable", async () => {
    vi.stubGlobal("window", { isSecureContext: true })

    await expect(pickVaultFolder()).resolves.toBeNull()
  })
})
