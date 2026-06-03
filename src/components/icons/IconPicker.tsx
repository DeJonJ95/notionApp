'use client';
import { ICON_REGISTRY, ICON_NAMES } from './registry';

// A compact grid of the curated lucide icons. Used when creating/editing a
// workspace. Renders the actual lucide components so what you pick is exactly
// what shows in the sidebar.
export function IconPicker({
  value,
  onSelect,
  onClear,
}: {
  value?: string | null;
  onSelect: (name: string) => void;
  onClear?: () => void;
}) {
  return (
    <div className="w-[244px]">
      <div className="grid grid-cols-7 gap-1 max-h-[180px] overflow-y-auto p-1">
        {ICON_NAMES.map((name) => {
          const Cmp = ICON_REGISTRY[name];
          const active = value === name;
          return (
            <button
              key={name}
              type="button"
              title={name}
              onClick={() => onSelect(name)}
              className={`flex items-center justify-center aspect-square rounded-md hover:bg-bg transition-colors ${
                active ? 'bg-accent/15 text-accent ring-1 ring-accent' : 'text-text'
              }`}
            >
              <Cmp size={17} />
            </button>
          );
        })}
      </div>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-1 w-full text-xs text-muted hover:text-text py-1.5 rounded hover:bg-bg"
        >
          Clear icon
        </button>
      )}
    </div>
  );
}
