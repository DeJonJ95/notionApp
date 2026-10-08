'use client';

import { useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { toast } from '@/components/ui/feedback';
import { buildModel, detectProps, STATUS_STYLE, type MapDb, type MapModel } from './mapModel';
import { createPage, createWaitsOn } from './mapApi';
import { MapNodeCard } from './MapNode';
import { MapInspector } from './MapInspector';
import { usePositions, useValueEdits } from './useMapEdits';
import { useMapPointer } from './useMapPointer';
import { useTasks } from './useTaskProgress';

type Props = { database: MapDb; view: { id: string; grouping?: unknown }; onChanged: () => void };

const btn = 'min-h-[36px] px-3.5 rounded-lg border border-border bg-bg text-sm hover:bg-surface';
const zoomBtn = 'h-11 rounded-[10px] border border-border bg-bg flex items-center justify-center';
const dots = { backgroundColor: 'rgb(var(--surface))', backgroundImage: 'radial-gradient(rgb(var(--border)) 1px, transparent 1px)', backgroundSize: '20px 20px' };

function Legend() {
  return (
    <div className="flex flex-wrap gap-3.5 text-xs flex-1">
      {(Object.keys(STATUS_STYLE) as (keyof typeof STATUS_STYLE)[]).map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[3px]" style={k === 'waiting' ? { border: `1px dashed ${STATUS_STYLE[k].color}` } : { background: STATUS_STYLE[k].color }} />
          {STATUS_STYLE[k].label}
        </span>
      ))}
    </div>
  );
}

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

export function ProjectMap({ database, view, onChanged }: Props) {
  const { merged, setValue } = useValueEdits(database, onChanged);
  const props = useMemo(() => detectProps(merged), [merged]);
  const layout = usePositions(database.id, view.id, view.grouping);
  const model = useMemo(() => buildModel(merged, props, layout.positions), [merged, props, layout.positions]);
  const tasks = useTasks(merged, props.tasks, (id, ids) => props.tasks && setValue(id, props.tasks, ids));
  const progress = tasks.progress;
  const [selId, setSelId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const plane = useRef<HTMLDivElement>(null);
  const pointer = useMapPointer({ model, zoom, plane, waitsOn: props.waitsOn, setValue, select: setSelId, layout });
  const selected = model.nodes.find((n) => n.id === selId) ?? model.nodes[0];

  const addProject = () => createPage(database.workspaceId, database.id, 'Untitled project')
    .then((id) => { if (id) setSelId(id); onChanged(); })
    .catch(() => toast.error('Couldn’t create a project.'));
  const addWaitsOn = () => createWaitsOn(database.id).then(onChanged).catch(() => toast.error('Couldn’t add the relation.'));

  return (
    <div className="flex flex-col border border-border rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border">
        <Legend />
        {Object.keys(layout.positions).length > 0 ? <button type="button" onClick={layout.tidy} className={btn}>Tidy layout</button> : null}
        <button type="button" onClick={addProject} className="min-h-[36px] px-3.5 rounded-lg bg-accent text-white text-sm font-semibold">New project</button>
      </div>
      {!props.waitsOn ? (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border bg-surface text-sm">
          <span className="flex-1">Arrows come from a “Waits on” relation that links projects in this database to each other.</span>
          <button type="button" onClick={addWaitsOn} className={btn}>Add “Waits on”</button>
        </div>
      ) : null}
      <div className="flex flex-col lg:flex-row min-h-[560px] lg:h-[72vh]">
        <div className="relative flex-1 min-w-0 min-h-[420px]">
          <div onMouseMove={pointer.onMove} onMouseUp={pointer.onUp} onMouseLeave={pointer.onUp} className="absolute inset-0 overflow-auto" style={dots}>
            <div style={{ position: 'relative', width: model.width * zoom, height: model.height * zoom }}>
              <div ref={plane} style={{ position: 'absolute', left: 0, top: 0, width: model.width, height: model.height, transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
                <Lanes model={model} />
                <Edges model={model} linkPath={pointer.linkPath} />
                {model.nodes.map((n) => (
                  <MapNodeCard key={n.id} node={n} selected={n.id === selected?.id} progress={progress[n.id]} handlers={pointer.handlers} />
                ))}
              </div>
            </div>
            {model.nodes.length === 0 ? <div className="absolute inset-0 flex items-center justify-center text-sm">No projects yet. Add one to start the map.</div> : null}
          </div>
          <ZoomControls zoom={zoom} setZoom={setZoom} />
        </div>
        {selected ? (
          <MapInspector node={selected} nodes={model.nodes} props={props}
            tasks={tasks.enabled ? { items: tasks.items[selected.id] ?? [], color: selected.color, toggle: tasks.toggle, add: (t) => tasks.add(selected.id, t) } : undefined}
            onSet={setValue} onSelect={setSelId} onUnpin={layout.unpin} />
        ) : null}
      </div>
    </div>
  );
}
