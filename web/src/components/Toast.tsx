/**
 * One toast region, bottom-centre, one toast at a time, 5 s, dismissible,
 * `role="status"` (SPEC §5.4). Used instead of native dialogs everywhere.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { Icon } from "./Icon";

export interface ToastInput {
  message: string;
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<(toast: ToastInput) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastInput & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((next: ToastInput) => setToast({ ...next, id: Date.now() }), []);

  useEffect(() => {
    if (!toast) return;
    timer.current = setTimeout(() => setToast(null), 5000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toast ? (
          <div className="toast" key={toast.id}>
            <p>{toast.message}</p>
            {toast.action ? (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  toast.action?.onClick();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
            <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => setToast(null)}>
              <Icon name="close" />
            </button>
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (toast: ToastInput) => void {
  return useContext(ToastContext);
}
