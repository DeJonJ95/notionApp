'use client';

import { useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { confirmDialog, toast } from '@/components/ui/feedback';
import { buildModel, detectProps, isArchived, type MapDb, type MapModel } from './mapModel';
import { MapToolbar } from './MapToolbar';
import { CycleDialog, type CycleProject } from './CycleDialog';
import { createPage, createPhaseField, createWaitsOn, deleteProject, renamePage } from './mapApi';
import { useAutoZoom } from './useAutoZoom';
import { PhaseDialog } from './PhaseDialog';
import { MapNodeCard } from './MapNode';
import { MapInspector } from './MapInspector';
import { usePositions, useValueEdits } from './useMapEdits';
import { useMapPointer } from './useMapPointer';
import { useTasks } from './useTaskProgress';
import { mapPanels } from './mapPanels';

type Props = { database: MapDb; view: { id: string; grouping?: unknown }; onChanged: () => void; onOpenPage?: (id: string) => void };

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

function ZoomControls({ zoom, step, reset }: { zoom: number; step: (d: number) => void; reset: () => void }) {
  return (
    <div className="absolute left-4 bottom-4 flex gap-2">
      <button type="button" aria-label="Zoom out" onClick={() => step(-0.1)} className={`${zoomBtn} w-11`}><Minus size={16} /></button>
      <button type="button" aria-label="Fit the map" onClick={reset} className={`${zoomBtn} min-w-[64px] text-[13px]`}>{Math.round(zoom * 100)}%</button>
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

type DialogProps = {
  open: 'cycle' | 'phase' | null; dbId: string; model: MapModel; phases: string[];
  cycleProjects: CycleProject[]; lane: string | null; onClose: (changed: boolean) => void;
};

function Dialogs({ open, dbId, model, phases, cycleProjects, lane, onClose }: DialogProps) {
  if (open === 'phase') return <PhaseDialog databaseId={dbId} phases={phases} nodes={model.nodes} onClose={onClose} />;
  if (open === 'cycle') return <CycleDialog mapDbId={dbId} projects={cycleProjects} initialLane={lane} onClose={onClose} />;
  return null;
}

type ToolbarState = { pinned: number; cycles: number; hasWaitsOn: boolean; phase: { prop?: unknown } | null };
type ToolbarActions = { tidy: () => void; add: () => void; addWaitsOn: () => void; addPhaseField: () => void; open: (d: 'cycle' | 'phase') => void };

function toolbarFor(st: ToolbarState, act: ToolbarActions) {
  return {
    onTidy: st.pinned > 0 ? act.tidy : undefined,
    onAdd: act.add,
    onCycle: st.cycles ? () => act.open('cycle') : undefined,
    onAddWaitsOn: st.hasWaitsOn ? undefined : act.addWaitsOn,
    phase: st.phase ? { exists: Boolean(st.phase.prop), onAdd: act.addPhaseField, onStart: () => act.open('phase') } : undefined,
  };
}

export function ProjectMap({ database, view, onChanged, onOpenPage }: Props) {
  const { merged, setValue } = useValueEdits(database, onChanged);
  const props = useMemo(() => detectProps(merged), [merged]);
  const layout = usePositions(database.id, view.id, view.grouping);
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<'cycle' | 'phase' | null>(null);
  const model = useMemo(() => buildModel(merged, props, layout.positions, showArchived), [merged, props, layout.positions, showArchived]);
  const archivedCount = merged.pages.filter((p) => isArchived(p, props)).length;
  const tasks = useTasks(merged, props, (id, ids) => props.tasks && setValue(id, props.tasks, ids));
  const progress = tasks.progress;
  const [selId, setSelId] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const zoomer = useAutoZoom(box, model.width, model.height);
  const zoom = zoomer.zoom;
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
  const addPrereq = async (id: string, title: string) => {
    try {
      const prop = props.waitsOn ?? await createWaitsOn(database.id);
      const newId = await createPage(database.workspaceId, database.id, title);
      const deps = model.nodes.find((n) => n.id === id)?.deps ?? [];
      if (newId) setValue(id, prop, [...deps, newId]);
    } catch { toast.error(`Couldn’t add that ${noun}.`); onChanged(); }
  };
  const addPhaseField = () => createPhaseField(database.id).then(onChanged).catch(() => toast.error('Couldn’t add the Phase field.'));
  const addWaitsOn = () => createWaitsOn(database.id).then(onChanged).catch(() => toast.error('Couldn’t add the relation.'));

  return (
    <div className="flex flex-col border border-border rounded-xl overflow-hidden">
      <MapToolbar {...toolbarFor({
        pinned: Object.keys(layout.positions).length, cycles: cycleProjects.length, hasWaitsOn: Boolean(props.waitsOn), phase: panels.phase,
      }, {
        tidy: layout.tidy, add: addProject, addWaitsOn, addPhaseField, open: setDialog,
      })} noun={noun} archived={{ count: archivedCount, shown: showArchived, toggle: () => setShowArchived((v) => !v) }} />
      <Dialogs open={dialog} dbId={database.id} model={model} phases={panels.phase?.options ?? []} cycleProjects={cycleProjects}
        lane={selected?.lane ?? null} onClose={(changed) => { setDialog(null); if (changed) onChanged(); }} />
      <div className="flex flex-col lg:flex-row min-h-[560px] lg:h-[72vh]">
        <div className="relative flex-1 min-w-0 min-h-[420px]">
          <div ref={box} onMouseMove={pointer.onMove} onMouseUp={pointer.onUp} onMouseLeave={pointer.onUp} className="absolute inset-0 overflow-auto" style={dots}>
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
          <ZoomControls zoom={zoom} step={zoomer.step} reset={zoomer.reset} />
        </div>
        {selected ? (
          <MapInspector node={selected} nodes={model.nodes} props={props}
            tasks={panels.taskPanel(selected)} openHref={panels.openHref(selected.id)} onDelete={removeProject} noun={noun} onOpenPage={onOpenPage}
            onRename={(id, t) => renamePage(id, t).then(onChanged).catch(() => toast.error('Couldn’t rename that.'))} onAddPrereq={addPrereq}
            openLabel={panels.openLabel(selected.id)}
            onSet={setValue} onSelect={setSelId} onUnpin={layout.unpin} />
        ) : null}
      </div>
    </div>
  );
}
