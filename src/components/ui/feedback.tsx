'use client';
import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, AlertCircle, Info, X, Undo2 } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// A tiny module-level store so toasts AND imperative dialogs can be triggered
// from anywhere — event handlers, async code, non-hook modules — without
// threading a context through the whole app. <FeedbackHost/> (mounted once in
// providers) subscribes and renders.
// ─────────────────────────────────────────────────────────────────────────────

type ToastVariant = 'success' | 'error' | 'info';
type ToastItem = {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: { label: string; onClick: () => void };
  duration: number;
};
type DialogReq = {
  id: number;
  kind: 'confirm' | 'prompt';
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  defaultValue?: string;
  placeholder?: string;
  resolve: (v: any) => void;
};

let toastSeq = 1;
let dialogSeq = 1;
let toastsState: ToastItem[] = [];
let dialogState: DialogReq | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function pushToast(message: string, variant: ToastVariant, opts?: {
  action?: { label: string; onClick: () => void };
  duration?: number;
}) {
  const id = toastSeq++;
  const duration = opts?.duration ?? (opts?.action ? 6000 : 3500);
  toastsState = [...toastsState, { id, message, variant, action: opts?.action, duration }];
  emit();
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
  return id;
}
function dismissToast(id: number) {
  toastsState = toastsState.filter((t) => t.id !== id);
  emit();
}

export const toast = Object.assign(
  (message: string, variant: ToastVariant = 'info') => pushToast(message, variant),
  {
    success: (m: string) => pushToast(m, 'success'),
    error: (m: string) => pushToast(m, 'error'),
    info: (m: string) => pushToast(m, 'info'),
    /** Toast with an Undo action. The handler fires if the user clicks Undo. */
    undo: (message: string, onUndo: () => void) =>
      pushToast(message, 'info', { action: { label: 'Undo', onClick: onUndo }, duration: 6000 }),
  }
);

export function confirmDialog(opts: {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    dialogState = { id: dialogSeq++, kind: 'confirm', resolve, ...opts };
    emit();
  });
}

export function promptDialog(opts: {
  title?: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    dialogState = { id: dialogSeq++, kind: 'prompt', resolve, ...opts };
    emit();
  });
}

// ─────────────────────────────────────────────────────────────────────────────

export function FeedbackHost() {
  const [, force] = useState(0);
  const [mounted, setMounted] = useState(false);
  const promptRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setMounted(true);
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  // Autofocus the prompt input when a prompt dialog appears
  useEffect(() => {
    if (dialogState?.kind === 'prompt') {
      setTimeout(() => promptRef.current?.focus(), 30);
    }
  }, [dialogState?.id]);

  if (!mounted) return null;

  const closeDialog = (value: any) => {
    const d = dialogState;
    dialogState = null;
    emit();
    d?.resolve(value);
  };

  const variantStyles: Record<ToastVariant, string> = {
    success: 'border-green-500/30 bg-green-500/10 text-green-700',
    error: 'border-red-500/30 bg-red-500/10 text-red-600',
    info: 'border-border bg-surface text-text',
  };
  const variantIcon: Record<ToastVariant, React.ReactNode> = {
    success: <Check size={15} className="text-green-600 shrink-0" />,
    error: <AlertCircle size={15} className="text-red-500 shrink-0" />,
    info: <Info size={15} className="text-accent shrink-0" />,
  };

  return createPortal(
    <>
      {/* Toasts — bottom-center so they don't collide with the bottom-left
          mobile menu or bottom-right zoom controls */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[300] flex flex-col items-center gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none">
        {toastsState.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto w-full flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-lg text-sm backdrop-blur ${variantStyles[t.variant]}`}
          >
            {variantIcon[t.variant]}
            <span className="flex-1 leading-snug">{t.message}</span>
            {t.action && (
              <button
                onClick={() => { t.action!.onClick(); dismissToast(t.id); }}
                className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg bg-text/10 hover:bg-text/20 transition-colors shrink-0"
              >
                <Undo2 size={12} /> {t.action.label}
              </button>
            )}
            <button
              onClick={() => dismissToast(t.id)}
              className="text-muted hover:text-text shrink-0"
              aria-label="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>

      {/* Imperative confirm / prompt dialog */}
      {dialogState && (
        <div
          className="fixed inset-0 z-[310] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onMouseDown={() => closeDialog(dialogState!.kind === 'confirm' ? false : null)}
        >
          <div
            className="bg-bg border border-border rounded-2xl shadow-2xl w-full max-w-sm p-5"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {dialogState.title && (
              <h3 className="font-semibold text-text text-base mb-1.5">{dialogState.title}</h3>
            )}
            <p className="text-sm text-muted whitespace-pre-line leading-relaxed">
              {dialogState.message}
            </p>
            {dialogState.kind === 'prompt' && (
              <input
                ref={promptRef}
                defaultValue={dialogState.defaultValue ?? ''}
                placeholder={dialogState.placeholder ?? ''}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') closeDialog((e.target as HTMLInputElement).value);
                  if (e.key === 'Escape') closeDialog(null);
                }}
                className="mt-3 w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-accent"
              />
            )}
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => closeDialog(dialogState!.kind === 'confirm' ? false : null)}
                className="px-3.5 py-2 rounded-lg border border-border text-sm hover:bg-surface transition-colors"
              >
                {dialogState.cancelText ?? 'Cancel'}
              </button>
              <button
                onClick={() => {
                  if (dialogState!.kind === 'prompt') {
                    closeDialog(promptRef.current?.value ?? dialogState!.defaultValue ?? '');
                  } else {
                    closeDialog(true);
                  }
                }}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium text-white transition-colors ${
                  dialogState.danger ? 'bg-red-500 hover:bg-red-600' : 'bg-accent hover:bg-accent/80'
                }`}
              >
                {dialogState.confirmText ?? (dialogState.kind === 'prompt' ? 'OK' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
