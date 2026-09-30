import { CheckInForm } from '@/components/events/CheckInForm';

export const dynamic = 'force-dynamic';

export default function CheckInPage({ params }: { params: { token: string } }) {
  return <CheckInForm token={params.token} />;
}
