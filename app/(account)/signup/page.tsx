import AccountScreen from '@/components/account-screen'

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  return <AccountScreen mode="signup" invite={(await searchParams).invite} />
}
