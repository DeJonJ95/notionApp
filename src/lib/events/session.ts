import { auth } from '@/lib/auth';

export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}
