import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import type { ToastMessage } from "../types";

export function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          <span className="toast-icon">
            {toast.tone === "success" && <CheckCircle2 size={18} />}
            {toast.tone === "error" && <AlertCircle size={18} />}
            {toast.tone === "info" && <Info size={18} />}
          </span>
          <div className="toast-copy">
            <strong>{toast.title}</strong>
            {toast.detail && <span>{toast.detail}</span>}
          </div>
          <button
            type="button"
            className="toast-close"
            onClick={() => onDismiss(toast.id)}
            aria-label="关闭提示"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
