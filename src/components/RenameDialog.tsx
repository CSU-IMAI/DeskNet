import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Item } from "../types";
import { ModalShell } from "./ModalShell";

interface RenameDialogProps {
  item: Item;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}

export function RenameDialog({ item, onClose, onSave }: RenameDialogProps) {
  const [name, setName] = useState(item.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const extension = item.kind === "file" ? item.name.lastIndexOf(".") : -1;
    input.setSelectionRange(0, extension > 0 ? extension : item.name.length);
  }, [item]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("名称不能为空");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(trimmed);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={
        item.kind === "app"
          ? "重命名软件卡片"
          : item.kind === "folder"
            ? "重命名文件夹"
            : "重命名文件"
      }
      eyebrow="重命名"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            form="rename-form"
            className="button button-primary"
            disabled={busy}
          >
            {busy && <Loader2 size={14} className="spin" />}
            保存
          </button>
        </>
      }
    >
      <form id="rename-form" className="form-stack" onSubmit={submit}>
        <label className="field">
          <span>名称</span>
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={180}
          />
        </label>
        <p className="field-hint">
          {item.kind === "file"
            ? "请保留文件扩展名，否则系统可能无法识别文件类型。"
            : item.kind === "folder"
              ? "文件夹会连同内部文件一起重命名；分类与收藏保持不变。"
              : "这里只修改 DeskNest 中显示的名称，不会重命名原始程序。"}
        </p>
        {error && <p className="form-error">{error}</p>}
      </form>
    </ModalShell>
  );
}
