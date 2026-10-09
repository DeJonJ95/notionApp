'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { downstreamOf, selectOptions, type MapNode, type MapProp, type MapProps } from './mapModel';
import { MapTasks, type TaskPanel } from './MapTasks';

type Props = {
  node: MapNode;
  nodes: MapNode[];
  props: MapProps;
  tasks?: TaskPanel;
  openHref: string;
  openLabel: string;
  onDelete: (id: string) => void;
  noun: string;
  onSet: (pageId: string, prop: MapProp, value: unknown) => void;
  onSelect: (id: string) => void;
  onUnpin: (id: string) => void;
};

const fieldCls = 'w-full min-h-[40px] rounded-lg border border-border bg-bg px-3 text-sm focus:outline-none focus:ring-1 focus:ring-accent';

function Chip({ node, onSelect, onRemove }: { node: MapNode; onSelect: (id: string) => void; onRemove?: () => void }) {
  return (
    <div className="flex items-center gap-2 min-h-[40px] rounded-lg border border-border bg-surface pl-3 pr-1 text-sm">
      <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: node.color }} />
      <button type="button" onClick={() => onSelect(node.id)} className="flex-1 text-left truncate py-2">{node.title}</button>
      <span className="text-xs whitespace-nowrap">{node.label}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Remove ${node.title}`} className="w-8 h-8 flex items-center justify-center rounded hover:bg-border">
          <X size={14} />
        </button>
      ) : <span className="w-2" />}
    </div>
  );
}

function SelectField({ label, prop, value, onChange }: { label: string; prop: MapProp; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${fieldCls} font-normal`}>
        <option value="">None</option>
        {selectOptions(prop).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function NextField({ node, prop, onSet }: { node: MapNode; prop: MapProp; onSet: Props['onSet'] }) {
  const [draft, setDraft] = useState(node.next);
  useEffect(() => setDraft(node.next), [node.id, node.next]);
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold">
      Next action
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== node.next && onSet(node.id, prop, draft)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        placeholder="What moves this forward?"
        className={`${fieldCls} font-normal`}
      />
    </label>
  );
}

function Dependencies({ node, nodes, props, onSet, onSelect }: Props) {
  const waitsOn = props.waitsOn;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const feeds = nodes.filter((n) => n.deps.includes(node.id));
  const blocked = downstreamOf(node.id, nodes);
  const addable = nodes.filter((n) => !blocked.has(n.id) && !node.deps.includes(n.id));
  const setDeps = (ids: string[]) => waitsOn && onSet(node.id, waitsOn, ids);
  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold">Waits on</div>
        {node.deps.length === 0 ? <div className="text-sm">Nothing. It can start any time.</div> : null}
        {node.deps.map((d) => byId.get(d)).filter((n): n is MapNode => Boolean(n)).map((n) => (
          <Chip key={n.id} node={n} onSelect={onSelect} onRemove={() => setDeps(node.deps.filter((d) => d !== n.id))} />
        ))}
        {waitsOn && addable.length > 0 ? (
          <select value="" onChange={(e) => e.target.value && setDeps([...node.deps, e.target.value])} className={fieldCls} aria-label="Add a project this waits on">
            <option value="">Add a project it waits on…</option>
            {addable.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
          </select>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold">Feeds into</div>
        {feeds.length === 0 ? <div className="text-sm">Nothing downstream yet.</div> : null}
        {feeds.map((n) => <Chip key={n.id} node={n} onSelect={onSelect} />)}
      </div>
    </>
  );
}

export function MapInspector(p: Props) {
  const { node, props, tasks, onSet, onUnpin } = p;
  return (
    <section aria-label="Selected project" className="flex flex-col gap-5 p-6 border-l border-border bg-bg w-full lg:w-[320px] shrink-0 overflow-y-auto">
      <div className="flex flex-col gap-2">
        <h2 className="m-0 text-2xl font-bold leading-tight break-words">{node.title}</h2>
        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: node.status === 'waiting' ? undefined : node.color }}>
          <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: node.color }} />{node.label}
        </div>
      </div>
      {tasks ? <MapTasks {...tasks} /> : null}
      {props.status ? <SelectField label={props.status.name} prop={props.status} value={node.rawStatus} onChange={(v) => onSet(node.id, props.status!, v)} /> : null}
      {props.lane ? <SelectField label={props.lane.name} prop={props.lane} value={node.lane === 'No area' ? '' : node.lane} onChange={(v) => onSet(node.id, props.lane!, v)} /> : null}
      {props.next ? <NextField node={node} prop={props.next} onSet={onSet} /> : null}
      <Dependencies {...p} />
      {node.pinned ? (
        <div className="flex items-center justify-between gap-2 text-sm px-3 py-2.5 rounded-lg border border-dashed border-border">
          <span>Placed by hand</span>
          <button type="button" onClick={() => onUnpin(node.id)} className="min-h-[32px] px-2.5 rounded-md border border-border bg-bg text-[13px]">Snap back</button>
        </div>
      ) : null}
      <Link href={p.openHref} className="flex items-center justify-center min-h-[44px] rounded-lg bg-text text-bg text-[15px] font-semibold">
        {p.openLabel}
      </Link>
      <button type="button" onClick={() => p.onDelete(node.id)} className="min-h-[40px] rounded-lg border border-red-600/50 text-red-600 text-sm font-semibold hover:bg-red-600/10">
        Delete {p.noun}
      </button>
    </section>
  );
}
