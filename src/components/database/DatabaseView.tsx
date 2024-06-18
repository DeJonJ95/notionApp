'use client';

import { useState } from 'react';
import { Plus, Settings } from 'lucide-react';

interface Database {
  id: string;
  name: string;
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

interface DatabaseViewProps {
  database: Database;
  onUpdate: () => void;
}

export function DatabaseView({ database, onUpdate }: DatabaseViewProps) {
  const [newPageTitle, setNewPageTitle] = useState('');

  const addPage = async () => {
    if (!newPageTitle.trim()) return;

    try {
      const res = await fetch('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: database.workspaceId, // Assuming we have it
          title: newPageTitle,
          databaseId: database.id,
        }),
      });

      if (res.ok) {
        setNewPageTitle('');
        onUpdate();
      }
    } catch (error) {
      console.error('Error adding page:', error);
    }
  };

  const addProperty = async () => {
    const name = prompt('Property name:');
    const type = prompt('Property type (text, number, date, select):') || 'text';

    if (!name) return;

    try {
      await fetch(`/api/databases/${database.id}/properties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type }),
      });
      onUpdate();
    } catch (error) {
      console.error('Error adding property:', error);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="New page title..."
            value={newPageTitle}
            onChange={(e) => setNewPageTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPage()}
            className="px-3 py-1 border rounded"
          />
          <button
            onClick={addPage}
            className="p-1 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="flex gap-2">
          <button className="p-2 hover:bg-gray-100 rounded">
            <Settings size={16} />
          </button>
          <button
            onClick={addProperty}
            className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
          >
            Add Property
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse border border-gray-300">
          <thead>
            <tr className="bg-gray-50">
              <th className="border border-gray-300 px-4 py-2 text-left">Name</th>
              {database.properties.map((prop) => (
                <th key={prop.id} className="border border-gray-300 px-4 py-2 text-left">
                  {prop.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {database.pages.map((page) => (
              <tr key={page.id} className="hover:bg-gray-50">
                <td className="border border-gray-300 px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span>{page.icon ?? '📄'}</span>
                    <span>{page.title}</span>
                  </div>
                </td>
                {database.properties.map((prop) => {
                  const propValue = page.properties.find((pv) => pv.property.id === prop.id);
                  return (
                    <td key={prop.id} className="border border-gray-300 px-4 py-2">
                      <input
                        type="text"
                        value={propValue?.value || ''}
                        onChange={(e) => updatePropertyValue(page.id, prop.id, e.target.value)}
                        className="w-full px-2 py-1 border rounded"
                        placeholder={`Enter ${prop.name}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}