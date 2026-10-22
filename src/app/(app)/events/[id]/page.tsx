import { EventDetail } from '@/components/events/EventDetail';

export const dynamic = 'force-dynamic';

export default async function EventPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <EventDetail id={params.id} />;
}
