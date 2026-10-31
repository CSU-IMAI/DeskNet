import { FolderInput, Inbox } from "lucide-react";

interface DropOverlayProps {
  active: boolean;
  categoryName: string | null;
  importing: boolean;
}

export function DropOverlay({
  active,
  categoryName,
  importing,
}: DropOverlayProps) {
  if (!active) return null;
  return (
    <div className="drop-overlay" aria-hidden="true">
      <div className={`drop-stage ${categoryName ? "into-category" : ""}`}>
        <span className="drop-icon">
          {categoryName ? (
            <FolderInput size={38} strokeWidth={1.4} />
          ) : (
            <Inbox size={38} strokeWidth={1.4} />
          )}
        </span>
        <p className="eyebrow">
          {categoryName ? "归档到分类" : "释放以导入"}
        </p>
        <h2>
          {categoryName ? `收进「${categoryName}」` : "松开鼠标，收进 DeskNest"}
        </h2>
        <p>
          {importing
            ? "正在复制并建立索引…"
            : "文件会保存到统一资料库，快捷方式会自动识别为软件。"}
        </p>
        <span className="drop-note">DOCX · PDF · 图片 · 文件夹 · .lnk · .desktop</span>
      </div>
    </div>
  );
}
