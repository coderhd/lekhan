import { Channel, invoke } from '@tauri-apps/api/core'
import { fromBase64 } from 'lib0/buffer'
import { ProviderTransportFailure, type ProviderTransport } from '../lib/ai/client'

type ProviderEvent = { type: 'head'; status: number } | { type: 'chunk'; data: string }

function remoteFailure(error: unknown): Error {
  if (error === 'invalid') return new ProviderTransportFailure('The provider request is too large or the desktop endpoint is invalid.')
  if (error === 'response_limit') return new ProviderTransportFailure('The provider response exceeded the size limit.')
  if (error === 'busy') return new ProviderTransportFailure('Wait for the current provider requests to finish.')
  if (error === 'timeout') return new Error('The provider did not respond in time.')
  if (error === 'cancelled') return new DOMException('The request was cancelled.', 'AbortError')
  return new Error('Could not reach the provider from the desktop app.')
}

export const desktopProviderTransport: ProviderTransport = async ({ signal, ...request }) => {
  signal.throwIfAborted()
  const requestId = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    let settled = false
    let opened = false
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({
      start(started) { controller = started },
      cancel() { stop() },
    })

    function finish(error?: Error) {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      if (opened) {
        if (error) controller.error(error)
        else controller.close()
      } else if (error) reject(error)
      else reject(new Error('The provider did not send a response.'))
    }

    function abort() {
      if (settled) return
      finish(signal.reason instanceof Error ? signal.reason : new DOMException('The request was cancelled.', 'AbortError'))
      void invoke('cancel_provider_request', { requestId }).catch(() => undefined)
    }

    function stop() {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      void invoke('cancel_provider_request', { requestId }).catch(() => undefined)
    }

    const output = new Channel<ProviderEvent>(event => {
      if (settled) return
      if (event.type === 'head') {
        const ok = event.status >= 200 && event.status < 300
        opened = ok
        resolve({ ok, status: event.status, body: ok ? body : null })
        if (!ok) {
          settled = true
          signal.removeEventListener('abort', abort)
        }
      } else if (opened) {
        controller.enqueue(fromBase64(event.data))
      }
    })
    signal.addEventListener('abort', abort, { once: true })
    void invoke('stream_provider_request', { requestId, request, output })
      .then(() => finish(), error => finish(remoteFailure(error)))
  })
}
