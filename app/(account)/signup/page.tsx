import AccountScreen from '@/components/account-screen'

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string; ref?: string }> }) {
  const { invite, ref } = await searchParams
  return <AccountScreen mode="signup" invite={invite} referral={ref} />
}
