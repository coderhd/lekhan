export const FREE_ATTACHMENT_BYTES = 2_000_000
export const PAID_ATTACHMENT_BYTES = 50_000_000
export const attachmentPartBytes = 4 * 1024 * 1024

export interface CloudAttachment {
  id: string
  filename: string
  byte_count: number
}

export function attachmentName(value: string) {
  const name = value.trim()
  return name && Array.from(name).length <= 180 && !/[\u0000-\u001f\u007f/\\]/.test(name) ? name : null
}

export function attachmentPaths(page: string, id: string, bytes: number) {
  return Array.from({ length: Math.ceil(bytes / attachmentPartBytes) }, (_, index) =>
    `${page}/attachments/${id}/${index}.bin`)
}
