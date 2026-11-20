import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AuthRetryableFetchError, AuthSessionMissingError, type AuthChangeEvent } from '@supabase/supabase-js'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '@/app/settings/page'
import { SettingsProvider, useOpenSettings } from '@/components/settings/settings-provider'

const { getUser, onAuthStateChange, unsubscribe, fetchOwnedPagesWithMembers, replace } = vi.hoisted(() => ({
	getUser: vi.fn(),
	onAuthStateChange: vi.fn(),
	unsubscribe: vi.fn(),
	fetchOwnedPagesWithMembers: vi.fn(),
	replace: vi.fn(),
}))
const router = { replace }
const maya = { id: 'maya', email: 'maya@example.test' }
const ari = { id: 'ari', email: 'ari@example.test' }
const ren = { id: 'ren', email: 'ren@example.test' }
type TestUser = typeof maya
type Session = { user: TestUser } | null
let authChange: (event: AuthChangeEvent, session: Session) => void

vi.mock('next/navigation', () => ({
	useRouter: () => router,
	usePathname: () => window.location.pathname,
	useSearchParams: () => new URLSearchParams(window.location.search),
}))
vi.mock('@/app/page', () => ({ default: () => <main>Workspace</main> }))
vi.mock('@/components/session-reauth-provider', () => ({ useSessionReauth: () => ({ isLocked: false }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser, onAuthStateChange } } }))
vi.mock('@/services/graph', () => ({ fetchOwnedPagesWithMembers }))
vi.mock('@/components/settings-client', () => ({
	default: function AccountSettings({ user, pages }: { user: TestUser; pages: { title: string }[] }) {
		// Model the account-bound state SettingsClient keeps across renders.
		const [mountedUser] = useState(user.email)
		return <><p>{mountedUser}</p>{pages.map(page => <p key={page.title}>{page.title}</p>)}</>
	},
}))

function Editor() {
	const openSettings = useOpenSettings()
	return <main>
		<input aria-label="Draft" />
		<button onClick={() => openSettings()}>Open settings</button>
	</main>
}

function openEditorSettings() {
	render(<SettingsProvider><Editor /></SettingsProvider>)
	const draft = screen.getByRole('textbox', { name: 'Draft' })
	fireEvent.change(draft, { target: { value: 'Unsaved text' } })
	fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
	return draft
}

beforeEach(() => {
	vi.resetAllMocks()
	window.history.replaceState({}, '', '/page/draft')
	getUser.mockResolvedValue({ data: { user: maya }, error: null })
	fetchOwnedPagesWithMembers.mockImplementation(async (id: string) => [{ title: `${id} collaborators` }])
	onAuthStateChange.mockImplementation(callback => {
		authChange = callback
		return { data: { subscription: { unsubscribe } } }
	})
})

describe('Settings authentication', () => {
	it('uses the initial session to check the identity with a single verified lookup', async () => {
		let finishVerification!: (result: { data: { user: TestUser }; error: null }) => void
		getUser.mockReturnValueOnce(new Promise(resolve => { finishVerification = resolve }))
		openEditorSettings()
		await waitFor(() => expect(getUser).toHaveBeenCalledOnce())

		act(() => authChange('INITIAL_SESSION', { user: maya }))
		await act(async () => { finishVerification({ data: { user: maya }, error: null }) })
		expect(await screen.findByText(maya.email)).toBeInTheDocument()
		expect(getUser).toHaveBeenCalledOnce()
	})

	it('removes the previous account on same-path sign-out and unsubscribes on close', async () => {
		const draft = openEditorSettings()
		expect(await screen.findByText(maya.email)).toBeInTheDocument()
		expect(screen.getByText('maya collaborators')).toBeInTheDocument()

		act(() => authChange('SIGNED_OUT', null))
		expect(screen.queryByText(maya.email)).not.toBeInTheDocument()
		expect(screen.queryByText('maya collaborators')).not.toBeInTheDocument()
		expect(replace).not.toHaveBeenCalled()
		expect(draft).toHaveValue('Unsaved text')

		fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
		expect(unsubscribe).toHaveBeenCalledOnce()
	})

	it('remounts account state and discards a superseded collaborator load on the direct route', async () => {
		window.history.replaceState({}, '', '/settings?transfer=test')
		let finishAriLoad!: (pages: { title: string }[]) => void
		const ariPages = new Promise<{ title: string }[]>(resolve => { finishAriLoad = resolve })
		fetchOwnedPagesWithMembers.mockImplementationOnce(async () => [{ title: 'maya collaborators' }])
			.mockReturnValueOnce(ariPages)
		render(<SettingsPage />)
		expect(await screen.findByText(maya.email)).toBeInTheDocument()

		act(() => authChange('TOKEN_REFRESHED', { user: maya }))
		expect(screen.getByText(maya.email)).toBeInTheDocument()

		getUser.mockResolvedValueOnce({ data: { user: ari }, error: null })
		act(() => authChange('SIGNED_IN', { user: ari }))
		expect(screen.queryByText(maya.email)).not.toBeInTheDocument()
		await waitFor(() => expect(fetchOwnedPagesWithMembers).toHaveBeenCalledWith(ari.id))

		getUser.mockResolvedValueOnce({ data: { user: ren }, error: null })
		act(() => authChange('SIGNED_IN', { user: ren }))
		expect(await screen.findByText(ren.email)).toBeInTheDocument()
		await act(async () => { finishAriLoad([{ title: 'ari collaborators' }]) })
		expect(screen.queryByText(ari.email)).not.toBeInTheDocument()
		expect(screen.queryByText('ari collaborators')).not.toBeInTheDocument()
		expect(screen.getByText('ren collaborators')).toBeInTheDocument()

		act(() => authChange('SIGNED_OUT', null))
		expect(screen.queryByText(ren.email)).not.toBeInTheDocument()
		await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
	})

	it('redirects genuinely anonymous visitors to login on the direct route', async () => {
		window.history.replaceState({}, '', '/settings')
		getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() })
		render(<SettingsPage />)
		await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
	})

	it('keeps the editor draft when getUser resolves with a transient error', async () => {
		getUser.mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError('Service unavailable', 503) })
		const draft = openEditorSettings()
		await waitFor(() => expect(onAuthStateChange).toHaveBeenCalledOnce())
		act(() => authChange('INITIAL_SESSION', null))
		expect(await screen.findByRole('alert')).toHaveTextContent('Settings could not be loaded')
		expect(replace).not.toHaveBeenCalled()

		fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
		expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft)
		expect(draft).toHaveValue('Unsaved text')
	})
})
