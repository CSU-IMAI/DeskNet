import { ArrowUpRight, LockKeyhole, MoreHorizontal, Star } from "lucide-react";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";
import {
  formatBytes,
  formatDate,
  typeLabel,
} from "../lib/format";
import type { Category, Item } from "../types";
import { ItemGlyph } from "./ItemGlyph";

interface ItemRowProps {
  item: Item;
  categories: Category[];
  selected: boolean;
  onSelect: (item: Item) => void;
  onOpen: (item: Item) => void;
  onToggleFavorite: (item: Item) => void;
  onContextMenu: (item: Item, x: number, y: number) => void;
}

export function ItemRow({
  item,
  categories,
  selected,
  onSelect,
  onOpen,
  onToggleFavorite,
  onContextMenu,
}: ItemRowProps) {
  const visible = item.categories
    .map((id) => categories.find((category) => category.id === id))
    .filter((category): category is Category => Boolean(category))
    .slice(0, 2);

  const handleMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    onContextMenu(item, rect.right - 8, rect.bottom + 6);
  };

  return (
    <div
      className={`item-row ${selected ? "selected" : ""} ${
        item.missing ? "missing" : ""
      }`}
      onClick={() => onSelect(item)}
      onDoubleClick={() => onOpen(item)}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(item, event.clientX, event.clientY);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        if (event.key === "Enter") onOpen(item);
        if (event.key === " ") {
          event.preventDefault();
          onSelect(item);
        }
      }}
      onDragStart={(event: DragEvent<HTMLElement>) => {
        event.dataTransfer.setData("application/x-desknest-item", item.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      draggable
      tabIndex={0}
      role="button"
      aria-pressed={selected}
    >
      <ItemGlyph item={item} size="sm" />
      <div className="row-copy">
        <strong title={item.name}>
          {item.name}
          {item.encrypted && (
            <LockKeyhole size={11} className="row-lock" aria-label="已加密" />
          )}
        </strong>
        <span>{typeLabel(item)}</span>
      </div>
      <div className="row-categories">
        {visible.map((category) => (
          <span
            key={category.id}
            className="category-chip"
            style={{
              color: category.color,
              background: `${category.color}20`,
            }}
          >
            {category.name}
          </span>
        ))}
        {item.categories.length === 0 && (
          <span className="category-chip none">未分类</span>
        )}
      </div>
      <span className="row-size">
        {item.kind === "app" ? "软件" : formatBytes(item.size)}
      </span>
      <span className="row-date">{formatDate(item.modified)}</span>
      <div className="row-actions">
        <button
          type="button"
          className={`icon-button icon-button-sm favorite ${
            item.favorite ? "is-favorite" : ""
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(item);
          }}
          aria-label={item.favorite ? "取消收藏" : "收藏"}
        >
          <Star
            size={15}
            strokeWidth={1.8}
            fill={item.favorite ? "currentColor" : "none"}
          />
        </button>
        <button
          type="button"
          className="icon-button icon-button-sm"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(item);
          }}
          aria-label="打开"
          title="打开"
        >
          <ArrowUpRight size={15} />
        </button>
        <button
          type="button"
          className="icon-button icon-button-sm"
          onClick={handleMenu}
          aria-label="更多操作"
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
    </div>
  );
}
