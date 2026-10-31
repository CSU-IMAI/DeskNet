import {
  KeyRound,
  Loader2,
  LockKeyhole,
  LockKeyholeOpen,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../lib/api";
import type { VaultStatus } from "../types";
import { ModalShell } from "./ModalShell";

interface VaultModalProps {
  mode: "setup" | "unlock" | "unlocked";
  encryptedCount: number;
  onClose: () => void;
  onStatus: (status: VaultStatus) => void;
}

export function VaultModal({
  mode,
  encryptedCount,
  onClose,
  onStatus,
}: VaultModalProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === "setup") {
      if (password.length < 6) {
        setError("密码至少需要 6 个字符");
        return;
      }
      if (password !== confirm) {
        setError("两次输入的密码不一致");
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      const status =
        mode === "setup"
          ? await api.configureVault(password)
          : await api.unlockVault(password);
      onStatus(status);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const lock = async () => {
    setBusy(true);
    try {
      const status = await api.lockVault();
      onStatus(status);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={
        mode === "setup"
          ? "设置保险箱密码"
          : mode === "unlock"
            ? "解锁保险箱"
            : "文件保险箱"
      }
      eyebrow="AES-256-GCM · 分块加密"
      size="sm"
      onClose={onClose}
    >
      <div className="vault-hero">
        <span className={`vault-hero-icon ${mode === "unlocked" ? "open" : ""}`}>
          {mode === "unlocked" ? (
            <LockKeyholeOpen size={28} strokeWidth={1.5} />
          ) : (
            <LockKeyhole size={28} strokeWidth={1.5} />
          )}
        </span>
        <div>
          <strong>
            {mode === "setup"
              ? "给加密文件设置一把钥匙"
              : mode === "unlock"
                ? "密码只在本机内存中解锁"
                : "保险箱已解锁"}
          </strong>
          <p>
            {mode === "setup"
              ? "首次加密文件时会设置。密码不会上传，也不会写入备份；忘记后无法恢复加密文件。"
              : mode === "unlock"
                ? `${encryptedCount} 个文件已加密。锁屏、重启或手动锁定后都需要重新输入密码。`
                : `${encryptedCount} 个文件处于加密状态。分区和搜索结果会在锁定后立即隐藏。`}
          </p>
        </div>
      </div>

      {mode === "unlocked" ? (
        <div className="vault-actions">
          <button
            type="button"
            className="button button-ghost"
            onClick={() => void lock()}
            disabled={busy}
          >
            {busy ? <Loader2 size={14} className="spin" /> : <LockKeyhole size={14} />}
            立即锁定
          </button>
          <p>
            锁定会清除内存中的密钥，并清理已解密到临时目录的文件副本。
            桌面加密区会立即隐藏。
          </p>
        </div>
      ) : (
        <form className="form-stack vault-form" onSubmit={submit}>
          <label className="field">
            <span>保险箱密码</span>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError("");
              }}
              placeholder={mode === "setup" ? "至少 6 个字符" : "输入密码"}
              autoComplete={mode === "setup" ? "new-password" : "current-password"}
            />
          </label>
          {mode === "setup" && (
            <label className="field">
              <span>再次输入</span>
              <input
                type="password"
                value={confirm}
                onChange={(event) => {
                  setConfirm(event.target.value);
                  setError("");
                }}
                placeholder="确认密码"
                autoComplete="new-password"
              />
            </label>
          )}
          <div className="vault-hint">
            <KeyRound size={13} />
            <span>
              使用 Argon2id 派生密钥；文件按 4 MB 分块加密，可压缩文件使用快速
              Deflate。密钥只在本次会话内存中保留。加密前生成的旧 ZIP 备份可能
              仍含明文，建议加密后重新备份并清理旧备份。
            </span>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="vault-submit">
            <ShieldCheck size={15} />
            <button
              type="submit"
              className="button button-primary"
              disabled={busy || !password}
            >
              {busy && <Loader2 size={14} className="spin" />}
              {mode === "setup" ? "设置并解锁" : "解锁"}
            </button>
          </div>
        </form>
      )}
    </ModalShell>
  );
}
