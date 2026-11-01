import {
  ArrowUpRight,
  FolderOpen,
  Info,
  Loader2,
  LockKeyhole,
  Moon,
  MonitorDown,
  PanelsTopLeft,
  Pencil,
  Search,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { useState } from "react";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { api, isDesktopRuntime } from "../lib/api";
import { formatDateTime, formatBytes } from "../lib/format";
import type { DesktopSettings, StorageInfo, Theme } from "../types";
import { ModalShell } from "./ModalShell";

interface SettingsModalProps {
  storage: StorageInfo;
  desktop: DesktopSettings;
  vaultConfigured: boolean;
  vaultUnlocked: boolean;
  version: string;
  platform: string;
  theme: Theme;
  onClose: () => void;
  onThemeChange: (theme: Theme) => void;
  onZoneOpacityChange: (opacity: number) => void;
  onOpenFolder: (kind: "library" | "backups" | "data" | "shortcuts") => void;
  onOpenBackups: () => void;
  onImportDesktop: () => void;
  onOpenQuickSearch: () => void;
  onOpenZones: () => void;
  onOpenVault: () => void;
}

export function SettingsModal({
  storage,
  desktop,
  vaultConfigured,
  vaultUnlocked,
  version,
  platform,
  theme,
  onClose,
  onThemeChange,
  onZoneOpacityChange,
  onOpenFolder,
  onOpenBackups,
  onImportDesktop,
  onOpenQuickSearch,
  onOpenZones,
  onOpenVault,
}: SettingsModalProps) {
  const platformLabel =
    platform === "windows" ? "Windows" : platform === "linux" ? "Linux" : platform;
  const [pathBusy, setPathBusy] = useState<"library" | "backups" | null>(null);
  const [pathError, setPathError] = useState("");

  const changePath = async (kind: "library" | "backups") => {
    if (!isDesktopRuntime) {
      setPathError("目录修改只在桌面应用中可用");
      return;
    }
    const selected = await open({
      directory: true,
      multiple: false,
      title: kind === "library" ? "选择新的资料库目录" : "选择新的备份目录",
    });
    if (typeof selected !== "string") return;
    const accepted = await confirm(
      `现有的${kind === "library" ? "资料库文件" : "备份文件"}会复制到新目录，完成后 DeskNest 会自动重启。`,
      { title: "更改存储位置", kind: "warning" },
    );
    if (!accepted) return;
    setPathBusy(kind);
    setPathError("");
    try {
      await api.changeStoragePath(kind, selected);
    } catch (reason) {
      setPathError(reason instanceof Error ? reason.message : String(reason));
      setPathBusy(null);
    }
  };

  return (
    <ModalShell
      title="设置"
      eyebrow="DeskNest 偏好"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="modal-footnote">
            DeskNest {version} · {platformLabel}
          </span>
          <button type="button" className="button button-primary" onClick={onClose}>
            完成
          </button>
        </>
      }
    >
      <section className="settings-section">
        <div className="settings-heading">
          <h3>外观</h3>
          <p>跟随你的工作光线切换。</p>
        </div>
        <div className="theme-options">
          <button
            type="button"
            className={`theme-card ${theme === "light" ? "selected" : ""}`}
            onClick={() => onThemeChange("light")}
          >
            <span className="theme-swatch light">
              <Sun size={18} />
            </span>
            <span>
              <strong>浅色</strong>
              <small>温暖纸张与深绿侧栏</small>
            </span>
          </button>
          <button
            type="button"
            className={`theme-card ${theme === "dark" ? "selected" : ""}`}
            onClick={() => onThemeChange("dark")}
          >
            <span className="theme-swatch dark">
              <Moon size={18} />
            </span>
            <span>
              <strong>深色</strong>
              <small>低亮度，适合夜间</small>
            </span>
          </button>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-heading">
          <h3>桌面工具</h3>
          <p>置于桌面之上的两个轻量入口。</p>
        </div>
        <div className="desktop-settings-grid">
          <button
            type="button"
            className="desktop-settings-card"
            onClick={onOpenQuickSearch}
          >
            <span className="desktop-settings-icon">
              <Search size={18} />
            </span>
            <span>
              <strong>浮动搜索条</strong>
              <small>全局快捷键 Ctrl + Shift + Space</small>
            </span>
          </button>
          <button
            type="button"
            className="desktop-settings-card"
            onClick={onOpenZones}
          >
            <span className="desktop-settings-icon">
              <PanelsTopLeft size={18} />
            </span>
            <span>
              <strong>桌面分区</strong>
              <small>
                {desktop.zones.length} 个分区 ·{" "}
                {desktop.zonesVisible ? "正在桌面显示" : "当前隐藏"}
              </small>
            </span>
          </button>
          <button
            type="button"
            className="desktop-settings-card"
            onClick={onOpenVault}
          >
            <span className="desktop-settings-icon vault-card-icon">
              <LockKeyhole size={18} />
            </span>
            <span>
              <strong>文件保险箱</strong>
              <small>
                {vaultConfigured
                  ? vaultUnlocked
                    ? "已解锁"
                    : "已锁定"
                  : "未设置密码"}
              </small>
            </span>
          </button>
        </div>
        <div className="zone-opacity-setting">
          <div>
            <strong>分区统一透明度</strong>
            <small>中心更通透，向四周平滑变实；数值越高，边缘越不透明。</small>
          </div>
          <div className="zone-opacity-control">
            <input
              type="range"
              min={25}
              max={95}
              step={1}
              value={Math.round((desktop.zoneOpacity || 0.78) * 100)}
              onChange={(event) =>
                onZoneOpacityChange(Number(event.target.value) / 100)
              }
              aria-label="桌面分区统一透明度"
            />
            <span>{Math.round((desktop.zoneOpacity || 0.78) * 100)}%</span>
          </div>
        </div>
        <p className="settings-inline-note">
          分区里的文件或软件直接点击即可打开；拖动分区标题移动位置，拖动右下角调整大小。
          全局快捷键 Ctrl + Shift + D 可快速显示或隐藏分区。
        </p>
      </section>

      <section className="settings-section">
        <div className="settings-heading">
          <h3>资料与备份</h3>
          <p>所有数据都在本机，备份是普通 ZIP 文件。</p>
        </div>
        <div className="storage-summary">
          <div>
            <span>资料库</span>
            <strong>{storage.fileCount} 个文件</strong>
          </div>
          <div>
            <span>软件映射</span>
            <strong>{storage.appCount} 个软件</strong>
          </div>
          <div>
            <span>占用空间</span>
            <strong>{formatBytes(storage.totalSize)}</strong>
          </div>
          <div>
            <span>最近备份</span>
            <strong>{formatDateTime(storage.lastBackup)}</strong>
          </div>
        </div>
        <div className="path-rows">
          <div className="path-row">
            <div>
              <span>资料库目录</span>
              <code title={storage.libraryPath}>{storage.libraryPath}</code>
            </div>
            <div className="path-actions">
              <button
                type="button"
                className="icon-button"
                onClick={() => void changePath("library")}
                disabled={pathBusy !== null}
                title="更改资料库目录"
                aria-label="更改资料库目录"
              >
                {pathBusy === "library" ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Pencil size={15} />
                )}
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => onOpenFolder("library")}
                title="打开资料库"
                aria-label="打开资料库目录"
              >
                <FolderOpen size={16} />
              </button>
            </div>
          </div>
          <div className="path-row">
            <div>
              <span>备份目录</span>
              <code title={storage.backupPath}>{storage.backupPath}</code>
            </div>
            <div className="path-actions">
              <button
                type="button"
                className="icon-button"
                onClick={() => void changePath("backups")}
                disabled={pathBusy !== null}
                title="更改备份目录"
                aria-label="更改备份目录"
              >
                {pathBusy === "backups" ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Pencil size={15} />
                )}
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => onOpenFolder("backups")}
                title="打开备份目录"
                aria-label="打开备份目录"
              >
                <FolderOpen size={16} />
              </button>
            </div>
          </div>
        </div>
        {pathError && <p className="form-error">{pathError}</p>}
        <p className="path-hint">
          更改目录会迁移现有内容并重启应用；请选择一个空目录。
        </p>
        <div className="settings-actions">
          <button type="button" className="button button-ghost" onClick={onOpenBackups}>
            <ShieldCheck size={15} /> 管理离线备份
          </button>
          <button type="button" className="button button-ghost" onClick={onImportDesktop}>
            <MonitorDown size={15} /> 从桌面导入快捷方式
          </button>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-heading">
          <h3>快捷操作</h3>
          <p>少动手，多做事。</p>
        </div>
        <div className="shortcut-grid">
          <div>
            <kbd>Ctrl</kbd>
            <kbd>K</kbd>
            <span>聚焦搜索</span>
          </div>
          <div>
            <kbd>双击</kbd>
            <span>打开文件或启动软件</span>
          </div>
          <div>
            <kbd>拖动</kbd>
            <span>拖到左侧分类即可归档</span>
          </div>
          <div>
            <kbd>右键</kbd>
            <span>打开与分类管理菜单</span>
          </div>
        </div>
      </section>

      <section className="settings-section about-section">
        <div className="about-mark">
          <img src="/mark.svg" alt="" />
          <div>
            <strong>DeskNest 桌面管家</strong>
            <span>把散落的桌面，收进一个安静的地方。</span>
          </div>
        </div>
        <div className="about-links">
          <span>
            <Info size={13} /> 版本 {version}
          </span>
          <span>
            <ArrowUpRight size={13} /> 本地优先 · 无账号 · 无遥测
          </span>
        </div>
      </section>
    </ModalShell>
  );
}
