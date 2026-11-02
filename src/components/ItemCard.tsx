import { ArrowUpRight, LockKeyhole, MoreHorizontal, Star } from "lucide-react";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";
import {
  formatBytes,
  formatDate,
  withAlpha,
} from "../lib/format";
import type { Category, Item } from "../types";
import { ItemGlyph } from "./ItemGlyph";

interface ItemCardProps {
  item: Item;
  categories: Category[];
  selected: boolean;
  onSelect: (item: Item) => void;
  onOpen: (item: Item) => void;
  onToggleFavorite: (item: Item) => void;
  onContextMenu: (item: Item, x: number, y: number) => void;
}

export function ItemCard({
  item,
  categories,
  selected,
  onSelect,
  onOpen,
  onToggleFavorite,
  onContextMenu,
}: ItemCardProps) {
  const chips = item.categories
    .map((id) => categories.find((category) => category.id === id))
    .filter((category): category is Category => Boolean(category))
    .slice(0, 2);
  const more = Math.max(0, item.categories.length - chips.length);
  const meta =
    item.kind === "app"
      ? item.source || "软件"
      : item.kind === "folder"
        ? `${item.contentCount} 个文件 · ${formatBytes(item.size)}`
        : item.source?.startsWith("位于")
          ? `${item.source} · ${formatBytes(item.size)}`
          : `${formatBytes(item.size)} · ${formatDate(item.modified)}`;

  const handleMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    onContextMenu(item, rect.right - 8, rect.bottom + 6);
  };

  return (
    <article
      className={`item-card ${selected ? "selected" : ""} ${
        item.missing ? "missing" : ""
      }`}
      onClick={() => onSelect(item)}
      onDoubleClick={() => onOpen(item)}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(item, event.clientX, event.clientY);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onOpen(item);
        }
        if (event.key === " ") {
          event.preventDefault();
          onSelect(item);
        }
      }}
      onDragStart={(event: DragEvent<HTMLElement>) => {
        event.dataTransfer.setData("application/x-desknest-item", item.id);
        event.dataTransfer.setData("text/plain", item.name);
        event.dataTransfer.effectAllowed = "move";
      }}
      draggable
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      data-item-id={item.id}
    >
      <div className="card-head">
        <ItemGlyph item={item} />
        <div className="card-head-actions">
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
            title={item.favorite ? "取消收藏" : "收藏"}
          >
            <Star
              size={15}
              strokeWidth={1.8}
              fill={item.favorite ? "currentColor" : "none"}
            />
          </button>
          <button
            type="button"
            className="icon-button icon-button-sm card-more"
            onClick={handleMenu}
            aria-label="更多操作"
            title="更多操作"
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      <div className="card-copy">
        <h3 className="item-name" title={item.name}>
          {item.name}
        </h3>
        <p className="item-sub">{meta}</p>
      </div>

      <div className="card-foot">
        <div className="item-chips">
          {chips.map((category) => (
            <span
              key={category.id}
              className="category-chip"
              style={{
                color: category.color,
                background: withAlpha(category.color, 0.13),
              }}
            >
              {category.name}
            </span>
          ))}
          {more > 0 && <span className="category-chip more">+{more}</span>}
          {chips.length === 0 && (
            <span className="category-chip none">未分类</span>
          )}
          {item.encrypted && (
            <span className="encrypted-badge">
              <LockKeyhole size={9} /> 加密
            </span>
          )}
          {item.missing && <span className="missing-badge">目标缺失</span>}
        </div>
        <span className="open-hint" aria-hidden="true">
          <ArrowUpRight size={13} />
        </span>
      </div>
    </article>
  );
}
