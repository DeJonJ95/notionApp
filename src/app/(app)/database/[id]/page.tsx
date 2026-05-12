'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { DatabaseView } from '@/components/database/DatabaseView';

interface Database {
  id: string;
  name: string;
  workspaceId: string;
  properties: Property[];
  views: View[];
  pages: Page[];
}

interface Property {
  id: string;
  name: string;
  type: string;
  formula?: string;
}

interface View {
  id: string;
  name: string;
  type: string;
  filters?: any;
  sorts?: any;
}

interface Page {
  id: string;
  title: string;
  icon?: string;
  properties: PropertyValue[];
}

interface PropertyValue {
  property: Property;
  value: any;
}

export default function DatabasePage({ params }: { params: { id: string } }) {
  const { data: session } = useSession();
  const [database, setDatabase] = useState<Database | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDatabase();
  }, [params.id]);

  const fetchDatabase = async () => {
    try {
      const res = await fetch(`/api/databases/${params.id}`);
      if (res.ok) {
        const data = await res.json();
        setDatabase(data);
      }
    } catch (error) {
      console.error('Error fetching database:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (!database) return <div>Database not found</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">{database.name}</h1>
      <DatabaseView database={database} onUpdate={fetchDatabase} />
    </div>
  );
}