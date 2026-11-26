import { redirect } from 'next/navigation'
import AccountScreen from '@/components/account-screen'
import { accountSubject } from '@/lib/auth/server'

export default async function ResetPasswordPage() {
  if (!(await accountSubject())) redirect('/login?error=confirm')
  return <AccountScreen mode="reset" />
}
