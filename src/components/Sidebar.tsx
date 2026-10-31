import {
  AppWindow,
  Clock3,
  Eye,
  EyeOff,
  FileText,
  LayoutGrid,
  MoreHorizontal,
  PanelsTopLeft,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Star,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { formatRelative } from "../lib/format";
import type { ActiveView, Category, Item, ViewKind } from "../types";

interface SidebarProps {
  items: Item[];
  categories: Category[];
  activeView: ActiveView;
  lastBackup: number | null;
  externalCategoryId: string | null;
  zonesVisible: boolean;
  onViewChange: (view: ActiveView) => void;
  onCreateCategory: () => void;
  onEditCategory: (category: Category) => void;
  onOpenBackups: () => void;
  onOpenSettings: () => void;
  onOpenQuickSearch: () => void;
  onOpenZones: () => void;
  onToggleZones: () => void;
  onItemDroppedOnCategory: (itemId: string, categoryId: string) => void;
}

const NAV_ICONS: Record<Exclude<ViewKind, "category">, LucideIcon> = {
  all: LayoutGrid,
  files: FileText,
  apps: AppWindow,
  favorites: Star,
  recent: Clock3,
};

export function Sidebar({
  items,
  categories,
  activeView,
  lastBackup,
  externalCategoryId,
  zonesVisible,
  onViewChange,
  onCreateCategory,
  onEditCategory,
  onOpenBackups,
  onOpenSettings,
  onOpenQuickSearch,
  onOpenZones,
  onToggleZones,
  onItemDroppedOnCategory,
}: SidebarProps) {
  const [internalDragId, setInternalDragId] = useState<string | null>(null);
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);

  const counts: Record<string, number> = {
    all: items.length,
    files: items.filter(
      (item) => item.kind === "file" || item.kind === "folder",
    ).length,
    apps: items.filter((item) => item.kind === "app").length,
    favorites: items.filter((item) => item.favorite).length,
    recent: items.filter((item) => item.lastOpened).length,
  };

  const navigation: { kind: Exclude<ViewKind, "category">; label: string }[] = [
    { kind: "all", label: "全部项目" },
    { kind: "files", label: "文件库" },
    { kind: "apps", label: "软件库" },
    { kind: "favorites", label: "收藏" },
    { kind: "recent", label: "最近打开" },
  ];

  const isCategoryActive = (category: Category) =>
    activeView.kind === "category" && activeView.categoryId === category.id;

  const categoryHover = (id: string) =>
    externalCategoryId === id || hoveredCategory === id;

  return (
    <aside className="sidebar">
      <div className="brand">
        <img className="brand-mark" src="/mark.svg" alt="" />
        <div className="brand-copy">
          <strong>DeskNest</strong>
          <span>桌面管家</span>
        </div>
      </div>

      <div className="sidebar-scroll">
        <nav className="nav-group" aria-label="资料库">
          <span className="nav-label">资料库</span>
          {navigation.map(({ kind, label }) => {
            const Icon = NAV_ICONS[kind];
            const active = activeView.kind === kind;
            return (
              <button
                key={kind}
                type="button"
                className={`nav-item ${active ? "active" : ""}`}
                onClick={() => onViewChange({ kind })}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span>{label}</span>
                <em>{counts[kind]}</em>
              </button>
            );
          })}
        </nav>

        <div className="category-section">
          <div className="section-heading">
            <span className="nav-label">我的分类</span>
            <button
              type="button"
              className="section-add"
              onClick={onCreateCategory}
              aria-label="新建分类"
              title="新建分类"
            >
              <Plus size={14} />
            </button>
          </div>

          <div className="category-list">
            {categories.map((category) => {
              const count = items.filter((item) =>
                item.categories.includes(category.id),
              ).length;
              const hovered = categoryHover(category.id);
              return (
                <div
                  key={category.id}
                  className={`category-row ${
                    isCategoryActive(category) ? "active" : ""
                  } ${hovered ? "drop-target" : ""}`}
                  data-category-id={category.id}
                  onDragOver={(event) => {
                    if (
                      internalDragId ||
                      event.dataTransfer.types.includes(
                        "application/x-desknest-item",
                      )
                    ) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setHoveredCategory(category.id);
                    }
                  }}
                  onDragLeave={() => {
                    setHoveredCategory((current) =>
                      current === category.id ? null : current,
                    );
                  }}
                  onDrop={(event) => {
                    const itemId =
                      event.dataTransfer.getData(
                        "application/x-desknest-item",
                      ) ||
                      internalDragId ||
                      "";
                    event.preventDefault();
                    setHoveredCategory(null);
                    setInternalDragId(null);
                    if (itemId) {
                      onItemDroppedOnCategory(itemId, category.id);
                    }
                  }}
                >
                  <button
                    type="button"
                    className="category-main"
                    onClick={() =>
                      onViewChange({ kind: "category", categoryId: category.id })
                    }
                  >
                    <span
                      className="category-dot"
                      style={{ backgroundColor: category.color }}
                    />
                    <span className="category-name">{category.name}</span>
                    <em>{count}</em>
                  </button>
                  <button
                    type="button"
                    className="category-edit"
                    aria-label={`编辑分类 ${category.name}`}
                    title="编辑分类"
                    onClick={() => onEditCategory(category)}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </div>
              );
            })}
            {categories.length === 0 && (
              <button
                type="button"
                className="category-empty"
                onClick={onCreateCategory}
              >
                <Plus size={13} />
                新建第一个分类
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="desktop-tools">
          <span className="nav-label">桌面工具</span>
          <button
            type="button"
            className="desktop-tool"
            onClick={onOpenQuickSearch}
          >
            <Search size={14} strokeWidth={1.8} />
            <span>快速搜索条</span>
            <kbd>Ctrl ⇧ Space</kbd>
          </button>
          <div className="desktop-tool-row">
            <button
              type="button"
              className="desktop-tool"
              onClick={onOpenZones}
            >
              <PanelsTopLeft size={14} strokeWidth={1.8} />
              <span>桌面分区</span>
            </button>
            <button
              type="button"
              className={`zone-visibility ${zonesVisible ? "on" : ""}`}
              onClick={onToggleZones}
              title={zonesVisible ? "隐藏桌面分区" : "显示桌面分区"}
              aria-label={zonesVisible ? "隐藏桌面分区" : "显示桌面分区"}
            >
              {zonesVisible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          </div>
        </div>
        <button type="button" className="backup-mini" onClick={onOpenBackups}>
          <span className="backup-mini-icon">
            <ShieldCheck size={18} strokeWidth={1.8} />
          </span>
          <span className="backup-mini-copy">
            <strong>离线备份</strong>
            <small>{formatRelative(lastBackup)}</small>
          </span>
          <span className="backup-mini-dot" />
        </button>
        <button
          type="button"
          className="settings-mini"
          onClick={onOpenSettings}
        >
          <Settings2 size={16} strokeWidth={1.8} />
          设置
          <kbd>Ctrl ,</kbd>
        </button>
      </div>
      <span className="drag-hint">
        {internalDragId ? "拖到分类上即可归档" : "拖入文件或快捷方式开始"}
      </span>
    </aside>
  );
}
