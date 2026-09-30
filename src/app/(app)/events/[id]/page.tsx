import { EventDetail } from '@/components/events/EventDetail';

export const dynamic = 'force-dynamic';

export default function EventPage({ params }: { params: { id: string } }) {
  return <EventDetail id={params.id} />;
}
