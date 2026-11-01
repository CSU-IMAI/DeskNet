import {
  AppWindow,
  FileText,
  GripVertical,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, FormEvent, PointerEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import { api } from "../lib/api";
import { typeLabel, withAlpha } from "../lib/format";
import type { Category, DesktopZone, Item, VaultStatus } from "../types";
import { ItemGlyph } from "./ItemGlyph";

export function ZoneWidget() {
  const appWindow = getCurrentWindow();
  const zoneId = appWindow.label.replace(/^zone-/, "");
  const [zone, setZone] = useState<DesktopZone | null>(null);
  const [zones, setZones] = useState<DesktopZone[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [toast, setToast] = useState("");
  const [resizing, setResizing] = useState(false);
  const [vaultConfigured, setVaultConfigured] = useState(false);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [zoneOpacity, setZoneOpacity] = useState(0.78);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const resizeStart = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const moveTimer = useRef<number | undefined>(undefined);
  const validBounds = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const bootstrap = await api.bootstrap();
      const found = bootstrap.desktop.zones.find((entry) => entry.id === zoneId);
      if (!found) {
        setError("分区不存在");
        return;
      }
      setZone(found);
      setZones(bootstrap.desktop.zones);
      setZoneOpacity(bootstrap.desktop.zoneOpacity || 0.78);
      validBounds.current = {
        x: found.x,
        y: found.y,
        width: found.width,
        height: found.height,
      };
      setItems(bootstrap.items);
      setCategories(bootstrap.categories);
      setVaultConfigured(bootstrap.vaultConfigured);
      setVaultUnlocked(bootstrap.vaultUnlocked);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [zoneId]);

  useEffect(() => {
    void load();
    let unlistenRefresh: (() => void) | undefined;
    let unlistenChanged: (() => void) | undefined;
    let unlistenVault: (() => void) | undefined;
    let unlistenLocked: (() => void) | undefined;
    void listen("zone-refresh", () => void load()).then((stop) => {
      unlistenRefresh = stop;
    });
    void listen("desktop-settings-changed", () => void load()).then((stop) => {
      unlistenChanged = stop;
    });
    void listen<VaultStatus>("vault-status-changed", (event) => {
      setVaultConfigured(event.payload.configured);
      setVaultUnlocked(event.payload.unlocked);
      if (!event.payload.unlocked) {
        setItems([]);
      } else {
        void load();
      }
    }).then((stop) => {
      unlistenVault = stop;
    });
    void listen("vault-locked", () => {
      setVaultUnlocked(false);
      setItems([]);
      setPassword("");
    }).then((stop) => {
      unlistenLocked = stop;
    });
    return () => {
      unlistenRefresh?.();
      unlistenChanged?.();
      unlistenVault?.();
      unlistenLocked?.();
    };
  }, [load]);

  const saveBounds = useCallback(async () => {
    const [position, size, monitor] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.outerSize(),
      currentMonitor(),
    ]);
    if (!monitor) return;
    if (position.x < -10000 || position.y < -10000) {
      return;
    }
    const width = monitor.size.width;
    const height = monitor.size.height;
    const next = {
      x: Math.max(0, Math.min(1, (position.x - monitor.position.x) / width)),
      y: Math.max(0, Math.min(1, (position.y - monitor.position.y) / height)),
      width: Math.max(0.12, Math.min(0.92, size.width / width)),
      height: Math.max(0.14, Math.min(0.92, size.height / height)),
    };

    const revert = async () => {
      const valid = validBounds.current;
      if (!valid) return;
      await appWindow.setSize(
        new PhysicalSize(
          Math.round(valid.width * width),
          Math.round(valid.height * height),
        ),
      );
      await appWindow.setPosition(
        new PhysicalPosition(
          Math.round(monitor.position.x + valid.x * width),
          Math.round(monitor.position.y + valid.y * height),
        ),
      );
    };

    const conflict = zones.find(
      (other) =>
        other.id !== zoneId &&
        next.x < other.x + other.width - 0.0005 &&
        next.x + next.width > other.x + 0.0005 &&
        next.y < other.y + other.height - 0.0005 &&
        next.y + next.height > other.y + 0.0005,
    );
    if (conflict) {
      await revert();
      setToast(`和「${conflict.name}」边界重叠了，已退回原位`);
      window.setTimeout(() => setToast(""), 3200);
      return;
    }

    validBounds.current = next;
    try {
      await api.updateZoneBounds(
        zoneId,
        next.x,
        next.y,
        next.width,
        next.height,
      );
    } catch (reason) {
      await revert();
      setToast(reason instanceof Error ? reason.message : String(reason));
      window.setTimeout(() => setToast(""), 3200);
    }
  }, [appWindow, zoneId, zones]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void appWindow.onMoved(() => {
      if (moveTimer.current) window.clearTimeout(moveTimer.current);
      moveTimer.current = window.setTimeout(() => {
        void saveBounds();
      }, 150);
    }).then((stop) => {
      unlisten = stop;
    });
    return () => {
      unlisten?.();
      if (moveTimer.current) window.clearTimeout(moveTimer.current);
    };
  }, [appWindow, saveBounds]);

  useEffect(() => {
    let last = "";
    const timer = window.setInterval(() => {
      void (async () => {
        const [position, size] = await Promise.all([
          appWindow.outerPosition(),
          appWindow.outerSize(),
        ]);
        const key = `${position.x}:${position.y}:${size.width}:${size.height}`;
        if (last && key !== last) {
          last = key;
          void saveBounds();
        } else {
          last = key;
        }
      })();
    }, 700);
    return () => window.clearInterval(timer);
  }, [appWindow, saveBounds]);

  const importPathsForZone = useCallback(
    async (paths: string[]) => {
      if (!zone || paths.length === 0) return;
      if (zone.filter === "encrypted" && !vaultUnlocked) {
        setToast("请先输入密码解锁加密区");
        window.setTimeout(() => setToast(""), 3200);
        return;
      }
      const acceptedKinds =
        zone.filter === "apps"
          ? ["app"]
          : zone.filter === "files" || zone.filter === "encrypted"
            ? ["file", "folder"]
            : ["file", "folder", "app"];
      const classified = await api.classifyPaths(paths);
      const accepted = classified.filter((entry) =>
        acceptedKinds.includes(entry.kind),
      );
      const rejected = classified.length - accepted.length;
      if (accepted.length === 0) {
        const message =
          zone.filter === "apps"
            ? "程序区只接收 .exe / .lnk / .url 等软件快捷方式"
            : zone.filter === "files"
              ? "文件区只接收文件和文件夹，软件请拖到程序区"
              : zone.filter === "encrypted"
                ? "加密区只接收文件和文件夹"
                : "没有可导入的项目";
        setToast(message);
        window.setTimeout(() => setToast(""), 3200);
        return;
      }

      try {
        const result = await api.importPaths(
          accepted.map((entry) => entry.path),
          zone.categoryId ?? undefined,
        );
        if (zone.filter === "encrypted") {
          for (const imported of result.imported) {
            if (imported.kind !== "app") {
              try {
                await api.encryptItem(imported.id);
              } catch (error) {
                await api.deleteItem(imported.id).catch(() => undefined);
                throw error;
              }
            }
          }
        }
        const suffix =
          rejected > 0 ? `，忽略 ${rejected} 个不支持的项目` : "";
        setToast(
          result.imported.length > 0
            ? `已导入 ${result.imported.length} 个项目${
                zone.filter === "encrypted" ? "并加密" : ""
              }${suffix}`
            : result.errors[0] ?? result.skipped[0] ?? "没有可导入的项目",
        );
        await load();
        window.setTimeout(() => setToast(""), 3600);
      } catch (reason) {
        setToast(reason instanceof Error ? reason.message : String(reason));
        window.setTimeout(() => setToast(""), 3600);
      }
    },
    [load, vaultUnlocked, zone],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            if (zone?.filter === "encrypted" && !vaultUnlocked) {
              setDropActive(false);
              return;
            }
            setDropActive(true);
            return;
          }
          if (payload.type === "drop") {
            setDropActive(false);
            if (zone?.filter === "encrypted" && !vaultUnlocked) {
              setToast("请先输入密码解锁加密区");
              window.setTimeout(() => setToast(""), 3200);
              return;
            }
            void (async () => {
              try {
                await importPathsForZone(payload.paths);
              } catch (reason) {
                setToast(reason instanceof Error ? reason.message : String(reason));
                window.setTimeout(() => setToast(""), 3200);
              }
            })();
            return;
          }
          setDropActive(false);
        });
      } catch {
        // Drag and drop is only available in the desktop runtime.
      }
    })();
    return () => unlisten?.();
  }, [importPathsForZone]);

  const visibleItems = useMemo(() => {
    if (!zone) return [];
    if (zone.filter === "encrypted" && !vaultUnlocked) return [];
    return items
      .filter((item) => {
        if (zone.categoryId && !item.categories.includes(zone.categoryId)) {
          return false;
        }
        if (zone.filter === "apps") return item.kind === "app";
        if (zone.filter === "files") {
          return item.kind === "file" || item.kind === "folder";
        }
        if (zone.filter === "encrypted") return item.encrypted;
        return true;
      })
      .sort((a, b) => {
        if (a.kind === "app" && b.kind === "app") {
          return (b.lastOpened ?? 0) - (a.lastOpened ?? 0);
        }
        return b.modified - a.modified;
      });
  }, [items, vaultUnlocked, zone]);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) return;
    setUnlocking(true);
    setUnlockError("");
    try {
      const status = await api.unlockVault(password);
      setVaultConfigured(status.configured);
      setVaultUnlocked(status.unlocked);
      setPassword("");
      await load();
    } catch (reason) {
      setUnlockError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUnlocking(false);
    }
  };

  const addFiles = async () => {
    if (!zone) return;
    const selected = await open({
      multiple: true,
      directory: false,
      title: `选择要放入「${zone.name}」的文件`,
      filters:
        zone.filter === "apps"
          ? [
              {
                name: "软件快捷方式",
                extensions: ["exe", "lnk", "url", "desktop", "appimage"],
              },
            ]
          : undefined,
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) return;
    await importPathsForZone(paths);
  };

  const openItem = async (item: Item) => {
    try {
      await api.openItem(item.id);
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, lastOpened: Date.now() } : entry,
        ),
      );
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : String(reason));
      window.setTimeout(() => setToast(""), 3200);
    }
  };

  const startResize = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    resizeStart.current = {
      x: event.clientX,
      y: event.clientY,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  };

  const moveResize = (event: PointerEvent<HTMLButtonElement>) => {
    if (!resizing) return;
    const width = Math.max(280, resizeStart.current.width + event.clientX - resizeStart.current.x);
    const height = Math.max(170, resizeStart.current.height + event.clientY - resizeStart.current.y);
    void appWindow.setSize(new LogicalSize(width, height));
  };

  const endResize = () => {
    if (!resizing) return;
    setResizing(false);
    window.setTimeout(() => void saveBounds(), 120);
  };

  if (!zone && loading) {
    return (
      <div className="zone-loading">
        <Loader2 className="spin" size={18} />
      </div>
    );
  }

  if (!zone) {
    return <div className="zone-loading">{error || "分区不存在"}</div>;
  }

  const locked = zone.filter === "encrypted" && !vaultUnlocked;

  return (
    <div
      className={`zone-widget ${dropActive ? "drop-active" : ""} ${
        locked ? "zone-locked-shell" : ""
      }`}
      style={
        {
          borderColor: withAlpha(zone.color, 0.55),
          "--zone-alpha": zoneOpacity,
        } as CSSProperties
      }
    >
      <header className="zone-header">
        <span
          className="zone-grip"
          data-tauri-drag-region
          title="拖动分区"
        >
          <GripVertical size={13} />
        </span>
        <span
          className="zone-dot"
          style={{ backgroundColor: zone.color }}
        />
        <span className="zone-title" data-tauri-drag-region>
          {zone.name}
        </span>
        <span className="zone-count">
          {locked ? <LockKeyhole size={10} /> : visibleItems.length}
        </span>
        <button
          type="button"
          className="zone-tool"
          onClick={() => void addFiles()}
          disabled={locked}
          title="添加文件到这个分区"
          aria-label="添加文件到这个分区"
        >
          <Plus size={13} />
        </button>
        <button
          type="button"
          className="zone-tool"
          onClick={() => void appWindow.hide()}
          title="暂时隐藏这个分区"
          aria-label="暂时隐藏这个分区"
        >
          −
        </button>
        <button
          type="button"
          className="zone-tool"
          onClick={() => void api.openZonesManager()}
          title="编辑分区"
          aria-label="编辑分区"
        >
          <Settings2 size={13} />
        </button>
      </header>

      <div className="zone-body">
        {locked ? (
          <div className="zone-locked">
            <span className="zone-lock-icon">
              <LockKeyhole size={23} strokeWidth={1.6} />
            </span>
            <strong>加密区已锁定</strong>
            <p>
              {vaultConfigured
                ? "输入保险箱密码后，这里才会显示加密文件。"
                : "请先在 DeskNest 主界面设置保险箱密码。"}
            </p>
            {vaultConfigured ? (
              <form onSubmit={(event) => void unlock(event)}>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setUnlockError("");
                  }}
                  placeholder="输入保险箱密码"
                  autoComplete="current-password"
                />
                <button type="submit" disabled={unlocking || !password}>
                  {unlocking ? (
                    <Loader2 size={12} className="spin" />
                  ) : (
                    <ShieldCheck size={12} />
                  )}
                  解锁
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="zone-unlock-link"
                onClick={() => void api.openZonesManager()}
              >
                打开主界面
              </button>
            )}
            {unlockError && <span className="zone-unlock-error">{unlockError}</span>}
          </div>
        ) : visibleItems.length > 0 ? (
          <div className="zone-grid">
            {visibleItems.map((item) => (
              <button
                type="button"
                key={item.id}
                className="zone-item"
                onClick={() => void openItem(item)}
                title={`${item.name} · ${typeLabel(item)}`}
              >
                <ItemGlyph item={item} size="sm" />
                <span className="zone-item-copy">
                  <strong>{item.name}</strong>
                  <small>
                    {item.encrypted ? (
                      <LockKeyhole size={10} />
                    ) : item.kind === "app" ? (
                      <AppWindow size={10} />
                    ) : (
                      <FileText size={10} />
                    )}
                    {item.encrypted ? "已加密" : typeLabel(item)}
                  </small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="zone-empty">
            <span
              className="zone-empty-mark"
              style={{
                color: zone.color,
                background: withAlpha(zone.color, 0.12),
              }}
            >
              {zone.filter === "apps" ? (
                <AppWindow size={20} />
              ) : zone.filter === "encrypted" ? (
                <LockKeyhole size={20} />
              ) : (
                <FileText size={20} />
              )}
            </span>
            <strong>{loading ? "正在载入…" : "这个分区还是空的"}</strong>
            <span>
              {zone.filter === "apps"
                ? "把软件快捷方式拖进来，或先在 DeskNest 中导入。"
                : zone.filter === "encrypted"
                  ? "把文件拖进来或点击添加，会自动分块加密。"
                  : "把文件拖到这里，会保存到统一资料库。"}
            </span>
            {!locked && (
              <button
                type="button"
                className="zone-add-link"
                onClick={() => void addFiles()}
              >
                <Plus size={11} /> 或点击选择文件
              </button>
            )}
          </div>
        )}
      </div>

      <footer className="zone-footer">
        <span>
          {zone.filter === "encrypted"
            ? locked
              ? "保险箱 · 已锁定"
              : "保险箱 · 已解锁"
            : zone.categoryId
              ? categories.find((category) => category.id === zone.categoryId)?.name
              : zone.filter === "apps"
                ? "全部软件"
                : zone.filter === "files"
                  ? "全部文件"
                  : "全部项目"}
        </span>
        <button
          type="button"
          className="zone-refresh"
          onClick={() => void load()}
          aria-label="刷新分区"
          title="刷新分区"
        >
          <RefreshCw size={11} />
        </button>
      </footer>

      <button
        type="button"
        className={`zone-resize ${resizing ? "active" : ""}`}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        aria-label="调整分区大小"
        title="拖动调整分区大小"
      >
        <span />
      </button>

      {dropActive && !locked && (
        <div className="zone-drop">
          <strong>松开导入到「{zone.name}」</strong>
          <span>
            {zone.filter === "apps"
              ? "只接受 .exe / .lnk / .url 等软件快捷方式"
              : zone.filter === "files"
                ? "接受文件和文件夹；软件请拖到程序区"
                : zone.filter === "encrypted"
                  ? "接受文件和文件夹，导入后自动加密"
                  : "接受文件、文件夹和软件快捷方式"}
          </span>
        </div>
      )}

      {toast && <div className="zone-toast">{toast}</div>}
    </div>
  );
}
