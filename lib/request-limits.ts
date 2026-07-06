/**
 * Reads and JSON-parses a Request body while enforcing a hard byte cap.
 *
 * Why not just check the `content-length` header and then call
 * `request.json()`? Two reasons:
 *  1. `content-length` can be missing or wrong (e.g. chunked
 *     transfer-encoding), so it's not a reliable gate on its own.
 *  2. `request.json()` buffers the *entire* body into memory before you
 *     get a chance to reject it — which is exactly the OOM path we're
 *     trying to close. A malicious multi-hundred-MB payload would already
 *     be fully allocated by the time any length check ran.
 *
 * This reads the stream chunk by chunk and aborts the moment the running
 * total crosses maxBytes, so memory use is bounded by maxBytes regardless
 * of what the client claims or sends.
 */

export class PayloadTooLargeError extends Error {
	constructor(public readonly maxBytes: number) {
		super(`Request body exceeds maximum allowed size of ${maxBytes} bytes`)
		this.name = 'PayloadTooLargeError'
	}
}

export async function readJsonWithLimit<T = unknown>(
	request: Request,
	maxBytes: number
): Promise<T> {
	// Fast path: if the client sent an honest content-length that's already
	// over budget, reject before reading anything.
	const contentLength = request.headers.get('content-length')
	if (contentLength && Number(contentLength) > maxBytes) {
		throw new PayloadTooLargeError(maxBytes)
	}

	const body = request.body
	if (!body) {
		return {} as T
	}

	const reader = body.getReader()
	const chunks: Uint8Array[] = []
	let received = 0

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) {
				break
			}
			if (value) {
				received += value.byteLength
				if (received > maxBytes) {
					await reader.cancel()
					throw new PayloadTooLargeError(maxBytes)
				}
				chunks.push(value)
			}
		}
	} finally {
		reader.releaseLock?.()
	}

	if (received === 0) {
		return {} as T
	}

	const combined = new Uint8Array(received)
	let offset = 0
	for (const chunk of chunks) {
		combined.set(chunk, offset)
		offset += chunk.length
	}

	const text = new TextDecoder().decode(combined)
	if (!text.trim()) {
		return {} as T
	}

	return JSON.parse(text) as T
}
