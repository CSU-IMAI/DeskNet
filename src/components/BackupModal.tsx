import {
  Archive,
  Download,
  FolderOpen,
  KeyRound,
  Loader2,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
  WifiOff,
} from "lucide-react";
import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, isDesktopRuntime } from "../lib/api";
import {
  formatBackupKind,
  formatBytes,
  formatDateTime,
  formatRelative,
} from "../lib/format";
import type {
  BackupInfo,
  BackupManifest,
  Bootstrap,
  Settings,
} from "../types";
import { ModalShell } from "./ModalShell";

interface BackupModalProps {
  backups: BackupInfo[];
  manifest: BackupManifest | null;
  loading: boolean;
  creating: boolean;
  restoringPath: string | null;
  settings: Settings;
  lastBackup: number | null;
  onClose: () => void;
  onCreate: () => void;
  onRestore: (backup: BackupInfo) => void;
  onDelete: (backup: BackupInfo) => void;
  onOpenFolder: () => void;
  onToggleAuto: (value: boolean) => void;
  onRetentionChange: (value: number) => void;
  onIntervalChange: (value: Settings["backupInterval"]) => void;
  onToggleChange: (value: boolean) => void;
  onPackageRestored: (payload: Bootstrap) => Promise<void>;
}

export function BackupModal({
  backups,
  manifest,
  loading,
  creating,
  restoringPath,
  settings,
  lastBackup,
  onClose,
  onCreate,
  onRestore,
  onDelete,
  onOpenFolder,
  onToggleAuto,
  onRetentionChange,
  onIntervalChange,
  onToggleChange,
  onPackageRestored,
}: BackupModalProps) {
  const [packageMode, setPackageMode] = useState<"export" | "restore" | null>(
    null,
  );
  const [packagePath, setPackagePath] = useState("");
  const [packagePassword, setPackagePassword] = useState("");
  const [packageConfirm, setPackageConfirm] = useState("");
  const [packageBusy, setPackageBusy] = useState(false);
  const [packageError, setPackageError] = useState("");
  const [packageSuccess, setPackageSuccess] = useState("");

  const chooseExport = async () => {
    if (!isDesktopRuntime) {
      setPackageError("加密备份包只在桌面应用中可用");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const selected = await save({
      title: "导出 DeskNest 加密备份包",
      defaultPath: `DeskNest-Backup-${stamp}.dnb`,
      filters: [{ name: "DeskNest 加密备份包", extensions: ["dnb"] }],
    });
    if (typeof selected !== "string") return;
    setPackagePath(selected);
    setPackageMode("export");
    setPackagePassword("");
    setPackageConfirm("");
    setPackageError("");
    setPackageSuccess("");
  };

  const chooseRestore = async () => {
    if (!isDesktopRuntime) {
      setPackageError("加密备份包只在桌面应用中可用");
      return;
    }
    const selected = await open({
      title: "选择 DeskNest 加密备份包",
      multiple: false,
      filters: [{ name: "DeskNest 加密备份包", extensions: ["dnb"] }],
    });
    if (typeof selected !== "string") return;
    setPackagePath(selected);
    setPackageMode("restore");
    setPackagePassword("");
    setPackageConfirm("");
    setPackageError("");
    setPackageSuccess("");
  };

  const submitPackage = async () => {
    if (!packagePath || !packagePassword) return;
    if (packagePassword.length < 6) {
      setPackageError("密码至少需要 6 个字符");
      return;
    }
    if (packageMode === "export" && packagePassword !== packageConfirm) {
      setPackageError("两次输入的密码不一致");
      return;
    }
    setPackageBusy(true);
    setPackageError("");
    try {
      if (packageMode === "export") {
        const info = await api.exportBackupPackage(
          packagePath,
          packagePassword,
        );
        setPackageSuccess(
          `已导出 ${info.name} · ${formatBytes(info.size)} · 含 ${info.includedBackups} 份快照`,
        );
        setPackageMode(null);
        setPackagePassword("");
        setPackageConfirm("");
      } else {
        const payload = await api.restoreBackupPackage(
          packagePath,
          packagePassword,
        );
        await onPackageRestored(payload);
        onClose();
      }
    } catch (reason) {
      setPackageError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPackageBusy(false);
    }
  };
  return (
    <ModalShell
      title="离线备份"
      eyebrow="本地 ZIP · 不上传云端"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={onOpenFolder}>
            <FolderOpen size={15} /> 打开备份目录
          </button>
          <button type="button" className="button button-primary" onClick={onCreate} disabled={creating}>
            {creating ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
            {creating ? "正在打包…" : "立即完整备份"}
          </button>
        </>
      }
    >
      <div className="backup-overview">
        <span className="backup-hero-icon">
          <ShieldCheck size={26} strokeWidth={1.6} />
        </span>
        <div className="backup-hero-copy">
          <span className="eyebrow">最近一次保护</span>
          <strong>{formatRelative(lastBackup)}</strong>
          <small>
            资料库文件、软件映射、分类、收藏与设置，全部打包在一个 ZIP 中。
          </small>
        </div>
        <span className="offline-pill">
          <WifiOff size={12} /> 完全离线
        </span>
      </div>

      <div className="backup-options">
        <div className="option-row">
          <div>
            <strong>自动备份</strong>
            <small>总开关；关闭后定时备份和文件变化备份都不再自动执行。</small>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.autoBackup}
            className={`switch ${settings.autoBackup ? "on" : ""}`}
            onClick={() => onToggleAuto(!settings.autoBackup)}
          >
            <span />
          </button>
        </div>
        <div className="option-row">
          <div>
            <strong>定时频率</strong>
            <small>每小时 / 每天 / 每 7 天；选择「关闭定时」仍可只按文件变化备份。</small>
          </div>
          <select
            value={settings.backupInterval}
            onChange={(event) =>
              onIntervalChange(event.target.value as Settings["backupInterval"])
            }
            aria-label="定时备份频率"
          >
            <option value="manual">关闭定时（仅文件变化）</option>
            <option value="hourly">每小时</option>
            <option value="daily">每天</option>
            <option value="weekly">每 7 天</option>
          </select>
        </div>
        <div className="option-row">
          <div>
            <strong>文件变化后自动备份</strong>
            <small>新文件导入、重命名、删除或加密变动后，约 3–5 秒自动生成一份。</small>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.backupOnChange}
            className={`switch ${settings.backupOnChange ? "on" : ""}`}
            onClick={() => onToggleChange(!settings.backupOnChange)}
          >
            <span />
          </button>
        </div>
        <div className="option-row">
          <div>
            <strong>保留自动备份</strong>
            <small>手动备份与恢复前保护不会被自动清理。</small>
          </div>
          <select
            value={settings.backupRetention}
            onChange={(event) => onRetentionChange(Number(event.target.value))}
            aria-label="自动备份保留数量"
          >
            {[5, 10, 20, 30].map((value) => (
              <option key={value} value={value}>
                最近 {value} 份
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="backup-package-actions">
        <button
          type="button"
          className="button button-ghost"
          onClick={() => void chooseExport()}
        >
          <Download size={15} /> 导出加密包
        </button>
        <button
          type="button"
          className="button button-ghost"
          onClick={() => void chooseRestore()}
        >
          <Upload size={15} /> 还原备份包
        </button>
        <span>一个文件 · 包含完整资料库 · 需要密码</span>
      </div>

      {packageMode && (
        <div className="backup-package-form">
          <div className="backup-package-heading">
            <span className="backup-package-icon">
              <KeyRound size={17} />
            </span>
            <div>
              <strong>
                {packageMode === "export" ? "设置导出密码" : "输入备份包密码"}
              </strong>
              <small title={packagePath}>{packagePath}</small>
            </div>
          </div>
          <div className="backup-package-fields">
            <input
              autoFocus
              type="password"
              value={packagePassword}
              onChange={(event) => {
                setPackagePassword(event.target.value);
                setPackageError("");
              }}
              placeholder="备份包密码（至少 6 位）"
              autoComplete={
                packageMode === "export" ? "new-password" : "current-password"
              }
            />
            {packageMode === "export" && (
              <input
                type="password"
                value={packageConfirm}
                onChange={(event) => {
                  setPackageConfirm(event.target.value);
                  setPackageError("");
                }}
                placeholder="再次输入密码"
                autoComplete="new-password"
              />
            )}
            <button
              type="button"
              className="button button-primary"
              disabled={packageBusy || !packagePassword}
              onClick={() => void submitPackage()}
            >
              {packageBusy ? (
                <Loader2 size={14} className="spin" />
              ) : packageMode === "export" ? (
                <Download size={14} />
              ) : (
                <Upload size={14} />
              )}
              {packageMode === "export" ? "加密并导出" : "解密并还原"}
            </button>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => {
                setPackageMode(null);
                setPackageError("");
              }}
              disabled={packageBusy}
            >
              取消
            </button>
          </div>
          {packageError && <p className="form-error">{packageError}</p>}
        </div>
      )}

      {packageSuccess && (
        <p className="backup-package-success">{packageSuccess}</p>
      )}

      <div className="backup-list-head">
        <h3>文件备份状态</h3>
        <span>
          {manifest
            ? `${manifest.backedUp.length} 已备份 · ${manifest.pending.length} 未备份`
            : "正在统计"}
        </span>
      </div>
      <div className="backup-manifest">
        <div className="backup-manifest-column">
          <header>
            <ShieldCheck size={13} /> 已备份
            <b>{manifest?.backedUp.length ?? 0}</b>
          </header>
          <div className="backup-manifest-list">
            {manifest && manifest.backedUp.length === 0 && (
              <span className="backup-manifest-empty">还没有文件进入备份</span>
            )}
            {manifest?.backedUp.map((entry) => (
              <div className="backup-file-row" key={entry.key}>
                <strong title={entry.name}>{entry.name}</strong>
                <small>{formatBytes(entry.size)}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="backup-manifest-column pending">
          <header>
            <Archive size={13} /> 未备份
            <b>{manifest?.pending.length ?? 0}</b>
          </header>
          <div className="backup-manifest-list">
            {manifest && manifest.pending.length === 0 && (
              <span className="backup-manifest-empty">没有待备份文件</span>
            )}
            {manifest?.pending.map((entry) => (
              <div className="backup-file-row" key={entry.key}>
                <strong title={entry.name}>{entry.name}</strong>
                <small>{formatBytes(entry.size)}</small>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="backup-list-head">
        <h3>备份记录</h3>
        <span>{backups.length} 份</span>
      </div>

      <div className="backup-list">
        {loading && backups.length === 0 && (
          <div className="backup-loading">
            <Loader2 size={18} className="spin" /> 正在读取备份…
          </div>
        )}
        {!loading && backups.length === 0 && (
          <div className="backup-empty">
            <Archive size={24} strokeWidth={1.5} />
            <strong>还没有备份</strong>
            <span>点击「立即备份」生成第一份离线 ZIP。</span>
          </div>
        )}
        {backups.map((backup) => (
          <div key={backup.path} className="backup-row">
            <span className={`backup-row-icon kind-${backup.kind}`}>
              <Archive size={18} strokeWidth={1.7} />
            </span>
            <div className="backup-row-copy">
              <div>
                <strong title={backup.name}>
                  {backup.name.replace(/^DeskNest-/, "").replace(/\.zip$/, "")}
                </strong>
                <span className={`backup-kind kind-${backup.kind}`}>
                  {formatBackupKind(backup.kind)}
                </span>
              </div>
              <small>
                {formatDateTime(backup.createdAt)} · {formatBytes(backup.size)}
              </small>
            </div>
            <div className="backup-row-actions">
              <button
                type="button"
                className="button button-quiet button-sm"
                onClick={() => onRestore(backup)}
                disabled={Boolean(restoringPath)}
              >
                {restoringPath === backup.path ? (
                  <Loader2 size={13} className="spin" />
                ) : (
                  <RotateCcw size={13} />
                )}
                恢复
              </button>
              <button
                type="button"
                className="icon-button icon-button-sm"
                onClick={() => onDelete(backup)}
                aria-label="删除备份"
                title="删除备份"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="backup-footnote">
        恢复会先自动创建一份「恢复前保护」备份，再用所选 ZIP 替换当前资料库与软件映射。
        建议在恢复前关闭正在编辑的文件。
      </p>
    </ModalShell>
  );
}
