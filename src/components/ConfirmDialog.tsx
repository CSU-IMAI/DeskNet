import { AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";
import { ModalShell } from "./ModalShell";

interface ConfirmDialogProps {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}

export function ConfirmDialog({
  title,
  message,
  detail,
  confirmLabel = "确认",
  tone = "primary",
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={title}
      eyebrow="请确认"
      size="sm"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button
            type="button"
            className="button button-quiet"
            onClick={onClose}
            disabled={busy}
          >
            取消
          </button>
          <button
            type="button"
            className={`button ${tone === "danger" ? "button-danger" : "button-primary"}`}
            onClick={confirm}
            disabled={busy}
          >
            {busy && <Loader2 size={14} className="spin" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className={`confirm-copy ${tone === "danger" ? "danger" : ""}`}>
        {tone === "danger" && (
          <span className="confirm-icon">
            <AlertTriangle size={20} />
          </span>
        )}
        <div>
          <p>{message}</p>
          {detail && <small>{detail}</small>}
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
    </ModalShell>
  );
}
