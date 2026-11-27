import AccountScreen from '@/components/account-screen'

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string; ref?: string; next?: string }> }) {
  const { invite, ref, next } = await searchParams
  return <AccountScreen mode="signup" invite={invite} referral={ref} nextTarget={next} />
}
