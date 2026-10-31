import { useEffect, useRef } from "react";
import {
  ArrowUpRight,
  FolderOpen,
  Pencil,
  Star,
  Tags,
  Trash2,
} from "lucide-react";
import type { Item } from "../types";

interface ContextMenuProps {
  item: Item;
  x: number;
  y: number;
  onClose: () => void;
  onOpen: (item: Item) => void;
  onReveal: (item: Item) => void;
  onToggleFavorite: (item: Item) => void;
  onRename: (item: Item) => void;
  onDelete: (item: Item) => void;
  onManageCategories: (item: Item) => void;
}

export function ContextMenu({
  item,
  x,
  y,
  onClose,
  onOpen,
  onReveal,
  onToggleFavorite,
  onRename,
  onDelete,
  onManageCategories,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const left = Math.min(x, window.innerWidth - 224);
  const top = Math.min(y, window.innerHeight - 280);

  const run = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left, top }}
      role="menu"
    >
      <span className="context-title" title={item.name}>
        {item.name}
      </span>
      <button type="button" onClick={() => run(() => onOpen(item))}>
        <ArrowUpRight size={15} /> 打开
        <kbd>Enter</kbd>
      </button>
      <button type="button" onClick={() => run(() => onReveal(item))}>
        <FolderOpen size={15} /> 在文件夹中显示
      </button>
      <button
        type="button"
        onClick={() => run(() => onToggleFavorite(item))}
      >
        <Star
          size={15}
          fill={item.favorite ? "currentColor" : "none"}
        />
        {item.favorite ? "取消收藏" : "加入收藏"}
      </button>
      <button type="button" onClick={() => run(() => onManageCategories(item))}>
        <Tags size={15} /> 管理分类
      </button>
      <div className="context-separator" />
      <button type="button" onClick={() => run(() => onRename(item))}>
        <Pencil size={15} /> 重命名
      </button>
      <button
        type="button"
        className="danger"
        onClick={() => run(() => onDelete(item))}
      >
        <Trash2 size={15} /> {item.kind === "app" ? "移除映射" : "删除文件"}
      </button>
    </div>
  );
}
