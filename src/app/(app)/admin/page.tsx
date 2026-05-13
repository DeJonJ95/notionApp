import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AdminDashboard } from '@/components/admin/AdminDashboard';

const ADMIN_EMAIL = 'dejonj95@gmail.com';

export default async function AdminPage() {
  const session = await auth();
  if ((session?.user as any)?.email !== ADMIN_EMAIL) redirect('/');

  return <AdminDashboard />;
}
