'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Home from '../page'
import { SettingsDialog } from '@/components/settings/settings-provider'

function DirectSettings() {
	const params = useSearchParams()
	const router = useRouter()
	const tab = params.get('transfer') ? 'collaborators' : params.has('billing') ? 'billing' : 'profile'
	return <SettingsDialog key={params.toString()} tab={tab} onClose={() => router.replace('/')} redirectOnSignOut />
}

export default function SettingsPage() {
	return <><Home /><Suspense><DirectSettings /></Suspense></>
}
