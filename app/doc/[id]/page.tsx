import { notFound, redirect } from 'next/navigation'
import { uuidPattern } from '@/lib/cloud/graph'

export default async function LegacyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!uuidPattern.test(id)) notFound()
  redirect('/page/' + id)
}
