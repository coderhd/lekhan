import { createServer } from 'node:http'
import { createSign, createVerify, generateKeyPairSync } from 'node:crypto'

const host = '127.0.0.1'
const port = Number(process.env.E2E_AUTH_PORT || 3183)
const origin = `http://${host}:${port}`
const keyId = 'lekhan-e2e-key'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const publicJwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: keyId,
  alg: 'ES256',
  use: 'sig',
  key_ops: ['verify'],
}

function encodePart(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function signToken(claims) {
  const header = encodePart({ alg: 'ES256', typ: 'JWT', kid: keyId })
  const payload = encodePart(claims)
  const input = `${header}.${payload}`
  const signature = createSign('SHA256').update(input).sign({ key: privateKey, dsaEncoding: 'ieee-p1363' })
  return `${input}.${signature.toString('base64url')}`
}

function verifyToken(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, signature] = parts
  const verifier = createVerify('SHA256')
  verifier.update(`${header}.${payload}`)
  const valid = verifier.verify(
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signature, 'base64url'),
  )
  if (!valid) return null
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  if (typeof claims.exp === 'number' && claims.exp <= Math.floor(Date.now() / 1000)) return null
  return claims
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = Buffer.concat(chunks).toString('utf8')
  return body ? JSON.parse(body) : {}
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', origin)
  if (request.method === 'GET' && url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
    return
  }
  if (request.method === 'GET' && url.pathname === '/auth/v1/.well-known/jwks.json') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [publicJwk] }))
    return
  }
  if (request.method === 'GET' && url.pathname === '/auth/v1/user') {
    const auth = request.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const claims = token ? verifyToken(token) : null
    if (!claims) {
      response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ message: 'Invalid JWT' }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      id: claims.sub,
      aud: claims.aud,
      role: claims.role,
      email: claims.email,
      user_metadata: claims.user_metadata ?? {},
    }))
    return
  }
  if (request.method === 'POST' && url.pathname === '/auth/v1/logout') {
    response.writeHead(204).end()
    return
  }
  if (request.method === 'GET' && url.pathname === '/rest/v1/workspaces') {
    response.writeHead(200, { 'content-type': 'application/json' }).end('[]')
    return
  }
  if (request.method === 'POST' && url.pathname === '/test/token') {
    const body = await readJson(request)
    const now = Math.floor(Date.now() / 1000)
    const subject = typeof body.subject === 'string' && body.subject ? body.subject : '4dbc5892-753d-4be6-9d78-faaeb9bbd2d7'
    const email = typeof body.email === 'string' && body.email ? body.email : 'writer@lekhan.test'
    const displayName = typeof body.displayName === 'string' ? body.displayName : 'Lekhan Writer'
    const access_token = signToken({
      iss: `${origin}/auth/v1`,
      sub: subject,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      user_metadata: { full_name: displayName },
      iat: now,
      exp: now + 3600,
    })
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token }))
    return
  }
  response.writeHead(404).end()
})

server.listen(port, host)
