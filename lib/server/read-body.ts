export async function readBoundedBody(request: Request, limit: number) {
  const reader = request.body?.getReader()
  if (!reader || Number(request.headers.get('content-length')) > limit) return null
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, length)
}
