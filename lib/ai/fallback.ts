import { ProviderHttpError, type ChatOptions, type streamChat } from './client'

export type ModelRoute = {
  id: string
  label: string
  send: (options: ChatOptions) => ReturnType<typeof streamChat>
}

export async function runFallback(primary: ModelRoute, fallback: readonly ModelRoute[], options: ChatOptions,
  onFallback?: (route: ModelRoute) => void) {
  const started = performance.now()
  const routes = [primary, ...new Map(fallback.filter(route => route.id !== primary.id).map(route => [route.id, route])).values()]
  let failure: unknown
  for (const route of routes) {
    options.signal?.throwIfAborted()
    if (route !== primary) onFallback?.(route)
    options.signal?.throwIfAborted()

    let emitted = false
    try {
      const result = await route.send({
        ...options,
        onText(part) {
          if (!part) return
          emitted = true
          options.onText?.(part)
        },
      })
      options.signal?.throwIfAborted()
      return { ...result, route, elapsedMs: Math.round(performance.now() - started) }
    } catch (error) {
      if (options.signal?.aborted || emitted || !(error instanceof ProviderHttpError) || ![429, 503].includes(error.status)) throw error
      failure = error
    }
  }
  throw failure
}
