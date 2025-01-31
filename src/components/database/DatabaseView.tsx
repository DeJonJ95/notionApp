'use client';

import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Plus, GripHorizontal, Trash2, ChevronLeft, ChevronRight,
  Eye, EyeOff, X, Settings, Columns, ExternalLink, Edit3, Link2, Search,
} from 'lucide-react';
import { computeFormulaValues, getPositionBetween } from '@/lib/utils';

import type { CanvasBlockData } from '@/components/editor/CanvasPageEditor';
type SplitPageData = { id: string; title: string; icon: string | null; cover: string | null; isFavorite: boolean; blocks: CanvasBlockData[] };

const CanvasPageEditorPanel = dynamic(
  () => import('@/components/editor/CanvasPageEditor').then((m) => m.CanvasPageEditor),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-32 text-sm text-muted">Loading editor…</div> }
);

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

function getSelectOptions(property: Property): string[] {
  if (property.type !== 'select') return [];
  try {
    const parsed = JSON.parse(property.formula || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type BudgetPeriod = 'Weekly' | 'Bi-Weekly' | 'Monthly';

function getBudgetWindow(period: BudgetPeriod, anchor: Date): { start: Date; end: Date; label: string } {
  const d = new Date(anchor);
  if (period === 'Monthly') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { start, end, label: start.toLocaleString('default', { month: 'long', year: 'numeric' }) };
  }
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  monday.setHours(0, 0, 0, 0);
  if (period === 'Weekly') {
    const end = new Date(monday);
    end.setDate(monday.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    const fmt = (dt: Date) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { start: monday, end, label: `${fmt(monday)} – ${fmt(end)}` };
  }
  // Bi-Weekly: snap to a 2-week cycle anchored on Mon Jan 6, 2025
  const epoch = new Date(2025, 0, 6);
  const weekOffset = Math.floor((monday.getTime() - epoch.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const start = new Date(monday);
  if (weekOffset % 2 !== 0) start.setDate(monday.getDate() - 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 13);
  end.setHours(23, 59, 59, 999);
  const fmt = (dt: Date) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { start, end, label: `${fmt(start)} – ${fmt(end)}` };
}

function normalizeBudgetAmount(amount: number, fromPeriod: string, toPeriod: BudgetPeriod): number {
  const annualFactor: Record<string, number> = {
    'Weekly': 52, 'Bi-Weekly': 26, 'Monthly': 12, 'Quarterly': 4, 'Annual': 1,
  };
  const targetFactor: Record<BudgetPeriod, number> = { 'Weekly': 52, 'Bi-Weekly': 26, 'Monthly': 12 };
  const from = annualFactor[fromPeriod];
  if (!from) return amount; // One-Time or unknown — use as-is
  return (amount * from) / targetFactor[toPeriod];
}

const VIEW_TYPE_LABELS: Record<string, string> = {
  table: 'Table',
  gallery: 'Gallery',
  list: 'List',
  board: 'Board',
  calendar: 'Calendar',
  'budget-summary': 'Budget',
  'spending-breakdown': 'Spending',
};

export function DatabaseView({ database, onUpdate }: DatabaseViewProps) {
  const [newPageTitle, setNewPageTitle] = useState('');
  const [selectedViewId, setSelectedViewId] = useState(database.views?.[0]?.id ?? '');
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitViewId, setSplitViewId] = useState<string>(database.views?.[1]?.id ?? '');
  const [dragPageId, setDragPageId] = useState<string | null>(null);
  const [dragPropertyId, setDragPropertyId] = useState<string | null>(null);
  const [hiddenPropertyIds, setHiddenPropertyIds] = useState<Set<string>>(new Set());
  const [showPropertyPanel, setShowPropertyPanel] = useState(false);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [showAddView, setShowAddView] = useState(false);
  const [newPropName, setNewPropName] = useState('');
  const [newPropType, setNewPropType] = useState('text');
  const [newPropOptions, setNewPropOptions] = useState('');
  const [newPropFormula, setNewPropFormula] = useState('');
  const [newViewName, setNewViewName] = useState('New View');
  const [newViewType, setNewViewType] = useState('table');
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [groupByPropertyId, setGroupByPropertyId] = useState<string | null>(null);
  const [calendarDatePropertyId, setCalendarDatePropertyId] = useState<string | null>(null);
  const [budgetPeriod, setBudgetPeriod] = useState<BudgetPeriod>('Monthly');
  const [budgetWindowDate, setBudgetWindowDate] = useState(() => new Date());
  // Which Budget Summary categories are expanded to show their transactions
  const [expandedBudgetCats, setExpandedBudgetCats] = useState<Set<string>>(new Set());
  const [inspectPageId, setInspectPageId] = useState<string | null>(null);
  const [splitPageData, setSplitPageData] = useState<SplitPageData | null>(null);
  const [splitWidth, setSplitWidth] = useState(440);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    try {
      const saved = typeof window !== 'undefined'
        ? localStorage.getItem(`col-order-${database.id}`) : null;
      if (saved) return JSON.parse(saved);
    } catch {}
    return ['__title__', ...database.properties.map((p) => p.id)];
  });
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = typeof window !== 'undefined'
        ? localStorage.getItem(`col-widths-${database.id}`) : null;
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });
  const resizeRef = useRef<{ colId: string; startX: number; startW: number } | null>(null);

  useEffect(() => {
    const stillExists = database.views.some((v) => v.id === selectedViewId);
    if (!stillExists) setSelectedViewId(database.views?.[0]?.id ?? '');
  }, [database.views, selectedViewId]);

  // Keep columnOrder in sync when properties are added or removed.
  useEffect(() => {
    setColumnOrder((prev) => {
      const valid = new Set(['__title__', ...database.properties.map((p) => p.id)]);
      const filtered = prev.filter((id) => valid.has(id));
      const missing = [...valid].filter((id) => !filtered.includes(id));
      const updated = [...filtered, ...missing];
      try { localStorage.setItem(`col-order-${database.id}`, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, [database.properties, database.id]);

  const selectedView = useMemo(() => {
    return (
      database.views.find((v) => v.id === selectedViewId) ??
      database.views[0] ??
      { id: 'default', name: 'Table', type: 'table' }
    );
  }, [database.views, selectedViewId]);

  const splitView = useMemo(() => {
    return database.views.find((v) => v.id === splitViewId) ?? database.views[1] ?? null;
  }, [database.views, splitViewId]);

  const renderedPages = useMemo(() => {
    return database.pages.map((page) => {
      const rawValues: Record<string, any> = {};
      page.properties.forEach((pv) => { rawValues[pv.property.name] = pv.value; });
      const formulaValues = computeFormulaValues(database.properties, rawValues);
      const properties = database.properties.map((prop) => {
        const existing = page.properties.find((pv) => pv.property.id === prop.id);
        return { property: prop, value: prop.formula && prop.type === 'formula' ? formulaValues[prop.id] : existing?.value ?? '' };
      });
      return { ...page, properties };
    });
  }, [database.pages, database.properties]);

  // ── Per-view filter / sort (persisted on the View row) ─────────────────
  const viewFilter = (selectedView as any).filters as
    | { propertyId: string; op: 'eq' | 'contains'; value: string }
    | null
    | undefined;
  const viewSort = (selectedView as any).sorts as
    | { propertyId: string; dir: 'asc' | 'desc' }
    | null
    | undefined;
  const viewGroup = (selectedView as any).grouping as
    | { propertyId: string }
    | null
    | undefined;

  const cellValue = (page: (typeof renderedPages)[0], propId: string): any => {
    if (propId === '__title__') return page.title ?? '';
    return page.properties.find((v) => v.property.id === propId)?.value ?? '';
  };

  const viewedPages = useMemo(() => {
    let rows = renderedPages;
    if (viewFilter && viewFilter.propertyId) {
      const needle = String(viewFilter.value ?? '').toLowerCase();
      rows = rows.filter((p) => {
        const v = String(cellValue(p, viewFilter.propertyId) ?? '').toLowerCase();
        return viewFilter.op === 'contains' ? v.includes(needle) : v === needle;
      });
    }
    if (viewSort && viewSort.propertyId) {
      rows = [...rows].sort((a, b) => {
        const av = cellValue(a, viewSort.propertyId);
        const bv = cellValue(b, viewSort.propertyId);
        const an = Number(av);
        const bn = Number(bv);
        let cmp: number;
        if (!isNaN(an) && !isNaN(bn) && av !== '' && bv !== '') cmp = an - bn;
        else cmp = String(av).localeCompare(String(bv));
        return viewSort.dir === 'desc' ? -cmp : cmp;
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedPages, JSON.stringify(viewFilter), JSON.stringify(viewSort)]);


  const visibleProperties = useMemo(
    () => database.properties.filter((p) => !hiddenPropertyIds.has(p.id)),
    [database.properties, hiddenPropertyIds]
  );

  const selectProperties = useMemo(() => database.properties.filter((p) => p.type === 'select'), [database.properties]);
  const dateProperties = useMemo(() => database.properties.filter((p) => p.type === 'date'), [database.properties]);

  const boardGroupProperty = useMemo(
    () => database.properties.find((p) => p.id === groupByPropertyId) ?? selectProperties[0] ?? null,
    [database.properties, groupByPropertyId, selectProperties]
  );

  const calendarDateProperty = useMemo(
    () => database.properties.find((p) => p.id === calendarDatePropertyId) ?? dateProperties[0] ?? null,
    [database.properties, calendarDatePropertyId, dateProperties]
  );

  // --- Handlers ---

  const addPage = async () => {
    if (!newPageTitle.trim()) return;
    const res = await fetch('/api/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: database.workspaceId, title: newPageTitle, databaseId: database.id }),
    });
    if (res.ok) { setNewPageTitle(''); onUpdate(); }
  };

  // ── Link existing page → attach an existing page to this database ───────
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [allUserPages, setAllUserPages] = useState<Array<{
    id: string; title: string; icon: string | null; updatedAt: string; databaseId: string | null; workspaceId: string;
  }>>([]);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!linkOpen) return;
    fetch('/api/pages')
      .then((r) => (r.ok ? r.json() : []))
      .then((p) => setAllUserPages(p))
      .catch(() => {});
  }, [linkOpen]);

  const linkablePages = useMemo(() => {
    // Only show pages NOT already in this database. Sort by recency.
    const q = linkSearch.trim().toLowerCase();
    return allUserPages
      .filter((p) => p.databaseId !== database.id)
      .filter((p) => !q || p.title.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 50);
  }, [allUserPages, database.id, linkSearch]);

  const linkPageToDb = async (pageId: string) => {
    setLinkBusy(pageId);
    const res = await fetch(`/api/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ databaseId: database.id, workspaceId: database.workspaceId }),
    });
    setLinkBusy(null);
    if (res.ok) {
      onUpdate();
      // Remove from the local list so it doesn't show as still-linkable
      setAllUserPages((prev) => prev.map((p) => p.id === pageId ? { ...p, databaseId: database.id } : p));
    } else {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? 'Failed to link page');
    }
  };

  const handleAddProperty = async () => {
    if (!newPropName.trim()) return;
    let formula: string | undefined;
    if (newPropType === 'formula') {
      if (!newPropFormula.trim()) return;
      formula = newPropFormula.trim();
    } else if (newPropType === 'select') {
      const opts = newPropOptions.split('\n').map((s) => s.trim()).filter(Boolean);
      formula = JSON.stringify(opts);
    }
    await fetch(`/api/databases/${database.id}/properties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newPropName, type: newPropType, databaseId: database.id, formula }),
    });
    setShowAddProperty(false);
    setNewPropName(''); setNewPropType('text'); setNewPropOptions(''); setNewPropFormula('');
    onUpdate();
  };

  const deleteProperty = async (propertyId: string) => {
    if (!confirm('Delete this property and all its values?')) return;
    await fetch(`/api/databases/${database.id}/properties/${propertyId}`, { method: 'DELETE' });
    onUpdate();
  };

  // ── Edit-property modal state ──────────────────────────────────────────
  const [editPropId, setEditPropId] = useState<string | null>(null);
  const [editPropName, setEditPropName] = useState('');
  const [editPropType, setEditPropType] = useState<string>('text');
  const [editPropOptions, setEditPropOptions] = useState('');
  const [editPropFormula, setEditPropFormula] = useState('');
  const [editPropOriginalType, setEditPropOriginalType] = useState<string>('');

  const openEditProperty = (prop: Property) => {
    setEditPropId(prop.id);
    setEditPropName(prop.name);
    setEditPropType(prop.type);
    setEditPropOriginalType(prop.type);
    if (prop.type === 'select') {
      try {
        const arr = JSON.parse(prop.formula || '[]');
        setEditPropOptions(Array.isArray(arr) ? arr.join('\n') : '');
      } catch { setEditPropOptions(''); }
      setEditPropFormula('');
    } else if (prop.type === 'formula') {
      setEditPropFormula(prop.formula || '');
      setEditPropOptions('');
    } else {
      setEditPropOptions('');
      setEditPropFormula('');
    }
  };

  const closeEditProperty = () => {
    setEditPropId(null);
    setEditPropName('');
    setEditPropType('text');
    setEditPropOptions('');
    setEditPropFormula('');
    setEditPropOriginalType('');
  };

  const saveEditProperty = async () => {
    if (!editPropId || !editPropName.trim()) return;
    // If type changed, warn — existing values may become invalid.
    if (editPropType !== editPropOriginalType) {
      if (!confirm(
        `Change type from ${editPropOriginalType} to ${editPropType}? ` +
        `Existing values may no longer display correctly.`
      )) return;
    }
    let formula: string | null = null;
    if (editPropType === 'select') {
      const opts = editPropOptions.split('\n').map((s) => s.trim()).filter(Boolean);
      formula = JSON.stringify(opts);
    } else if (editPropType === 'formula') {
      formula = editPropFormula.trim() || null;
    }
    await fetch(`/api/databases/${database.id}/properties/${editPropId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editPropName.trim(), type: editPropType, formula }),
    });
    closeEditProperty();
    onUpdate();
  };

  const handleAddView = async () => {
    if (!newViewName.trim()) return;
    const res = await fetch(`/api/databases/${database.id}/views`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newViewName, type: newViewType, databaseId: database.id }),
    });
    if (res.ok) {
      setShowAddView(false);
      setNewViewName('New View'); setNewViewType('table');
      onUpdate();
    }
  };

  // Local edit buffer so cell inputs feel instant. Every keystroke writes
  // here; the actual network save is debounced. Parent refresh is also
  // debounced (longer) so derived views like Budget Summary update without
  // forcing a full table re-render mid-typing.
  const [localEdits, setLocalEdits] = useState<Record<string, any>>({});
  const cellSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cellKey = (pageId: string, propertyId: string) => `${pageId}|${propertyId}`;

  const updatePropertyValue = (pageId: string, propertyId: string, value: any, propertyType: string) => {
    if (propertyType === 'formula') return;
    const key = cellKey(pageId, propertyId);

    // 1. Instant local update — keeps the input responsive
    setLocalEdits((prev) => ({ ...prev, [key]: value }));

    // 2. Debounced save (500ms per cell). Coercion happens here so partial
    //    number input like "1." or "-" doesn't get NaN-ed mid-typing.
    if (cellSaveTimers.current[key]) clearTimeout(cellSaveTimers.current[key]);
    cellSaveTimers.current[key] = setTimeout(async () => {
      const coerced =
        propertyType === 'number' ? (value === '' || value == null ? null : Number(value)) :
        propertyType === 'checkbox' ? Boolean(value) :
        (value === '' ? null : value);
      try {
        await fetch('/api/property-values', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageId, propertyId, value: coerced }),
        });
      } catch {}
      delete cellSaveTimers.current[key];

      // 3. Eventual-consistency refresh for derived views (Budget Summary, etc).
      //    Debounced 1.2s after the last save so rapid edits don't thrash.
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        onUpdate();
      }, 1200);
    }, 500);
  };

  // Flush any pending edits on unmount so a quick navigation doesn't lose
  // the last few keystrokes.
  useEffect(() => {
    return () => {
      Object.values(cellSaveTimers.current).forEach((t) => clearTimeout(t));
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

  const handlePageDrop = async (targetId: string) => {
    if (!dragPageId || dragPageId === targetId) { setDragPageId(null); return; }
    const ordered = database.pages.filter((p) => p.id !== dragPageId);
    const dragged = database.pages.find((p) => p.id === dragPageId);
    if (!dragged) return;
    const index = ordered.findIndex((p) => p.id === targetId);
    ordered.splice(index, 0, dragged);
    const prev = ordered[index - 1] ?? null;
    const next = ordered[index + 1] ?? null;
    const position = getPositionBetween(prev?.position ?? null, next?.position ?? null);
    await fetch(`/api/pages/${dragPageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position }),
    });
    setDragPageId(null);
    onUpdate();
  };

  const handlePropertyDrop = async (targetId: string) => {
    if (!dragPropertyId || dragPropertyId === targetId) { setDragPropertyId(null); return; }
    const ordered = database.properties.filter((p) => p.id !== dragPropertyId);
    const dragged = database.properties.find((p) => p.id === dragPropertyId);
    if (!dragged) return;
    const index = ordered.findIndex((p) => p.id === targetId);
    ordered.splice(index, 0, dragged);
    const prev = ordered[index - 1] ?? null;
    const next = ordered[index + 1] ?? null;
    const position = getPositionBetween(prev?.position ?? null, next?.position ?? null);
    await fetch(`/api/databases/${database.id}/properties`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: ordered.map((p) => p.id), movedId: dragPropertyId, position }),
    });
    setDragPropertyId(null);
    onUpdate();
  };

  const handleBoardDrop = async (columnValue: string, groupPropId: string) => {
    if (!dragPageId) return;
    await updatePropertyValue(dragPageId, groupPropId, columnValue || null, 'select');
    setDragPageId(null);
  };

  // Fetch page content when a row is opened in the split editor.
  useEffect(() => {
    if (!inspectPageId) { setSplitPageData(null); return; }
    fetch(`/api/pages/${inspectPageId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const blocks: CanvasBlockData[] = (d.blocks ?? []).map((b: any) => ({
          id: b.id,
          type: b.type,
          content: b.content,
          canvasX: b.canvasX ?? 60,
          canvasY: b.canvasY ?? 60,
          canvasWidth: b.canvasWidth ?? 420,
        }));
        setSplitPageData({ id: d.id, title: d.title, icon: d.icon, cover: d.cover ?? null, isFavorite: d.isFavorite, blocks });
      })
      .catch(() => {});
  }, [inspectPageId]);

  const startSplitResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = splitWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX; // dragging left = wider
      setSplitWidth(Math.max(300, Math.min(window.innerWidth * 0.65, startW + delta)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleColDrop = (targetId: string) => {
    if (!dragColId || dragColId === targetId) { setDragColId(null); return; }
    setColumnOrder((prev) => {
      const next = [...prev];
      const fromIdx = next.indexOf(dragColId);
      const toIdx = next.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, dragColId);
      try { localStorage.setItem(`col-order-${database.id}`, JSON.stringify(next)); } catch {}
      return next;
    });
    setDragColId(null);
  };

  const startColResize = (colId: string, startX: number) => {
    const startW = colWidths[colId] ?? (colId === '__title__' ? 200 : 150);
    resizeRef.current = { colId, startX, startW };

    const onMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const { colId: id, startX: sx, startW: sw } = resizeRef.current;
      const w = Math.max(36, sw + e.clientX - sx);
      setColWidths((prev) => {
        const next = { ...prev, [id]: w };
        try { localStorage.setItem(`col-widths-${database.id}`, JSON.stringify(next)); } catch {}
        return next;
      });
    };
    const onUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const advanceBudgetWindow = (dir: 1 | -1) => {
    setBudgetWindowDate((prev) => {
      const d = new Date(prev);
      if (budgetPeriod === 'Monthly') d.setMonth(d.getMonth() + dir);
      else if (budgetPeriod === 'Weekly') d.setDate(d.getDate() + dir * 7);
      else d.setDate(d.getDate() + dir * 14);
      return d;
    });
  };

  const togglePropertyVisibility = (id: string) => {
    setHiddenPropertyIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // --- Shared property input renderer ---

  const renderPropertyInput = (page: Page, pv: PropertyValue) => {
    if (pv.property.type === 'formula') {
      return <span className="text-sm text-muted">{String(pv.value ?? '')}</span>;
    }
    const base = 'bg-bg text-text border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent w-full';
    switch (pv.property.type) {
      case 'checkbox':
        {
          const buf = localEdits[cellKey(page.id, pv.property.id)];
          const checked = buf !== undefined ? !!buf : !!pv.value;
          return (
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => updatePropertyValue(page.id, pv.property.id, e.target.checked, 'checkbox')}
              className="w-4 h-4 cursor-pointer accent-accent"
            />
          );
        }
      case 'date':
        return (
          <input
            type="date"
            value={(() => {
              const buf = localEdits[cellKey(page.id, pv.property.id)];
              const v = buf !== undefined ? buf : pv.value;
              return v ? String(v) : '';
            })()}
            onChange={(e) => updatePropertyValue(page.id, pv.property.id, e.target.value || null, 'date')}
            className={base}
          />
        );
      case 'select': {
        const options = getSelectOptions(pv.property);
        const buf = localEdits[cellKey(page.id, pv.property.id)];
        const value = buf !== undefined ? buf : pv.value;
        return (
          <select
            value={String(value ?? '')}
            onChange={(e) => updatePropertyValue(page.id, pv.property.id, e.target.value || null, 'select')}
            className={base}
          >
            <option value="">— none —</option>
            {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        );
      }
      case 'number': {
        const buf = localEdits[cellKey(page.id, pv.property.id)];
        // Show raw buffer string while typing so "1." / "-" don't snap to NaN.
        const value = buf !== undefined ? buf : pv.value;
        return (
          <input
            type="number"
            value={value !== null && value !== undefined ? String(value) : ''}
            onChange={(e) => updatePropertyValue(page.id, pv.property.id, e.target.value, 'number')}
            className={base}
            placeholder="0"
          />
        );
      }
      default: {
        const buf = localEdits[cellKey(page.id, pv.property.id)];
        const value = buf !== undefined ? buf : pv.value;
        return (
          <input
            type="text"
            value={String(value ?? '')}
            onChange={(e) => updatePropertyValue(page.id, pv.property.id, e.target.value, 'text')}
            className={base}
            placeholder={`${pv.property.name}…`}
          />
        );
      }
    }
  };

  // --- View renderers ---

  const renderTableView = () => {
    const orderedCols = columnOrder.filter((id) => {
      if (id === '__title__') return true;
      const prop = database.properties.find((p) => p.id === id);
      return prop && !hiddenPropertyIds.has(id);
    });

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse border border-border text-text table-fixed">
          <thead>
            <tr className="bg-surface">
              {orderedCols.map((colId) => {
                const isTitle = colId === '__title__';
                const prop = isTitle ? null : database.properties.find((p) => p.id === colId);
                if (!isTitle && !prop) return null;
                const w = colWidths[colId] ?? (isTitle ? 220 : 160);
                const isNarrow = w < 80;
                return (
                  <th
                    key={colId}
                    style={{ width: w, minWidth: 36, maxWidth: w, overflow: 'hidden' }}
                    draggable
                    onDragStart={(e) => { e.stopPropagation(); setDragColId(colId); }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); handleColDrop(colId); }}
                    className="relative border border-border px-2 py-2 text-left text-sm font-semibold text-text group select-none"
                  >
                    <div className="flex items-center gap-1 overflow-hidden pr-2">
                      <GripHorizontal size={14} className="text-muted shrink-0 cursor-grab" />
                      {!isNarrow && <span className="truncate">{isTitle ? 'Name' : prop!.name}</span>}
                      {!isTitle && !isNarrow && (
                        <>
                          <span className="text-xs text-muted capitalize shrink-0">({prop!.type})</span>
                          <button
                            onClick={() => openEditProperty(prop!)}
                            className="ml-auto opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-opacity shrink-0"
                            title="Edit property"
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            onClick={() => deleteProperty(colId)}
                            className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-500 transition-opacity shrink-0"
                            title="Delete property"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                    {/* Resize handle */}
                    <div
                      className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-accent/50 active:bg-accent"
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startColResize(colId, e.clientX); }}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const renderRow = (page: (typeof viewedPages)[0]) => (
                <tr
                  key={page.id}
                  draggable
                  onDragStart={() => setDragPageId(page.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handlePageDrop(page.id)}
                  className="hover:bg-surface transition-colors"
                >
                  {orderedCols.map((colId) => {
                    const isTitle = colId === '__title__';
                    const prop = isTitle ? null : database.properties.find((p) => p.id === colId);
                    if (!isTitle && !prop) return null;
                    const w = colWidths[colId];
                    return (
                      <td
                        key={colId}
                        className="border border-border px-3 py-2"
                        style={w ? { width: w, maxWidth: w, overflow: 'hidden' } : undefined}
                      >
                        {isTitle ? (
                          <button
                            onClick={() => setInspectPageId(page.id)}
                            className="flex items-center gap-2 text-text font-medium hover:text-accent text-left w-full truncate"
                          >
                            <span>{page.icon ?? '📄'}</span>
                            <span className="truncate">{page.title}</span>
                          </button>
                        ) : (
                          renderPropertyInput(
                            page,
                            page.properties.find((v) => v.property.id === colId) ?? { property: prop!, value: '' }
                          )
                        )}
                      </td>
                    );
                  })}
                </tr>
              );

              if (viewGroup && viewGroup.propertyId) {
                const groups = new Map<string, typeof viewedPages>();
                for (const p of viewedPages) {
                  const key = String(cellValue(p, viewGroup.propertyId) || '— none —');
                  if (!groups.has(key)) groups.set(key, []);
                  groups.get(key)!.push(p);
                }
                return Array.from(groups.entries()).map(([groupKey, rows]) => (
                  <Fragment key={groupKey}>
                    <tr className="bg-surface/70">
                      <td
                        colSpan={orderedCols.length}
                        className="border border-border px-3 py-1.5 text-xs font-semibold text-muted uppercase tracking-wide"
                      >
                        {groupKey} <span className="text-muted/60 normal-case">({rows.length})</span>
                      </td>
                    </tr>
                    {rows.map(renderRow)}
                  </Fragment>
                ));
              }
              return viewedPages.map(renderRow);
            })()}
          </tbody>
        </table>
      </div>
    );
  };

  const renderGalleryView = () => (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {viewedPages.map((page) => (
        <div
          key={page.id}
          draggable
          onDragStart={() => setDragPageId(page.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handlePageDrop(page.id)}
          className="border border-border rounded-lg p-4 bg-surface hover:shadow-md transition-shadow"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">{page.icon ?? '📄'}</span>
            <span className="font-semibold text-text truncate">{page.title}</span>
          </div>
          <div className="space-y-2">
            {visibleProperties.map((prop) => {
              const pv = page.properties.find((v) => v.property.id === prop.id) ?? { property: prop, value: '' };
              return (
                <div key={prop.id} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted uppercase tracking-wide">{prop.name}</span>
                  {renderPropertyInput(page, pv)}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  const renderListView = () => (
    <div className="space-y-2">
      {viewedPages.map((page) => (
        <div
          key={page.id}
          draggable
          onDragStart={() => setDragPageId(page.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handlePageDrop(page.id)}
          className="flex items-start gap-4 border border-border rounded-lg p-3 bg-surface hover:shadow-sm transition-shadow"
        >
          <GripHorizontal size={18} className="text-muted mt-0.5 shrink-0 cursor-grab" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span>{page.icon ?? '📄'}</span>
              <span className="font-semibold text-text">{page.title}</span>
            </div>
            <div className="flex flex-wrap gap-3">
              {visibleProperties.map((prop) => {
                const pv = page.properties.find((v) => v.property.id === prop.id) ?? { property: prop, value: '' };
                return (
                  <div key={prop.id} className="flex items-center gap-1 text-sm">
                    <span className="text-muted">{prop.name}:</span>
                    <div className="max-w-40">{renderPropertyInput(page, pv)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderBoardView = () => {
    if (!boardGroupProperty) {
      return (
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-muted">
          Board view requires a <strong className="text-text">select</strong> property to group by.
          Add a select property first using "Add Property".
        </div>
      );
    }

    const options = getSelectOptions(boardGroupProperty);
    const columns = [
      { id: '', label: 'No Status' },
      ...options.map((o) => ({ id: o, label: o })),
    ];

    const getColPages = (colId: string) =>
      viewedPages.filter((p) => {
        const pv = p.properties.find((v) => v.property.id === boardGroupProperty.id);
        return (String(pv?.value ?? '')) === colId;
      });

    return (
      <div>
        <div className="flex items-center gap-3 mb-4 text-sm text-muted">
          <span>Group by:</span>
          <select
            value={boardGroupProperty.id}
            onChange={(e) => setGroupByPropertyId(e.target.value)}
            className="bg-bg text-text border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {selectProperties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-4 snap-x snap-mandatory -mx-1 px-1">
          {columns.map((col) => {
            const colPages = getColPages(col.id);
            return (
              <div
                key={col.id}
                className="flex-shrink-0 w-[80vw] sm:w-64 snap-start"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleBoardDrop(col.id, boardGroupProperty.id)}
              >
                <div className="bg-surface border border-border rounded-t-lg px-3 py-2 flex items-center justify-between">
                  <span className="font-semibold text-sm text-text">{col.label}</span>
                  <span className="text-xs bg-border text-muted rounded-full px-2 py-0.5">{colPages.length}</span>
                </div>
                <div className="border border-t-0 border-border rounded-b-lg min-h-32 p-2 space-y-2 bg-bg">
                  {colPages.map((page) => (
                    <div
                      key={page.id}
                      draggable
                      onDragStart={() => setDragPageId(page.id)}
                      className="bg-surface border border-border rounded-lg p-3 cursor-grab hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span>{page.icon ?? '📄'}</span>
                        <span className="font-medium text-sm text-text truncate">{page.title}</span>
                      </div>
                      {visibleProperties
                        .filter((p) => p.id !== boardGroupProperty.id)
                        .slice(0, 3)
                        .map((prop) => {
                          const pv = page.properties.find((v) => v.property.id === prop.id);
                          const val = pv?.value;
                          if (!val && val !== 0 && val !== false) return null;
                          return (
                            <div key={prop.id} className="text-xs text-muted">
                              {prop.name}: {prop.type === 'checkbox' ? (val ? '✓' : '✗') : String(val)}
                            </div>
                          );
                        })}
                    </div>
                  ))}
                  {colPages.length === 0 && (
                    <div className="text-xs text-muted text-center py-4">Drop here</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderCalendarView = () => {
    if (!calendarDateProperty) {
      return (
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-muted">
          Calendar view requires a <strong className="text-text">date</strong> property.
          Add a date property first using "Add Property".
        </div>
      );
    }

    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const monthLabel = calendarDate.toLocaleString('default', { month: 'long', year: 'numeric' });
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: (null | { day: number; dateStr: string; pages: typeof renderedPages })[] = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const pages = renderedPages.filter((p) => {
        const pv = p.properties.find((v) => v.property.id === calendarDateProperty.id);
        return pv?.value === dateStr;
      });
      cells.push({ day: d, dateStr, pages });
    }

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    return (
      <div>
        <div className="flex items-center gap-4 mb-4">
          {dateProperties.length > 1 && (
            <select
              value={calendarDateProperty.id}
              onChange={(e) => setCalendarDatePropertyId(e.target.value)}
              className="bg-bg text-text border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {dateProperties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button
            onClick={() => setCalendarDate(new Date(year, month - 1))}
            className="p-1.5 rounded hover:bg-surface border border-border text-text"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="font-semibold text-text min-w-36 text-center">{monthLabel}</span>
          <button
            onClick={() => setCalendarDate(new Date(year, month + 1))}
            className="p-1.5 rounded hover:bg-surface border border-border text-text"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => setCalendarDate(new Date())}
            className="text-xs text-accent hover:underline"
          >
            Today
          </button>
        </div>
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="grid grid-cols-7">
            {(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const).map((d, i) => (
              <div key={d} className="bg-surface px-1 py-2 text-xs font-semibold text-muted text-center border-b border-border">
                <span className="hidden sm:inline">{d}</span>
                <span className="sm:hidden">{['S','M','T','W','T','F','S'][i]}</span>
              </div>
            ))}
            {cells.map((cell, i) => (
              <div
                key={i}
                className={`min-h-14 sm:min-h-24 p-1 sm:p-1.5 border-b border-r border-border last:border-r-0 bg-bg ${!cell ? 'bg-surface/40' : ''}`}
              >
                {cell && (
                  <>
                    <div className={`text-[10px] sm:text-xs font-medium mb-0.5 sm:mb-1 w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full ${cell.dateStr === todayStr ? 'bg-accent text-white' : 'text-muted'}`}>
                      {cell.day}
                    </div>
                    <div className="space-y-0.5">
                      {cell.pages.map((page) => (
                        <div
                          key={page.id}
                          className="text-[10px] sm:text-xs bg-accent/15 text-accent rounded px-1 sm:px-1.5 py-0.5 truncate font-medium leading-tight"
                          title={page.title}
                        >
                          <span className="hidden sm:inline">{page.icon} </span>{page.title}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderBudgetPeriodToolbar = () => {
    const win = getBudgetWindow(budgetPeriod, budgetWindowDate);
    return (
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
          {(['Weekly', 'Bi-Weekly', 'Monthly'] as BudgetPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setBudgetPeriod(p)}
              className={`px-3 py-1.5 transition-colors ${budgetPeriod === p ? 'bg-accent text-white' : 'bg-bg text-muted hover:bg-surface'}`}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => advanceBudgetWindow(-1)}
            className="p-1.5 rounded hover:bg-surface border border-border text-text"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-sm font-medium text-text min-w-36 text-center">{win.label}</span>
          <button
            onClick={() => advanceBudgetWindow(1)}
            className="p-1.5 rounded hover:bg-surface border border-border text-text"
          >
            <ChevronRight size={14} />
          </button>
          <button
            onClick={() => setBudgetWindowDate(new Date())}
            className="text-xs text-accent hover:underline ml-1"
          >
            Today
          </button>
        </div>
      </div>
    );
  };

  const renderBudgetSummaryView = () => {
    const amountProp = database.properties.find((p) => p.name === 'Amount');
    const budgetedProp = database.properties.find((p) => p.name === 'Budgeted Amount');
    const categoryProp = database.properties.find((p) => p.type === 'select' && p.name === 'Category');
    const typeProp = database.properties.find((p) => p.name === 'Type');
    const dateProp = database.properties.find((p) => p.name === 'Date' && p.type === 'date');
    const budgetPeriodProp = database.properties.find((p) => p.name === 'Budget Period');

    if (!amountProp || !categoryProp) {
      return (
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-muted">
          Budget Summary requires <strong className="text-text">Category</strong> and <strong className="text-text">Amount</strong> properties.
        </div>
      );
    }

    const win = getBudgetWindow(budgetPeriod, budgetWindowDate);
    const winStartStr = `${win.start.getFullYear()}-${String(win.start.getMonth() + 1).padStart(2, '0')}-${String(win.start.getDate()).padStart(2, '0')}`;
    const winEndStr = `${win.end.getFullYear()}-${String(win.end.getMonth() + 1).padStart(2, '0')}-${String(win.end.getDate()).padStart(2, '0')}`;
    const inWindow = (dateVal: unknown) => {
      if (!dateProp) return true; // no Date property — show all
      if (!dateVal) return false;
      const s = String(dateVal).slice(0, 10);
      return s >= winStartStr && s <= winEndStr;
    };

    const fmtCurrency = (n: number) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

    const getVal = (page: (typeof renderedPages)[0], propId: string) =>
      page.properties.find((v) => v.property.id === propId)?.value ?? null;

    type TxLine = { id: string; title: string; date: string; amount: number };
    interface CatData { budgeted: number; spent: number; txns: TxLine[] }
    const map = new Map<string, CatData>();

    for (const page of renderedPages) {
      const cat = String(getVal(page, categoryProp.id) ?? '');
      if (!cat) continue;
      const type = typeProp ? String(getVal(page, typeProp.id) ?? '') : '';
      const amount = Math.abs(Number(getVal(page, amountProp.id) ?? 0));
      const budgetedRaw = budgetedProp ? Math.abs(Number(getVal(page, budgetedProp.id) ?? 0)) : 0;
      if (!map.has(cat)) map.set(cat, { budgeted: 0, spent: 0, txns: [] });
      const entry = map.get(cat)!;
      if (type === 'Budget') {
        const rawBudget = budgetedRaw || amount;
        const fromPeriod = budgetPeriodProp ? String(getVal(page, budgetPeriodProp.id) ?? '') : '';
        entry.budgeted += fromPeriod ? normalizeBudgetAmount(rawBudget, fromPeriod, budgetPeriod) : rawBudget;
      } else if (type !== 'Income') {
        const dateVal = dateProp ? getVal(page, dateProp.id) : null;
        if (inWindow(dateVal)) {
          entry.spent += amount;
          entry.txns.push({
            id: page.id,
            title: page.title || 'Untitled',
            date: dateVal ? String(dateVal).slice(0, 10) : '',
            amount,
          });
        }
      }
    }

    const categories = Array.from(map.entries())
      .map(([category, d]) => ({
        category,
        ...d,
        txns: [...d.txns].sort((a, b) => b.date.localeCompare(a.date)),
      }))
      .filter((c) => c.budgeted > 0 || c.spent > 0)
      .sort((a, b) => {
        const ra = a.budgeted > 0 ? a.spent / a.budgeted : (a.spent > 0 ? 2 : 0);
        const rb = b.budgeted > 0 ? b.spent / b.budgeted : (b.spent > 0 ? 2 : 0);
        return rb - ra;
      });

    const toggleCat = (category: string) =>
      setExpandedBudgetCats((prev) => {
        const next = new Set(prev);
        next.has(category) ? next.delete(category) : next.add(category);
        return next;
      });

    const totalBudgeted = categories.reduce((s, c) => s + c.budgeted, 0);
    const totalSpent = categories.reduce((s, c) => s + c.spent, 0);
    const totalRemaining = totalBudgeted - totalSpent;

    return (
      <div className="space-y-4">
        {renderBudgetPeriodToolbar()}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-surface p-4 text-center">
            <div className="text-xs text-muted uppercase tracking-wide mb-1">Budgeted</div>
            <div className="text-xl font-bold text-text">{fmtCurrency(totalBudgeted)}</div>
          </div>
          <div className="rounded-lg border border-border bg-surface p-4 text-center">
            <div className="text-xs text-muted uppercase tracking-wide mb-1">Spent</div>
            <div className="text-xl font-bold text-text">{fmtCurrency(totalSpent)}</div>
          </div>
          <div className={`rounded-lg border p-4 text-center ${totalRemaining >= 0 ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
            <div className="text-xs text-muted uppercase tracking-wide mb-1">Remaining</div>
            <div className={`text-xl font-bold ${totalRemaining >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtCurrency(totalRemaining)}</div>
          </div>
        </div>
        <div className="space-y-2">
          {categories.length === 0 ? (
            <div className="text-sm text-muted text-center py-8">
              Add a row with Type = "Budget" to set envelope amounts, then add expense transactions to track spending.
            </div>
          ) : (
            categories.map((c) => {
              const pct = c.budgeted > 0 ? Math.min((c.spent / c.budgeted) * 100, 100) : 100;
              const over = c.spent > c.budgeted && c.budgeted > 0;
              const warn = !over && pct >= 80;
              const barColor = over ? 'bg-red-500' : warn ? 'bg-yellow-500' : 'bg-green-500';
              const remaining = c.budgeted - c.spent;
              const expanded = expandedBudgetCats.has(c.category);
              const hasTxns = c.txns.length > 0;
              const fmtCents = (n: number) =>
                new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
              return (
                <div key={c.category} className="rounded-lg border border-border bg-surface">
                  <button
                    type="button"
                    onClick={() => hasTxns && toggleCat(c.category)}
                    className={`w-full text-left p-3 ${hasTxns ? 'cursor-pointer hover:bg-bg/40' : 'cursor-default'} transition-colors rounded-lg`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-text flex items-center gap-1.5">
                        {hasTxns && (
                          <ChevronRight
                            size={13}
                            className={`text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
                          />
                        )}
                        {c.category}
                        {hasTxns && (
                          <span className="text-[10px] text-muted font-normal">({c.txns.length})</span>
                        )}
                      </span>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-muted">{fmtCurrency(c.spent)} / {fmtCurrency(c.budgeted)}</span>
                        <span className={over ? 'text-red-500 font-semibold' : remaining >= 0 ? 'text-green-600' : 'text-red-500'}>
                          {over ? `${fmtCurrency(Math.abs(remaining))} over` : `${fmtCurrency(remaining)} left`}
                        </span>
                      </div>
                    </div>
                    <div className="h-2 bg-bg rounded-full overflow-hidden border border-border/50">
                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                    {c.budgeted === 0 && c.spent > 0 && (
                      <div className="text-xs text-yellow-600 mt-1">No budget set — {fmtCurrency(c.spent)} unbudgeted</div>
                    )}
                  </button>
                  {expanded && hasTxns && (
                    <div className="border-t border-border/60 divide-y divide-border/40">
                      {c.txns.map((t) => (
                        <Link
                          key={t.id}
                          href={`/page/${t.id}`}
                          className="flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-bg/50 transition-colors"
                        >
                          <span className="text-muted w-20 shrink-0 font-mono">{t.date || '—'}</span>
                          <span className="flex-1 truncate text-text">{t.title}</span>
                          <span className="text-red-500 font-mono shrink-0">{fmtCents(t.amount)}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const renderSpendingBreakdownView = () => {
    const amountProp = database.properties.find((p) => p.name === 'Amount');
    const categoryProp = database.properties.find((p) => p.type === 'select' && p.name === 'Category');
    const typeProp = database.properties.find((p) => p.name === 'Type');
    const dateProp = database.properties.find((p) => p.name === 'Date' && p.type === 'date');

    if (!amountProp) {
      return (
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-muted">
          Spending Breakdown requires an <strong className="text-text">Amount</strong> property.
        </div>
      );
    }

    const win = getBudgetWindow(budgetPeriod, budgetWindowDate);
    const winStartStr = `${win.start.getFullYear()}-${String(win.start.getMonth() + 1).padStart(2, '0')}-${String(win.start.getDate()).padStart(2, '0')}`;
    const winEndStr = `${win.end.getFullYear()}-${String(win.end.getMonth() + 1).padStart(2, '0')}-${String(win.end.getDate()).padStart(2, '0')}`;
    const inWindow = (dateVal: unknown) => {
      if (!dateProp) return true;
      if (!dateVal) return false;
      const s = String(dateVal).slice(0, 10);
      return s >= winStartStr && s <= winEndStr;
    };

    const fmtCurrency = (n: number) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

    const getVal = (page: (typeof renderedPages)[0], propId: string) =>
      page.properties.find((v) => v.property.id === propId)?.value ?? null;

    let totalIncome = 0;
    let totalExpenses = 0;
    const catSpend = new Map<string, number>();

    for (const page of renderedPages) {
      const type = typeProp ? String(getVal(page, typeProp.id) ?? '') : '';
      if (type === 'Budget') continue;
      const dateVal = dateProp ? getVal(page, dateProp.id) : null;
      if (!inWindow(dateVal)) continue;
      const amount = Math.abs(Number(getVal(page, amountProp.id) ?? 0));
      if (!amount) continue;
      if (type === 'Income') {
        totalIncome += amount;
      } else {
        totalExpenses += amount;
        if (categoryProp) {
          const cat = String(getVal(page, categoryProp.id) ?? 'Uncategorized') || 'Uncategorized';
          catSpend.set(cat, (catSpend.get(cat) ?? 0) + amount);
        }
      }
    }

    const net = totalIncome - totalExpenses;
    const entries = Array.from(catSpend.entries()).sort((a, b) => b[1] - a[1]);

    return (
      <div className="space-y-6">
        {renderBudgetPeriodToolbar()}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 text-center">
            <div className="text-xs text-muted uppercase tracking-wide mb-1">Income</div>
            <div className="text-xl font-bold text-green-600">{fmtCurrency(totalIncome)}</div>
          </div>
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-center">
            <div className="text-xs text-muted uppercase tracking-wide mb-1">Expenses</div>
            <div className="text-xl font-bold text-red-500">{fmtCurrency(totalExpenses)}</div>
          </div>
          <div className={`rounded-lg border p-4 text-center ${net >= 0 ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
            <div className="text-xs text-muted uppercase tracking-wide mb-1">Net</div>
            <div className={`text-xl font-bold ${net >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtCurrency(net)}</div>
          </div>
        </div>
        {categoryProp && entries.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Spending by Category</div>
            <div className="space-y-3">
              {entries.map(([cat, amount]) => {
                const pct = totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0;
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-text">{cat}</span>
                      <div className="flex items-center gap-3 text-xs text-muted">
                        <span>{fmtCurrency(amount)}</span>
                        <span className="w-10 text-right">{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="h-2.5 bg-bg rounded-full overflow-hidden border border-border/50">
                      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {entries.length === 0 && (
          <div className="text-sm text-muted text-center py-8">
            No expense transactions yet. Add rows with Amount and Category to see spending breakdown.
          </div>
        )}
      </div>
    );
  };

  const renderViewContent = (view: View) => {
    switch (view.type) {
      case 'gallery': return renderGalleryView();
      case 'list': return renderListView();
      case 'board': return renderBoardView();
      case 'calendar': return renderCalendarView();
      case 'budget-summary': return renderBudgetSummaryView();
      case 'spending-breakdown': return renderSpendingBreakdownView();
      default: return renderTableView();
    }
  };

  const renderViewConfigBar = (view: View) => {
    // Only the generic record views support filter/sort/group
    if (!['table', 'list', 'gallery', 'board'].includes(view.type)) return null;
    const f = (view as any).filters as { propertyId: string; op: string; value: string } | null;
    const s = (view as any).sorts as { propertyId: string; dir: string } | null;
    const g = (view as any).grouping as { propertyId: string } | null;
    const patch = (p: any) => {
      fetch(`/api/databases/${database.id}/views/${view.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      }).then((r) => { if (r.ok) onUpdate(); }).catch(() => {});
    };
    const props = database.properties;
    const selectProps = props.filter((p) => p.type === 'select');
    return (
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        {/* Filter */}
        <div className="flex items-center gap-1 border border-border rounded-lg px-2 py-1 bg-bg">
          <span className="text-muted">Filter</span>
          <select
            value={f?.propertyId ?? ''}
            onChange={(e) => patch({ filters: e.target.value ? { propertyId: e.target.value, op: f?.op ?? 'contains', value: f?.value ?? '' } : null })}
            className="bg-transparent text-text focus:outline-none"
          >
            <option value="">—</option>
            <option value="__title__">Name</option>
            {props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {f?.propertyId && (
            <>
              <select
                value={f.op}
                onChange={(e) => patch({ filters: { ...f, op: e.target.value } })}
                className="bg-transparent text-text focus:outline-none"
              >
                <option value="contains">contains</option>
                <option value="eq">is</option>
              </select>
              <input
                defaultValue={f.value}
                onBlur={(e) => patch({ filters: { ...f, value: e.target.value } })}
                placeholder="value"
                className="w-24 bg-surface border border-border rounded px-1 py-0.5 text-text focus:outline-none"
              />
            </>
          )}
        </div>
        {/* Sort */}
        <div className="flex items-center gap-1 border border-border rounded-lg px-2 py-1 bg-bg">
          <span className="text-muted">Sort</span>
          <select
            value={s?.propertyId ?? ''}
            onChange={(e) => patch({ sorts: e.target.value ? { propertyId: e.target.value, dir: s?.dir ?? 'asc' } : null })}
            className="bg-transparent text-text focus:outline-none"
          >
            <option value="">—</option>
            <option value="__title__">Name</option>
            {props.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {s?.propertyId && (
            <button
              onClick={() => patch({ sorts: { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } })}
              className="text-text hover:text-accent"
              title="Toggle direction"
            >
              {s.dir === 'desc' ? '↓' : '↑'}
            </button>
          )}
        </div>
        {/* Group (table only, by a select property) */}
        {view.type === 'table' && selectProps.length > 0 && (
          <div className="flex items-center gap-1 border border-border rounded-lg px-2 py-1 bg-bg">
            <span className="text-muted">Group</span>
            <select
              value={g?.propertyId ?? ''}
              onChange={(e) => patch({ grouping: e.target.value ? { propertyId: e.target.value } : null })}
              className="bg-transparent text-text focus:outline-none"
            >
              <option value="">—</option>
              {selectProps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
        {(f || s || g) && (
          <button
            onClick={() => patch({ filters: null, sorts: null, grouping: null })}
            className="text-muted hover:text-red-500 underline"
          >
            clear
          </button>
        )}
      </div>
    );
  };

  const renderViewPane = (view: View, onViewChange: (id: string) => void) => (
    <div className="min-w-0">
      <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
        {database.views.map((v) => (
          <button
            key={v.id}
            onClick={() => onViewChange(v.id)}
            className={`px-3 py-1 rounded text-sm whitespace-nowrap border transition-colors ${
              v.id === view.id
                ? 'bg-text text-bg border-text'
                : 'bg-bg text-text border-border hover:bg-surface'
            }`}
          >
            {v.name}
            <span className="ml-1.5 text-xs opacity-60">({VIEW_TYPE_LABELS[v.type] ?? v.type})</span>
          </button>
        ))}
      </div>
      {renderViewConfigBar(view)}
      {renderViewContent(view)}
    </div>
  );

  return (
    <div className={inspectPageId ? 'flex items-start gap-0' : ''}>
    <div className={`space-y-4${inspectPageId ? ' flex-1 min-w-0 overflow-x-auto' : ''}`}>
      {/* Toolbar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="New page title…"
            value={newPageTitle}
            onChange={(e) => setNewPageTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPage()}
            className="flex-1 min-w-0 sm:flex-none px-3 py-1.5 bg-bg text-text border border-border rounded focus:outline-none focus:ring-1 focus:ring-accent text-sm"
          />
          <button
            onClick={addPage}
            className="p-2 bg-accent text-white rounded hover:bg-accent/80 transition-colors"
            title="Add page"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={() => { setLinkOpen(true); setLinkSearch(''); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface text-text border border-border rounded hover:bg-border transition-colors text-sm"
            title="Attach an existing page to this database"
          >
            <Link2 size={13} />
            <span className="hidden sm:inline">Link existing</span>
            <span className="sm:hidden">Link</span>
          </button>
          <button
            onClick={() => setShowAddProperty(true)}
            className="px-3 py-1.5 bg-surface text-text border border-border rounded hover:bg-border transition-colors text-sm"
          >
            <span className="hidden sm:inline">Add Property</span>
            <span className="sm:hidden">+ Prop</span>
          </button>
          <button
            onClick={() => setShowAddView(true)}
            className="px-3 py-1.5 bg-surface text-text border border-border rounded hover:bg-border transition-colors text-sm"
          >
            <span className="hidden sm:inline">Add View</span>
            <span className="sm:hidden">+ View</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPropertyPanel((v) => !v)}
            title="Toggle property visibility"
            className={`p-2 rounded border transition-colors ${showPropertyPanel ? 'bg-accent text-white border-accent' : 'bg-surface text-text border-border hover:bg-border'}`}
          >
            <Settings size={16} />
          </button>
          <button
            onClick={() => setSplitEnabled((v) => !v)}
            title="Toggle split view"
            className={`p-2 rounded border transition-colors ${splitEnabled ? 'bg-accent text-white border-accent' : 'bg-surface text-text border-border hover:bg-border'}`}
          >
            <Columns size={16} />
          </button>
        </div>
      </div>

      {/* Property visibility panel */}
      {showPropertyPanel && (
        <div className="border border-border rounded-lg p-3 bg-surface">
          <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Property Visibility</div>
          <div className="flex flex-wrap gap-2">
            {database.properties.map((prop) => {
              const visible = !hiddenPropertyIds.has(prop.id);
              return (
                <button
                  key={prop.id}
                  onClick={() => togglePropertyVisibility(prop.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    visible ? 'bg-accent/10 text-accent border-accent/30' : 'bg-bg text-muted border-border'
                  }`}
                >
                  {visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  {prop.name}
                  <span className="opacity-60 capitalize">({prop.type})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* View content: single or split */}
      {splitEnabled && splitView ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 min-w-0">
          <div className="min-w-0 border-b md:border-b-0 md:border-r border-border pb-4 md:pb-0 md:pr-6">
            {renderViewPane(selectedView, setSelectedViewId)}
          </div>
          <div className="min-w-0">
            {renderViewPane(splitView, setSplitViewId)}
          </div>
        </div>
      ) : splitEnabled && !splitView ? (
        <div className="text-sm text-muted border border-border rounded-lg p-4 bg-surface">
          Add a second view to use split mode.
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
            {database.views.map((v) => (
              <button
                key={v.id}
                onClick={() => setSelectedViewId(v.id)}
                className={`px-3 py-1 rounded text-sm whitespace-nowrap border transition-colors ${
                  v.id === selectedViewId
                    ? 'bg-text text-bg border-text'
                    : 'bg-bg text-text border-border hover:bg-surface'
                }`}
              >
                {v.name}
                <span className="ml-1.5 text-xs opacity-60">({VIEW_TYPE_LABELS[v.type] ?? v.type})</span>
              </button>
            ))}
          </div>
          {renderViewContent(selectedView)}
        </div>
      )}

      {/* Add Property Modal */}
      {showAddProperty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddProperty(false)}>
          <div
            className="bg-bg border border-border rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-text text-lg">Add Property</h3>
              <button onClick={() => setShowAddProperty(false)} className="text-muted hover:text-text">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted font-medium uppercase tracking-wide block mb-1">Name</label>
                <input
                  autoFocus
                  type="text"
                  value={newPropName}
                  onChange={(e) => setNewPropName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddProperty()}
                  placeholder="Property name"
                  className="w-full bg-bg text-text border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div>
                <label className="text-xs text-muted font-medium uppercase tracking-wide block mb-1">Type</label>
                <select
                  value={newPropType}
                  onChange={(e) => setNewPropType(e.target.value)}
                  className="w-full bg-bg text-text border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                  <option value="checkbox">Checkbox</option>
                  <option value="select">Select</option>
                  <option value="formula">Formula</option>
                </select>
              </div>
              {newPropType === 'select' && (
                <div>
                  <label className="text-xs text-muted font-medium uppercase tracking-wide block mb-1">Options (one per line)</label>
                  <textarea
                    value={newPropOptions}
                    onChange={(e) => setNewPropOptions(e.target.value)}
                    placeholder={"To Do\nIn Progress\nDone"}
                    rows={4}
                    className="w-full bg-bg text-text border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  />
                </div>
              )}
              {newPropType === 'formula' && (
                <div>
                  <label className="text-xs text-muted font-medium uppercase tracking-wide block mb-1">Formula</label>
                  <input
                    type="text"
                    value={newPropFormula}
                    onChange={(e) => setNewPropFormula(e.target.value)}
                    placeholder="e.g. Price * Quantity"
                    className="w-full bg-bg text-text border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={handleAddProperty}
                disabled={!newPropName.trim()}
                className="flex-1 bg-accent text-white rounded px-4 py-2 text-sm font-medium hover:bg-accent/80 disabled:opacity-40 transition-colors"
              >
                Add Property
              </button>
              <button
                onClick={() => setShowAddProperty(false)}
                className="px-4 py-2 bg-surface text-text border border-border rounded text-sm hover:bg-border transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Property Modal */}
      {editPropId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeEditProperty}>
          <div
            className="bg-bg border border-border rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-text text-lg">Edit Property</h3>
              <button onClick={closeEditProperty} className="text-muted hover:text-text">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted font-medium uppercase tracking-wide block mb-1">Name</label>
                <input
                  autoFocus
                  type="text"
                  value={editPropName}
                  onChange={(e) => setEditPropName(e.target.value)}
                  className="w-full bg-bg text-text border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div>
                <label className="text-xs text-muted font-medium uppercase tracking-wide block mb-1">Type</label>
                <select
                  value={editPropType}
                  onChange={(e) => setEditPropType(e.target.value)}
                  className="w-full bg-bg text-text border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                  <option value="checkbox">Checkbox</option>
                  <option value="select">Select</option>
                  <option value="formula">Formula</option>
                </select>
                {editPropType !== editPropOriginalType && (
                  <p className="mt-1 text-[11px] text-yellow-600">
                    Type change will be confirmed on save — existing values may not match the new type.
                  </p>
                )}
              </div>
              {editPropType === 'select' && (
                <div>
                  <label className="text-xs text-muted font-medium uppercase tracking-wide block mb-1">Options (one per line)</label>
                  <textarea
                    value={editPropOptions}
                    onChange={(e) => setEditPropOptions(e.target.value)}
                    rows={5}
                    className="w-full bg-bg text-text border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  />
                </div>
              )}
              {editPropType === 'formula' && (
                <div>
                  <label className="text-xs text-muted font-medium uppercase tracking-wide block mb-1">Formula</label>
                  <input
                    type="text"
                    value={editPropFormula}
                    onChange={(e) => setEditPropFormula(e.target.value)}
                    placeholder="e.g. Price * Quantity"
                    className="w-full bg-bg text-text border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={saveEditProperty}
                disabled={!editPropName.trim()}
                className="flex-1 bg-accent text-white rounded px-4 py-2 text-sm font-medium hover:bg-accent/80 disabled:opacity-40 transition-colors"
              >
                Save
              </button>
              <button
                onClick={closeEditProperty}
                className="px-4 py-2 bg-surface text-text border border-border rounded text-sm hover:bg-border transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Link existing page modal */}
      {linkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setLinkOpen(false)}>
          <div
            className="bg-bg border border-border rounded-xl shadow-2xl p-5 w-full max-w-lg mx-4 flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-text text-lg flex items-center gap-2">
                <Link2 size={16} className="text-accent" />
                Link existing page
              </h3>
              <button onClick={() => setLinkOpen(false)} className="text-muted hover:text-text">
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-muted mb-3">
              Pick any page in your workspaces to attach it to this database. The page keeps all its
              existing blocks; it just gains rows under this database&apos;s properties.
            </p>
            <div className="relative mb-3">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                autoFocus
                value={linkSearch}
                onChange={(e) => setLinkSearch(e.target.value)}
                placeholder="Search pages…"
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-bg text-text text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 border border-border rounded-lg bg-bg p-1">
              {linkablePages.length === 0 ? (
                <p className="text-xs text-muted text-center py-6">
                  {linkSearch ? 'No pages match.' : 'No pages available to link.'}
                </p>
              ) : (
                linkablePages.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => linkPageToDb(p.id)}
                    disabled={linkBusy === p.id}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-sm hover:bg-surface text-text disabled:opacity-50 text-left"
                  >
                    <span className="w-4 text-center">{p.icon ?? '📄'}</span>
                    <span className="truncate flex-1">{p.title || 'Untitled'}</span>
                    <span className="text-xs text-muted shrink-0">
                      {linkBusy === p.id ? 'Linking…' : new Date(p.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="flex justify-end mt-3">
              <button
                onClick={() => setLinkOpen(false)}
                className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-surface"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add View Modal */}
      {showAddView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddView(false)}>
          <div
            className="bg-bg border border-border rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-text text-lg">Add View</h3>
              <button onClick={() => setShowAddView(false)} className="text-muted hover:text-text">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted font-medium uppercase tracking-wide block mb-1">Name</label>
                <input
                  autoFocus
                  type="text"
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddView()}
                  className="w-full bg-bg text-text border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div>
                <label className="text-xs text-muted font-medium uppercase tracking-wide block mb-1">Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['table', 'board', 'calendar', 'gallery', 'list', 'budget-summary', 'spending-breakdown'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setNewViewType(t)}
                      className={`px-3 py-2 rounded border text-sm capitalize transition-colors ${
                        newViewType === t
                          ? 'bg-accent text-white border-accent'
                          : 'bg-bg text-text border-border hover:bg-surface'
                      }`}
                    >
                      {VIEW_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={handleAddView}
                disabled={!newViewName.trim()}
                className="flex-1 bg-accent text-white rounded px-4 py-2 text-sm font-medium hover:bg-accent/80 disabled:opacity-40 transition-colors"
              >
                Add View
              </button>
              <button
                onClick={() => setShowAddView(false)}
                className="px-4 py-2 bg-surface text-text border border-border rounded text-sm hover:bg-border transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>{/* end space-y-4 */}

    {/* Split editor panel */}
    {inspectPageId && (
      <>
        {/* drag handle */}
        <div
          className="w-1 shrink-0 self-stretch cursor-col-resize bg-border hover:bg-accent/50 transition-colors"
          onMouseDown={startSplitResize}
        />
        {/* editor panel */}
        <div
          style={{ width: splitWidth }}
          className="shrink-0 flex flex-col sticky top-0 max-h-screen overflow-hidden border-l border-border bg-bg"
        >
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-surface shrink-0">
            <span className="text-sm font-medium text-text truncate flex-1">
              {splitPageData?.title ?? '…'}
            </span>
            <Link
              href={`/page/${inspectPageId}`}
              className="flex items-center gap-1 text-xs text-accent hover:underline shrink-0"
            >
              Full page <ExternalLink size={11} />
            </Link>
            <button
              onClick={() => setInspectPageId(null)}
              className="p-1 rounded hover:bg-bg text-muted shrink-0"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {splitPageData ? (
              <CanvasPageEditorPanel
                key={splitPageData.id}
                page={splitPageData}
                initialBlocks={splitPageData.blocks}
              />
            ) : (
              <div className="flex items-center justify-center h-32 text-sm text-muted">Loading…</div>
            )}
          </div>
        </div>
      </>
    )}
    </div>
  );
}
