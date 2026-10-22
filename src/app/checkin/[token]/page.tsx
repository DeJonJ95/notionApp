import { CheckInForm } from '@/components/events/CheckInForm';

export const dynamic = 'force-dynamic';

export default async function CheckInPage(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  return <CheckInForm token={params.token} />;
}
