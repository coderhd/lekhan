import { Channel, invoke } from '@tauri-apps/api/core'
import { fromBase64 } from 'lib0/buffer'
import { readChatStream, type ChatOptions } from '../lib/ai/client'

export type LocalModel = { id: string; label: string; bytes: number }
export type LocalLibrary = { runtimeAvailable: boolean; models: LocalModel[] }

export async function sendToLocalModel(id: string, chat: ChatOptions) {
  const signal = chat.signal ?? new AbortController().signal
  signal.throwIfAborted()
  const requestId = crypto.randomUUID()
  const stop = () => { void invoke('cancel_local_reply', { requestId }).catch(() => undefined) }
  let active = true
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const receive = new Channel<string>(chunk => {
        if (active) controller.enqueue(fromBase64(chunk))
      })
      void invoke('generate_local_reply', { id, requestId, messages: chat.messages, output: receive })
        .then(() => { if (active) controller.close() }, error => {
          if (active) controller.error(new Error(typeof error === 'string' ? error : 'The local model could not answer.'))
        })
    },
    cancel() {
      active = false
      stop()
    },
  })
  signal.addEventListener('abort', stop, { once: true })
  try {
    return await readChatStream(body, 'openai', signal, chat.onText)
  } finally {
    active = false
    signal.removeEventListener('abort', stop)
  }
}
