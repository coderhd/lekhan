const headers = { 'Cache-Control': 'private, no-store' }

export async function GET() {
  return Response.json({ ok: true, service: 'app' }, { status: 200, headers })
}

export async function HEAD() {
  return new Response(null, { status: 200, headers })
}
