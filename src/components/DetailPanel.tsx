import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Copy,
  FolderOpen,
  LockKeyhole,
  LockKeyholeOpen,
  Pencil,
  Plus,
  ShieldCheck,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  fileMeta,
  formatBytes,
  formatDateTime,
  typeLabel,
  withAlpha,
} from "../lib/format";
import type { Category, Item } from "../types";
import { ItemGlyph } from "./ItemGlyph";

interface DetailPanelProps {
  item: Item;
  categories: Category[];
  vaultConfigured: boolean;
  vaultUnlocked: boolean;
  onClose: () => void;
  onOpen: (item: Item) => void;
  onReveal: (item: Item) => void;
  onToggleFavorite: (item: Item) => void;
  onRename: (item: Item) => void;
  onDelete: (item: Item) => void;
  onUpdateCategories: (item: Item, categoryIds: string[]) => void;
  onCreateCategory: () => void;
  onEncrypt: (item: Item) => void;
  onDecrypt: (item: Item) => void;
  onNotify: (title: string) => void;
}

export function DetailPanel({
  item,
  categories,
  vaultConfigured,
  vaultUnlocked,
  onClose,
  onOpen,
  onReveal,
  onToggleFavorite,
  onRename,
  onDelete,
  onUpdateCategories,
  onCreateCategory,
  onEncrypt,
  onDecrypt,
  onNotify,
}: DetailPanelProps) {
  const meta =
    item.kind === "file" || item.kind === "folder"
      ? fileMeta(item.extension)
      : null;

  const toggleCategory = (categoryId: string) => {
    const next = item.categories.includes(categoryId)
      ? item.categories.filter((id) => id !== categoryId)
      : [...item.categories, categoryId];
    onUpdateCategories(item, next);
  };

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(item.path);
      onNotify("路径已复制");
    } catch {
      onNotify("复制失败，请手动选择路径");
    }
  };

  return (
    <>
      <button
        type="button"
        className="detail-scrim"
        onClick={onClose}
        aria-label="关闭详情"
      />
      <aside className="detail-panel" aria-label="项目详情">
        <div className="detail-topbar">
          <span className="eyebrow">项目详情</span>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="detail-hero">
          <ItemGlyph item={item} size="lg" />
          <div>
            <span className="detail-kind">
              {item.kind === "app" ? "软件" : "文件"}
            </span>
            <h2>{item.name}</h2>
            <p>{typeLabel(item)}</p>
          </div>
        </div>

        {item.missing && (
          <div className="missing-notice">
            <AlertTriangle size={16} />
            <span>
              目标已不在原路径。映射仍然保留，你可以重新拖入快捷方式更新。
            </span>
          </div>
        )}

        <div className="detail-actions">
          <button
            type="button"
            className="button button-primary grow"
            onClick={() => onOpen(item)}
          >
            <ArrowUpRight size={16} />
            {item.encrypted
              ? vaultUnlocked
                ? "解密并打开"
                : "输入密码并打开"
              : item.kind === "app"
                ? "启动软件"
                : item.kind === "folder"
                  ? "打开文件夹"
                  : "打开文件"}
          </button>
          <button
            type="button"
            className={`icon-button detail-fav ${item.favorite ? "active" : ""}`}
            onClick={() => onToggleFavorite(item)}
            aria-label={item.favorite ? "取消收藏" : "收藏"}
            title={item.favorite ? "取消收藏" : "收藏"}
          >
            <Star
              size={17}
              fill={item.favorite ? "currentColor" : "none"}
            />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => onReveal(item)}
            aria-label="在文件夹中显示"
            title="在文件夹中显示"
          >
            <FolderOpen size={17} />
          </button>
        </div>

        <section className="detail-section">
          <div className="detail-section-head">
            <h3>所属分类</h3>
            <button
              type="button"
              className="text-button"
              onClick={onCreateCategory}
            >
              <Plus size={12} /> 新建
            </button>
          </div>
          <div className="detail-categories">
            {categories.map((category) => {
              const checked = item.categories.includes(category.id);
              return (
                <button
                  key={category.id}
                  type="button"
                  className={`category-option ${checked ? "checked" : ""}`}
                  onClick={() => toggleCategory(category.id)}
                  aria-pressed={checked}
                >
                  <span
                    className="category-dot"
                    style={{ backgroundColor: category.color }}
                  />
                  <span>{category.name}</span>
                  {checked && <Check size={14} />}
                </button>
              );
            })}
            {categories.length === 0 && (
              <p className="muted-copy">
                还没有分类。新建一个分类，把相关文件与软件收在一起。
              </p>
            )}
          </div>
        </section>

        {item.kind === "folder" && item.contents.length > 0 && (
          <section className="detail-section">
            <div className="detail-section-head">
              <h3>文件夹内容</h3>
              <span className="folder-content-count">
                {item.contentCount} 个文件
              </span>
            </div>
            <ul className="folder-content-list">
              {item.contents.slice(0, 12).map((entry) => (
                <li key={entry.relative}>
                  <span className="folder-content-name">{entry.name}</span>
                  <span className="folder-content-meta">
                    {entry.extension ? entry.extension.toUpperCase() : "FILE"} ·{" "}
                    {formatBytes(entry.size)}
                  </span>
                </li>
              ))}
            </ul>
            {item.contents.length > 12 && (
              <p className="folder-content-more">
                还有 {item.contents.length - 12} 个文件，搜索结果中可直接按文件名查找
              </p>
            )}
            <p className="folder-content-hint">
              文件区仍只显示这个文件夹；在搜索栏输入内部文件名即可定位到它。
            </p>
          </section>
        )}

        {(item.kind === "file" || item.kind === "folder") && (
          <section className="detail-section">
            <div className="detail-section-head">
              <h3>保险箱</h3>
              <span className={`encrypted-pill ${item.encrypted ? "on" : ""}`}>
                {item.encrypted ? (
                  <>
                    <LockKeyhole size={10} /> 已加密
                  </>
                ) : (
                  "未加密"
                )}
              </span>
            </div>
            <p className="vault-detail-copy">
              {item.encrypted
                ? item.kind === "folder"
                  ? "文件夹内的文件已全部替换为分块密文；解除加密会把内部文件恢复为原格式。"
                  : "磁盘上保存的是 4 MB 分块 AES-256-GCM 密文。打开、解除加密、锁屏后再次查看都需要保险箱密码。"
                : vaultConfigured
                  ? item.kind === "folder"
                    ? "标记加密后，文件夹内所有文件都会原地替换为分块密文。"
                    : "标记加密后，文件会被原地替换为分块密文；解压查看时会自动释放临时副本。"
                  : "首次加密会要求设置保险箱密码。密码不会上传或写入备份。"}
            </p>
            <button
              type="button"
              className={`button vault-detail-button ${
                item.encrypted ? "button-quiet" : "button-soft"
              }`}
              onClick={() => (item.encrypted ? onDecrypt(item) : onEncrypt(item))}
            >
              {item.encrypted ? (
                <LockKeyholeOpen size={14} />
              ) : (
                <ShieldCheck size={14} />
              )}
              {item.encrypted
                ? item.kind === "folder"
                  ? "解除文件夹加密"
                  : "解除加密"
                : item.kind === "folder"
                  ? "加密整个文件夹"
                  : "加密此文件"}
            </button>
          </section>
        )}

        <section className="detail-section">
          <h3>信息</h3>
          <dl className="info-list">
            <div>
              <dt>类型</dt>
              <dd>{typeLabel(item)}</dd>
            </div>
            {(item.kind === "file" || item.kind === "folder") && (
              <div>
                <dt>大小</dt>
                <dd>{formatBytes(item.size)}</dd>
              </div>
            )}
            <div>
              <dt>修改时间</dt>
              <dd>{formatDateTime(item.modified)}</dd>
            </div>
            {item.lastOpened && (
              <div>
                <dt>最近打开</dt>
                <dd>{formatDateTime(item.lastOpened)}</dd>
              </div>
            )}
            {item.kind === "app" && item.target && item.target !== item.path && (
              <div>
                <dt>启动目标</dt>
                <dd className="path-value">{item.target}</dd>
              </div>
            )}
            {item.kind === "file" && item.source && (
              <div>
                <dt>位于</dt>
                <dd>{item.source.replace(/^位于/, "").trim()}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="detail-section">
          <div className="detail-section-head">
            <h3>位置</h3>
            <button type="button" className="text-button" onClick={copyPath}>
              <Copy size={12} /> 复制
            </button>
          </div>
          <p className="path-box" title={item.path}>
            {item.path}
          </p>
        </section>

        <div className="detail-footer">
          <button
            type="button"
            className="button button-quiet"
            onClick={() => onRename(item)}
          >
            <Pencil size={14} /> 重命名
          </button>
          <button
            type="button"
            className="button button-danger-quiet"
            onClick={() => onDelete(item)}
          >
            <Trash2 size={14} />
            {item.kind === "app" ? "移除映射" : "删除文件"}
          </button>
        </div>
        <p className="detail-footnote">
          {item.kind === "app"
            ? "移除映射只会删除 DeskNest 中的软件卡片和快捷方式副本，不会卸载原软件。"
            : "删除会将文件移入系统回收站，同时清理它的分类与收藏记录。"}
        </p>

        {item.kind === "file" && meta && (
          <span
            className="detail-accent"
            style={{ background: withAlpha("#d96343", 0.06) }}
          />
        )}
      </aside>
    </>
  );
}
