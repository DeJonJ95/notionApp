import { auth } from '@/lib/auth';

export async function sessionUserId(): Promise<string | null> {
  const user = (await auth())?.user;
  return user && 'id' in user && typeof user.id === 'string' ? user.id : null;
}
