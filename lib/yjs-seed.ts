// Facade over lib/markdown/engine.ts — Page-only.
// New code should import from @/lib/markdown/engine directly.
// `Document` legacy type is gone; Page is the vocabulary.

import type { JSONContent } from '@tiptap/core'
import { markdownEngine } from '@/lib/markdown/engine'

export function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = ''
	const chunkSize = 0x8000
	for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
	return btoa(binary)
}

export function base64ToUint8Array(b64: string): Uint8Array {
	const binary = atob(b64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes
}

export function contentToYjsBase64(content: JSONContent): string {
	return markdownEngine.seedToYjsBase64(content)
}

export function contentToPlainText(content: JSONContent): string {
	return markdownEngine.plainText(content)
}
