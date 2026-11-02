import {
  Loader2,
  LockKeyhole,
  LockKeyholeOpen,
  MonitorDown,
  Moon,
  PanelsTopLeft,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import type { RefObject } from "react";
import { isDesktopRuntime } from "../lib/api";
import type { Theme } from "../types";

interface TopbarProps {
  query: string;
  searchRef: RefObject<HTMLInputElement | null>;
  theme: Theme;
  importing: boolean;
  loading: boolean;
  vaultConfigured: boolean;
  vaultUnlocked: boolean;
  desktopMode: boolean;
  onQueryChange: (value: string) => void;
  onClearQuery: () => void;
  onImportFiles: () => void;
  onImportDesktop: () => void;
  onRefresh: () => void;
  onScan: () => void;
  onOpenBackups: () => void;
  onOpenVault: () => void;
  onToggleDesktopMode: () => void;
  onToggleTheme: () => void;
}

export function Topbar({
  query,
  searchRef,
  theme,
  importing,
  loading,
  vaultConfigured,
  vaultUnlocked,
  desktopMode,
  onQueryChange,
  onClearQuery,
  onImportFiles,
  onImportDesktop,
  onRefresh,
  onScan,
  onOpenBackups,
  onOpenVault,
  onToggleDesktopMode,
  onToggleTheme,
}: TopbarProps) {
  return (
    <header className="topbar">
      <div className="search-wrap">
        <Search className="search-icon" size={18} strokeWidth={1.8} />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClearQuery();
              event.currentTarget.blur();
            }
          }}
          placeholder="搜索文件、软件、格式或分类…"
          aria-label="搜索文件、软件、格式或分类"
          spellCheck={false}
        />
        {query ? (
          <button
            type="button"
            className="search-clear"
            onClick={onClearQuery}
            aria-label="清空搜索"
          >
            <X size={14} />
          </button>
        ) : (
          <kbd className="search-kbd">Ctrl K</kbd>
        )}
      </div>

      {!isDesktopRuntime && (
        <span className="preview-badge" title="当前在浏览器中预览，数据为演示内容">
          预览模式
        </span>
      )}

      <div className="topbar-actions">
        <button
          type="button"
          className={`button desktop-mode-button ${desktopMode ? "active" : ""}`}
          onClick={onToggleDesktopMode}
          title={
            desktopMode
              ? "关闭桌面模式（隐藏透明分区与搜索条）"
              : "一键开启桌面模式（透明分区 + 搜索条）"
          }
        >
          <PanelsTopLeft size={15} strokeWidth={1.8} />
          <span>桌面模式</span>
          <i />
        </button>
        <button
          type="button"
          className="button button-quiet scan-index-button"
          onClick={onScan}
          disabled={loading}
          title="重新扫描资料库，并重建文件夹内容索引"
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} />
          <span>扫描内容</span>
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onRefresh}
          disabled={loading}
          title="刷新资料库"
          aria-label="刷新资料库"
        >
          <RefreshCw
            size={17}
            className={loading ? "spin" : ""}
            strokeWidth={1.8}
          />
        </button>
        <button
          type="button"
          className={`icon-button vault-button ${
            vaultUnlocked ? "unlocked" : ""
          }`}
          onClick={onOpenVault}
          title={
            !vaultConfigured
              ? "设置文件保险箱"
              : vaultUnlocked
                ? "保险箱已解锁"
                : "解锁保险箱"
          }
          aria-label="文件保险箱"
        >
          {vaultUnlocked ? (
            <LockKeyholeOpen size={17} strokeWidth={1.8} />
          ) : (
            <LockKeyhole size={17} strokeWidth={1.8} />
          )}
          {vaultConfigured && <i />}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onOpenBackups}
          title="离线备份"
          aria-label="打开离线备份"
        >
          <ShieldCheck size={18} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onToggleTheme}
          title={theme === "light" ? "切换到深色" : "切换到浅色"}
          aria-label="切换主题"
        >
          {theme === "light" ? (
            <Moon size={17} strokeWidth={1.8} />
          ) : (
            <Sun size={17} strokeWidth={1.8} />
          )}
        </button>
        <span className="topbar-divider" />
        <button
          type="button"
          className="button button-ghost desktop-import"
          onClick={onImportDesktop}
          disabled={importing}
        >
          <MonitorDown size={16} strokeWidth={1.8} />
          <span>桌面导入</span>
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={onImportFiles}
          disabled={importing}
        >
          {importing ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <Plus size={17} strokeWidth={2} />
          )}
          <span>{importing ? "正在导入" : "导入文件"}</span>
        </button>
      </div>
    </header>
  );
}
