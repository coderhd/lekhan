import AccountScreen from '@/components/account-screen'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return <AccountScreen mode="login" notice={(await searchParams).error} />
}
