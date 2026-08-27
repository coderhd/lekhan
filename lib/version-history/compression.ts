import { deflateSync, inflateSync } from 'fflate'

export async function compressSnapshot(payload: Uint8Array): Promise<Uint8Array> {
	return deflateSync(payload)
}

export async function decompressSnapshot(compressed: Uint8Array): Promise<Uint8Array> {
	return inflateSync(compressed)
}
