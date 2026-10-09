'use client';

import type { MouseEvent } from 'react';
import { Check, Play, Eye, ArrowRight, Clock } from 'lucide-react';
import { NODE_W, NODE_H, type MapNode as Node } from './mapModel';
import type { TaskProgress } from './useTaskProgress';

const ICONS = { done: Check, active: Play, review: Eye, ready: ArrowRight, waiting: Clock };

type Props = {
  node: Node;
  selected: boolean;
  progress?: TaskProgress;
  empty: string;
  handlers: {
    onGrab: (id: string, e: MouseEvent) => void;
    onLinkStart: (id: string, e: MouseEvent) => void;
    onDrop: (id: string) => void;
    onPick: (id: string) => void;
  };
};

export function MapNodeCard({ node, selected, progress, empty, handlers }: Props) {
  const Icon = ICONS[node.status];
  const waiting = node.status === 'waiting';
  const border = selected ? '2px solid rgb(var(--accent))' : waiting ? '1.5px dashed rgb(var(--muted))' : '1px solid rgb(var(--border))';
  const pct = progress && progress.total ? Math.round((100 * progress.done) / progress.total) : 0;
  return (
    <div
      className="absolute"
      style={{ left: node.at.x, top: node.at.y, width: NODE_W, height: NODE_H }}
      onMouseUp={() => handlers.onDrop(node.id)}
    >
      <button
        type="button"
        aria-pressed={selected}
        onMouseDown={(e) => handlers.onGrab(node.id, e)}
        onClick={() => handlers.onPick(node.id)}
        className="w-full h-full flex flex-col gap-2 rounded-[10px] bg-bg text-left px-3.5 py-3 cursor-grab select-none"
        style={{ border, boxShadow: selected ? '0 0 0 4px rgb(var(--accent) / 0.15)' : '0 1px 3px rgb(0 0 0 / 0.08)' }}
      >
        <span className="flex items-center gap-2.5 min-w-0 w-full">
          <span
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: waiting ? 'transparent' : node.color, border: waiting ? `1.5px dashed ${node.color}` : 0 }}
          >
            <Icon size={16} strokeWidth={2.4} color={waiting ? node.color : '#fff'} />
          </span>
          <span className="flex flex-col min-w-0 gap-0.5">
            <span className="text-[15px] font-semibold truncate">{node.title}</span>
            <span className="text-xs font-semibold" style={{ color: waiting ? undefined : node.color }}>{node.label}</span>
          </span>
        </span>
        {progress && progress.total > 0 ? (
          <span className="flex items-center gap-2 w-full">
            <span className="flex-1 h-1 rounded bg-border overflow-hidden">
              <span className="block h-1" style={{ width: `${pct}%`, background: node.color }} />
            </span>
            <span className="text-xs whitespace-nowrap">{progress.done} of {progress.total}</span>
          </span>
        ) : null}
        <span className="text-[13px] truncate w-full">{node.subtitle || empty}</span>
      </button>
      <span className="absolute w-2.5 h-2.5 rounded-full bg-bg border-[1.5px] border-muted" style={{ left: -6, top: NODE_H / 2 - 5 }} />
      <button
        type="button"
        aria-label={`Draw a dependency from ${node.title}`}
        title="Drag onto a project that waits on this one"
        onMouseDown={(e) => handlers.onLinkStart(node.id, e)}
        className="absolute w-5 h-5 rounded-full flex items-center justify-center cursor-crosshair"
        style={{ right: -10, top: NODE_H / 2 - 10 }}
      >
        <span className="block w-2.5 h-2.5 rounded-full bg-bg border-[1.5px] border-muted" />
      </button>
    </div>
  );
}
