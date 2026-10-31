import {
  FilePlus2,
  FolderPlus,
  MonitorDown,
  SearchX,
  Sparkles,
} from "lucide-react";

interface EmptyStateProps {
  query: string;
  viewLabel: string;
  isCategory: boolean;
  onImportFiles: () => void;
  onImportDesktop: () => void;
  onClearSearch: () => void;
}

export function EmptyState({
  query,
  viewLabel,
  isCategory,
  onImportFiles,
  onImportDesktop,
  onClearSearch,
}: EmptyStateProps) {
  if (query) {
    return (
      <div className="empty-state search-empty">
        <span className="empty-icon">
          <SearchX size={28} strokeWidth={1.5} />
        </span>
        <p className="eyebrow">没有匹配项</p>
        <h2>没有找到「{query}」</h2>
        <p className="empty-copy">
          试试更短的关键词，或者按文件格式搜索，例如 PDF、DOCX、FIG。
        </p>
        <button type="button" className="button button-ghost" onClick={onClearSearch}>
          清空搜索
        </button>
      </div>
    );
  }

  if (isCategory) {
    return (
      <div className="empty-state">
        <span className="empty-icon">
          <FolderPlus size={28} strokeWidth={1.5} />
        </span>
        <p className="eyebrow">{viewLabel}</p>
        <h2>这个分类还空着</h2>
        <p className="empty-copy">
          把文件卡片拖到左侧分类上，或在项目的详情面板里勾选分类。
        </p>
        <button type="button" className="button button-primary" onClick={onImportFiles}>
          <FilePlus2 size={16} /> 导入到资料库
        </button>
      </div>
    );
  }

  return (
    <div className="empty-state hero-empty">
      <div className="empty-art" aria-hidden="true">
        <span className="paper paper-a">DOCX</span>
        <span className="paper paper-b">PDF</span>
        <span className="paper paper-c">APP</span>
        <span className="empty-spark">
          <Sparkles size={18} />
        </span>
      </div>
      <p className="eyebrow">一个入口，全部桌面</p>
      <h2>把文件和软件，收进同一个地方</h2>
      <p className="empty-copy">
        拖入 DOCX、图片、文件夹或软件快捷方式。DeskNest 会复制到统一资料库、
        建立可搜索索引，并把快捷方式映射成可一键启动的软件卡片。
      </p>
      <div className="empty-actions">
        <button type="button" className="button button-primary" onClick={onImportFiles}>
          <FilePlus2 size={16} /> 选择文件
        </button>
        <button type="button" className="button button-ghost" onClick={onImportDesktop}>
          <MonitorDown size={16} /> 从桌面导入快捷方式
        </button>
      </div>
      <div className="empty-support">
        <span>支持</span>
        <em>PDF</em>
        <em>DOCX</em>
        <em>图片</em>
        <em>文件夹</em>
        <em>.lnk</em>
        <em>.desktop</em>
      </div>
    </div>
  );
}
