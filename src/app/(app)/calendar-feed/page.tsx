import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { CalendarFeedSettings } from '@/components/calendar/CalendarFeedSettings';

export default async function CalendarFeedPage() {
  const session = await auth();
  if (!(session?.user as any)?.id) redirect('/signin');
  return <CalendarFeedSettings />;
}
