import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ClipperSettings } from '@/components/clipper/ClipperSettings';

export default async function ClipperPage() {
  const session = await auth();
  if (!(session?.user as any)?.id) redirect('/signin');
  return <ClipperSettings />;
}
