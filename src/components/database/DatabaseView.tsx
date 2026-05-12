'use client';

import { useState, useEffect, useMemo } from 'react';
import { Plus, Settings, GripHorizontal } from 'lucide-react';
import { computeFormulaValues, getPositionBetween } from '@/lib/utils';

interface Database {
  id: string;
  workspaceId: string;
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
  position: number;
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
  position?: number;
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
  const [selectedViewId, setSelectedViewId] = useState(database.views?.[0]?.id ?? '');
  const [dragPageId, setDragPageId] = useState<string | null>(null);
  const [dragPropertyId, setDragPropertyId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedViewId(database.views?.[0]?.id ?? '');
  }, [database.views]);

  const selectedView = useMemo(() => {
    const view = database.views.find((view) => view.id === selectedViewId);
    return view ?? database.views[0] ?? { id: 'default', name: 'Table', type: 'table' };
  }, [database.views, selectedViewId]);

  const renderedPages = useMemo(() => {
    return database.pages.map((page) => {
      const rawValues: Record<string, any> = {};
      page.properties.forEach((pv) => {
        rawValues[pv.property.name] = pv.value;
      });

      const formulaValues = computeFormulaValues(database.properties, rawValues);

      const properties = database.properties.map((prop) => {
        const existing = page.properties.find((pv) => pv.property.id === prop.id);
        return {
          property: prop,
          value: prop.formula ? formulaValues[prop.id] : existing?.value ?? '',
        };
      });

      return { ...page, properties };
    });
  }, [database.pages, database.properties]);

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
    const type = prompt('Property type (text, number, date, select, formula):') || 'text';
    if (!name) return;

    let formula: string | undefined;
    if (type === 'formula') {
      formula = prompt('Formula expression (use property names):')?.trim() || undefined;
      if (!formula) return;
    }

    try {
      await fetch(`/api/databases/${database.id}/properties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, databaseId: database.id, formula }),
      });
      onUpdate();
    } catch (error) {
      console.error('Error adding property:', error);
    }
  };

  const addView = async () => {
    const name = prompt('View name:', 'New view');
    const type = prompt('View type (table, gallery, list):', 'table');
    if (!name || !type) return;

    try {
      const res = await fetch(`/api/databases/${database.id}/views`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, databaseId: database.id }),
      });
      if (res.ok) {
        onUpdate();
      }
    } catch (error) {
      console.error('Error adding view:', error);
    }
  };

  const updatePropertyValue = async (
    pageId: string,
    propertyId: string,
    value: any,
    propertyType: string
  ) => {
    if (propertyType === 'formula') return;

    const payload = {
      pageId,
      propertyId,
      value: propertyType === 'number' ? (value === '' ? null : Number(value)) : value,
    };

    try {
      await fetch('/api/property-values', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      onUpdate();
    } catch (error) {
      console.error('Error updating property value:', error);
    }
  };

  const handlePageDrop = async (targetId: string) => {
    if (!dragPageId || dragPageId === targetId) {
      setDragPageId(null);
      return;
    }

    const ordered = database.pages.filter((page) => page.id !== dragPageId);
    const dragged = database.pages.find((page) => page.id === dragPageId);
    if (!dragged) return;

    const index = ordered.findIndex((page) => page.id === targetId);
    ordered.splice(index, 0, dragged);

    const prev = ordered[index - 1] ?? null;
    const next = ordered[index + 1] ?? null;
    const position = getPositionBetween(prev?.position ?? null, next?.position ?? null);

    try {
      await fetch(`/api/pages/${dragPageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position }),
      });
      onUpdate();
    } catch (error) {
      console.error('Error reordering pages:', error);
    } finally {
      setDragPageId(null);
    }
  };

  const handlePropertyDrop = async (targetId: string) => {
    if (!dragPropertyId || dragPropertyId === targetId) {
      setDragPropertyId(null);
      return;
    }

    const ordered = database.properties.filter((prop) => prop.id !== dragPropertyId);
    const dragged = database.properties.find((prop) => prop.id === dragPropertyId);
    if (!dragged) return;

    const index = ordered.findIndex((prop) => prop.id === targetId);
    ordered.splice(index, 0, dragged);

    const prev = ordered[index - 1] ?? null;
    const next = ordered[index + 1] ?? null;
    const position = getPositionBetween(prev?.position ?? null, next?.position ?? null);

    try {
      await fetch(`/api/databases/${database.id}/properties`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: ordered.map((prop) => prop.id), movedId: dragPropertyId, position }),
      });
      onUpdate();
    } catch (error) {
      console.error('Error reordering properties:', error);
    } finally {
      setDragPropertyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
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
            className="p-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={addProperty}
            className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
          >
            Add Property
          </button>
          <button
            onClick={addView}
            className="px-3 py-1 bg-indigo-500 text-white rounded hover:bg-indigo-600"
          >
            Add View
          </button>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {database.views.map((view) => (
            <button
              key={view.id}
              onClick={() => setSelectedViewId(view.id)}
              className={`px-3 py-1 rounded border ${selectedViewId === view.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300'}`}
            >
              {view.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center text-sm text-gray-500">
        <span>View type:</span>
        <span className="font-medium capitalize">{selectedView.type}</span>
      </div>

      {selectedView.type === 'gallery' ? (
        <div className="grid gap-4 md:grid-cols-2">
          {renderedPages.map((page) => (
            <div
              key={page.id}
              draggable
              onDragStart={() => setDragPageId(page.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handlePageDrop(page.id)}
              className="border rounded p-4 hover:shadow-sm"
            >
              <div className="flex items-center gap-2 mb-3">
                <span>{page.icon ?? '📄'}</span>
                <div>
                  <div className="font-semibold">{page.title}</div>
                  <div className="text-xs text-gray-500">Drag to reorder</div>
                </div>
              </div>
              <div className="space-y-2">
                {page.properties.map((pv) => (
                  <div key={pv.property.id} className="text-sm">
                    <span className="font-medium">{pv.property.name}:</span> {pv.value ?? ''}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : selectedView.type === 'list' ? (
        <div className="space-y-3">
          {renderedPages.map((page) => (
            <div
              key={page.id}
              draggable
              onDragStart={() => setDragPageId(page.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handlePageDrop(page.id)}
              className="flex items-center justify-between gap-4 border rounded p-3 hover:bg-gray-50"
            >
              <div>
                <div className="font-semibold">{page.title}</div>
                <div className="text-sm text-gray-600">
                  {database.properties
                    .map((prop) => {
                      const pv = page.properties.find((value) => value.property.id === prop.id);
                      return pv ? `${prop.name}: ${pv.value}` : '';
                    })
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <GripHorizontal size={20} className="text-gray-500" />
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse border border-gray-300">
            <thead>
              <tr className="bg-gray-50">
                <th className="border border-gray-300 px-4 py-2 text-left">Name</th>
                {database.properties.map((prop) => (
                  <th
                    key={prop.id}
                    draggable
                    onDragStart={() => setDragPropertyId(prop.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => handlePropertyDrop(prop.id)}
                    className="border border-gray-300 px-4 py-2 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <GripHorizontal size={16} />
                      <span>{prop.name}</span>
                      {prop.formula ? <span className="text-xs text-gray-500">(formula)</span> : null}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {renderedPages.map((page) => (
                <tr
                  key={page.id}
                  draggable
                  onDragStart={() => setDragPageId(page.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => handlePageDrop(page.id)}
                  className="hover:bg-gray-50"
                >
                  <td className="border border-gray-300 px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span>{page.icon ?? '📄'}</span>
                      <span>{page.title}</span>
                    </div>
                  </td>
                  {page.properties.map((pv) => (
                    <td key={pv.property.id} className="border border-gray-300 px-4 py-2">
                      {pv.property.formula ? (
                        <div className="text-sm text-gray-700">{pv.value ?? ''}</div>
                      ) : (
                        <input
                          type={pv.property.type === 'number' ? 'number' : 'text'}
                          value={pv.value ?? ''}
                          onChange={(e) => updatePropertyValue(page.id, pv.property.id, e.target.value, pv.property.type)}
                          className="w-full px-2 py-1 border rounded"
                          placeholder={`Enter ${pv.property.name}`}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
