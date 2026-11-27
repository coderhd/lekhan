import { createHash, timingSafeEqual } from 'node:crypto'

const hash = (value: string) => createHash('sha256').update(value).digest()

export function authorizedCron(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  const authorization = request.headers.get('authorization')
  return Boolean(secret && authorization && timingSafeEqual(hash(authorization), hash('Bearer ' + secret)))
}
