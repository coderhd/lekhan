// Facade over lib/markdown/engine.ts — Page-only.
// New code should import from @/lib/markdown/engine directly.
// Page is the vocabulary (Document is legacy migration shim, see CONTEXT.md).
// Tracking issue #115: see lib/markdown-io.ts — same facade exit plan.

import type { JSONContent } from '@tiptap/core'
import { markdownEngine } from '@/lib/markdown/engine'

export { uint8ArrayToBase64, base64ToUint8Array } from '@/lib/markdown/engine'

export function contentToYjsBase64(content: JSONContent): string {
	return markdownEngine.seedToYjsBase64(content)
}

export function contentToPlainText(content: JSONContent): string {
	return markdownEngine.plainText(content)
}
