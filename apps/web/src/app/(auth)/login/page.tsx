import { loginErrorCodeSchema } from '@roller-bay/shared/auth';
import { LoginScreen } from '@/features/auth/login-screen';
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const parsed = loginErrorCodeSchema.safeParse(error);
  return (
    <LoginScreen
      loginError={
        parsed.success
          ? parsed.data
          : error !== undefined
            ? 'sign_in_failed'
            : undefined
      }
    />
  );
}
