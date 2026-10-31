import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import type { Category } from "../types";
import { ModalShell } from "./ModalShell";

const COLORS = [
  "#d96343",
  "#5f7f6b",
  "#6c7fb4",
  "#c79a4b",
  "#5e93a1",
  "#a4789c",
  "#b26e61",
  "#7b8b5f",
];

interface CategoryModalProps {
  mode: "create" | "edit";
  category?: Category;
  onClose: () => void;
  onSave: (name: string, color: string) => Promise<void>;
  onDelete?: (category: Category) => void;
}

export function CategoryModal({
  mode,
  category,
  onClose,
  onSave,
  onDelete,
}: CategoryModalProps) {
  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(category?.color ?? COLORS[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("给分类起一个名字");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(name.trim(), color);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={mode === "create" ? "新建分类" : "编辑分类"}
      eyebrow="自定义分类"
      size="sm"
      onClose={onClose}
      footer={
        <>
          {mode === "edit" && category && onDelete && (
            <button
              type="button"
              className="button button-danger-quiet push-left"
              onClick={() => onDelete(category)}
            >
              <Trash2 size={14} /> 删除分类
            </button>
          )}
          <button type="button" className="button button-quiet" onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            form="category-form"
            className="button button-primary"
            disabled={busy}
          >
            {busy && <Loader2 size={14} className="spin" />}
            {mode === "create" ? "创建分类" : "保存修改"}
          </button>
        </>
      }
    >
      <form id="category-form" className="form-stack" onSubmit={submit}>
        <label className="field">
          <span>分类名称</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={24}
            placeholder="例如：工作、设计、学习"
          />
        </label>

        <div className="field">
          <span>标记颜色</span>
          <div className="color-grid">
            {COLORS.map((option) => (
              <button
                key={option}
                type="button"
                className={`color-swatch ${color === option ? "selected" : ""}`}
                style={{ backgroundColor: option }}
                onClick={() => setColor(option)}
                aria-label={`选择颜色 ${option}`}
                aria-pressed={color === option}
              />
            ))}
          </div>
        </div>

        <div className="category-preview">
          <span className="category-dot" style={{ backgroundColor: color }} />
          <span>{name.trim() || "分类预览"}</span>
        </div>

        {error && <p className="form-error">{error}</p>}
      </form>
    </ModalShell>
  );
}
