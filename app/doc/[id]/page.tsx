import { redirect } from 'next/navigation'

export default async function DocumentPage({
	params: paramsPromise,
}: {
	params: Promise<{ id: string }>
}) {
	const params = await paramsPromise
	redirect(`/page/${params.id}`)
}
