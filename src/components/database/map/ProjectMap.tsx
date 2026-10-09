'use client';

import { useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { confirmDialog, toast } from '@/components/ui/feedback';
import { buildModel, detectProps, isArchived, type MapDb, type MapModel } from './mapModel';
import { MapToolbar } from './MapToolbar';
import { CycleDialog } from './CycleDialog';
import { createPage, createWaitsOn, deleteProject } from './mapApi';
import { MapNodeCard } from './MapNode';
import { MapInspector } from './MapInspector';
import { usePositions, useValueEdits } from './useMapEdits';
import { useMapPointer } from './useMapPointer';
import { useTasks } from './useTaskProgress';
import { mapPanels } from './mapPanels';

type Props = { database: MapDb; view: { id: string; grouping?: unknown }; onChanged: () => void };

const zoomBtn = 'h-11 rounded-[10px] border border-border bg-bg flex items-center justify-center';
const dots = { backgroundColor: 'rgb(var(--surface))', backgroundImage: 'radial-gradient(rgb(var(--border)) 1px, transparent 1px)', backgroundSize: '20px 20px' };

function Edges({ model, linkPath }: { model: MapModel; linkPath: string | null }) {
  return (
    <svg width={model.width} height={model.height} className="absolute left-0 top-0 pointer-events-none overflow-visible">
      <defs>
        <marker id="kv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="rgb(var(--muted))" />
        </marker>
      </defs>
      {model.edges.map((e) => (
        <path key={`${e.from}-${e.to}`} d={e.d} fill="none" stroke="rgb(var(--muted))" strokeOpacity={e.settled ? 0.9 : 0.6}
          strokeWidth={e.settled ? 2 : 1.5} strokeDasharray={e.settled ? undefined : '6 5'} markerEnd="url(#kv-arrow)" />
      ))}
      {linkPath ? <path d={linkPath} fill="none" stroke="rgb(var(--accent))" strokeWidth={2} markerEnd="url(#kv-arrow)" /> : null}
    </svg>
  );
}

function ZoomControls({ zoom, setZoom }: { zoom: number; setZoom: (f: (z: number) => number) => void }) {
  const step = (d: number) => setZoom((z) => Math.min(1.5, Math.max(0.5, Math.round((z + d) * 10) / 10)));
  return (
    <div className="absolute left-4 bottom-4 flex gap-2">
      <button type="button" aria-label="Zoom out" onClick={() => step(-0.1)} className={`${zoomBtn} w-11`}><Minus size={16} /></button>
      <button type="button" aria-label="Reset zoom" onClick={() => setZoom(() => 1)} className={`${zoomBtn} min-w-[64px] text-[13px]`}>{Math.round(zoom * 100)}%</button>
      <button type="button" aria-label="Zoom in" onClick={() => step(0.1)} className={`${zoomBtn} w-11`}><Plus size={16} /></button>
    </div>
  );
}

function Lanes({ model }: { model: MapModel }) {
  return (
    <>
      {model.lanes.map((l) => (
        <div key={l.name} className="absolute rounded-xl" style={{ left: l.x, top: l.y, width: l.w, height: l.h, background: `rgba(${l.tint},0.06)`, border: `1px solid rgba(${l.tint},0.25)` }}>
          <div className="absolute left-4 top-3 text-sm font-semibold">{l.name}</div>
        </div>
      ))}
    </>
  );
}

type OwnSource = { dbId: string; whole: boolean; name: string; count: number } | null;

async function confirmAndDelete(title: string, id: string, src: OwnSource, noun: string): Promise<boolean> {
  const own = src?.whole ? src : null;
  const message = own ? `This also deletes its task database “${own.name}” and its ${own.count} tasks.` : `This deletes the ${noun}.`;
  const ok = await confirmDialog({ title: `Delete “${title}”?`, message: `${message} It cannot be undone.`, confirmText: `Delete ${noun}`, danger: true });
  if (!ok) return false;
  try {
    await deleteProject(id, own?.dbId);
    window.dispatchEvent(new Event('kove:refresh-tree'));
    return true;
  } catch {
    toast.error('Couldn’t delete that project.');
    return false;
  }
}

export function ProjectMap({ database, view, onChanged }: Props) {
  const { merged, setValue } = useValueEdits(database, onChanged);
  const props = useMemo(() => detectProps(merged), [merged]);
  const layout = usePositions(database.id, view.id, view.grouping);
  const [showArchived, setShowArchived] = useState(false);
  const [cycleOpen, setCycleOpen] = useState(false);
  const model = useMemo(() => buildModel(merged, props, layout.positions, showArchived), [merged, props, layout.positions, showArchived]);
  const archivedCount = merged.pages.filter((p) => isArchived(p, props)).length;
  const tasks = useTasks(merged, props, (id, ids) => props.tasks && setValue(id, props.tasks, ids));
  const progress = tasks.progress;
  const [selId, setSelId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const plane = useRef<HTMLDivElement>(null);
  const pointer = useMapPointer({ model, zoom, plane, waitsOn: props.waitsOn, setValue, select: setSelId, layout });
  const selected = model.nodes.find((n) => n.id === selId) ?? model.nodes[0];
  const panels = mapPanels({ db: merged, props, tasks, setValue });
  const noun = panels.noun;
  const cycleProjects = panels.cycleProjects(model.nodes);

  const removeProject = (id: string) =>
    confirmAndDelete(model.nodes.find((n) => n.id === id)?.title ?? `this ${noun}`, id, tasks.sourceFor(id), noun)
      .then((gone) => { if (gone) setSelId(null); })
      .finally(onChanged);
  const addProject = () => createPage(database.workspaceId, database.id, `Untitled ${noun}`)
    .then((id) => { if (id) setSelId(id); onChanged(); })
    .catch(() => toast.error(`Couldn’t create a ${noun}.`));
  const addWaitsOn = () => createWaitsOn(database.id).then(onChanged).catch(() => toast.error('Couldn’t add the relation.'));

  return (
    <div className="flex flex-col border border-border rounded-xl overflow-hidden">
      <MapToolbar
        onTidy={Object.keys(layout.positions).length > 0 ? layout.tidy : undefined}
        onAdd={addProject}
        onCycle={cycleProjects.length ? () => setCycleOpen(true) : undefined}
        archived={{ count: archivedCount, shown: showArchived, toggle: () => setShowArchived((v) => !v) }}
        onAddWaitsOn={props.waitsOn ? undefined : addWaitsOn}
        noun={noun}
      />
      {cycleOpen ? (
        <CycleDialog mapDbId={database.id} projects={cycleProjects} initialLane={selected?.lane ?? null}
          onClose={(changed) => { setCycleOpen(false); if (changed) onChanged(); }} />
      ) : null}
      <div className="flex flex-col lg:flex-row min-h-[560px] lg:h-[72vh]">
        <div className="relative flex-1 min-w-0 min-h-[420px]">
          <div onMouseMove={pointer.onMove} onMouseUp={pointer.onUp} onMouseLeave={pointer.onUp} className="absolute inset-0 overflow-auto" style={dots}>
            <div style={{ position: 'relative', width: model.width * zoom, height: model.height * zoom }}>
              <div ref={plane} style={{ position: 'absolute', left: 0, top: 0, width: model.width, height: model.height, transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
                <Lanes model={model} />
                <Edges model={model} linkPath={pointer.linkPath} />
                {model.nodes.map((n) => (
                  <MapNodeCard key={n.id} node={n} selected={n.id === selected?.id} progress={progress[n.id]} empty={panels.emptySubtitle} handlers={pointer.handlers} />
                ))}
              </div>
            </div>
            {model.nodes.length === 0 ? <div className="absolute inset-0 flex items-center justify-center text-sm">No {noun}s yet. Add one to start the map.</div> : null}
          </div>
          <ZoomControls zoom={zoom} setZoom={setZoom} />
        </div>
        {selected ? (
          <MapInspector node={selected} nodes={model.nodes} props={props}
            tasks={panels.taskPanel(selected)} openHref={panels.openHref(selected.id)} onDelete={removeProject} noun={noun}
            openLabel={panels.openLabel(selected.id)}
            onSet={setValue} onSelect={setSelId} onUnpin={layout.unpin} />
        ) : null}
      </div>
    </div>
  );
}
