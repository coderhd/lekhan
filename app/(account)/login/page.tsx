import AccountScreen from '@/components/account-screen'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; invite?: string; ref?: string }> }) {
  const { error, invite, ref } = await searchParams
  return <AccountScreen mode="login" notice={error} invite={invite} referral={ref} />
}
