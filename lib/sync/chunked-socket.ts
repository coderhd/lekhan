import {
  maxSyncFrameBytes, maxSyncMessageBytes, payloadLimitCloseCode,
  syncChunkBytes, syncChunkHeaderBytes, syncChunkMessage,
} from './wire.ts'

// y-websocket passes complete protocol messages to send. Leave its handshake,
// incoming messages, and ordinary small updates on the existing protocol.
export function chunkedSocket(Base: typeof WebSocket, writable: boolean) {
  return class extends Base {
    override send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (!(data instanceof Uint8Array) || data.byteLength <= maxSyncFrameBytes) {
        super.send(data)
        return
      }
      if (!writable) return
      if (data.byteLength > maxSyncMessageBytes) {
        this.close(payloadLimitCloseCode, 'Sync update is too large')
        return
      }
      for (let at = 0; at < data.byteLength; at += syncChunkBytes) {
        const bytes = data.subarray(at, at + syncChunkBytes)
        const chunk = new Uint8Array(syncChunkHeaderBytes + bytes.length)
        chunk[0] = syncChunkMessage
        new DataView(chunk.buffer).setUint32(1, data.byteLength)
        chunk.set(bytes, syncChunkHeaderBytes)
        super.send(chunk)
      }
    }
  }
}
