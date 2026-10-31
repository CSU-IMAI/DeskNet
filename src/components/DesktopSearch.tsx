import { ArrowUpRight, Search } from "lucide-react";
import { api } from "../lib/api";

export function DesktopSearch() {
  return (
    <button
      type="button"
      className="desktop-search-capsule"
      onClick={() => void api.showQuickSearch()}
      title="打开快速搜索（Ctrl + Shift + Space）"
      aria-label="打开快速搜索"
    >
      <span className="desktop-search-icon">
        <Search size={16} strokeWidth={1.9} />
      </span>
      <span className="desktop-search-copy">
        <strong>快速搜索</strong>
        <small>文件、软件、格式、分类</small>
      </span>
      <kbd>Ctrl ⇧ Space</kbd>
      <ArrowUpRight size={14} className="desktop-search-open" />
    </button>
  );
}
