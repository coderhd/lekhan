import AccountScreen from '@/components/account-screen'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; invite?: string }> }) {
  const { error, invite } = await searchParams
  return <AccountScreen mode="login" notice={error} invite={invite} />
}
