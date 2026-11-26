import AccountScreen from '@/components/account-screen'

export const metadata = { referrer: 'no-referrer' }

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ error?: string; invite?: string; ref?: string; transfer?: string }>
}) {
  const { error, invite, ref, transfer } = await searchParams
  return <AccountScreen mode="login" notice={error} invite={invite} referral={ref} transfer={transfer} />
}
