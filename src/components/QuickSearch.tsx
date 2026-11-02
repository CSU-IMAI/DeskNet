import {
  AppWindow,
  ArrowUpRight,
  CornerDownLeft,
  FileText,
  GripVertical,
  LockKeyhole,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
} from "@tauri-apps/api/window";
import { api } from "../lib/api";
import { categoryName, typeLabel } from "../lib/format";
import { createSearchIndex, searchItems } from "../lib/search";
import type { Category, Item, VaultStatus } from "../types";
import { ItemGlyph } from "./ItemGlyph";

const WINDOW_WIDTH = 720;

export function QuickSearch() {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [pendingItem, setPendingItem] = useState<Item | null>(null);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  const dirtyRef = useRef(false);
  const appWindow = getCurrentWindow();

  const focusInput = () => {
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
  };

  const reset = () => {
    setPendingItem(null);
    setPassword("");
    setUnlockError("");
    setQuery("");
    setActive(0);
    focusInput();
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const bootstrap = await api.bootstrap();
      setItems(bootstrap.items);
      setCategories(bootstrap.categories);
      setVaultUnlocked(bootstrap.vaultUnlocked);
      loadedRef.current = true;
      dirtyRef.current = false;
      reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let unlistenShow: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;
    let unlistenVault: (() => void) | undefined;
    let unlistenLocked: (() => void) | undefined;
    let unlistenChanged: (() => void) | undefined;
    void listen("quick-search-show", () => {
      if (!loadedRef.current || dirtyRef.current) {
        void load();
      } else {
        reset();
      }
    }).then((stop) => {
      unlistenShow = stop;
    });
    void listen("items-changed", () => {
      dirtyRef.current = true;
      void appWindow.isVisible().then((visible) => {
        if (visible) {
          void load();
        }
      });
    }).then((stop) => {
      unlistenChanged = stop;
    });
    void listen<VaultStatus>("vault-status-changed", (event) => {
      setVaultUnlocked(event.payload.unlocked);
      if (!event.payload.unlocked) {
        setPendingItem(null);
      }
    }).then((stop) => {
      unlistenVault = stop;
    });
    void listen("vault-locked", () => {
      setVaultUnlocked(false);
      setPendingItem(null);
      setPassword("");
    }).then((stop) => {
      unlistenLocked = stop;
    });
    void appWindow.onFocusChanged(({ payload }) => {
      if (!payload) {
        window.setTimeout(() => {
          void api.hideQuickSearch();
        }, 120);
      }
    }).then((stop) => {
      unlistenFocus = stop;
    });
    return () => {
      unlistenShow?.();
      unlistenChanged?.();
      unlistenFocus?.();
      unlistenVault?.();
      unlistenLocked?.();
    };
  }, [appWindow, load]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let timer: number | undefined;
    void appWindow
      .onMoved(() => {
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          void (async () => {
            const [position, monitor] = await Promise.all([
              appWindow.outerPosition(),
              currentMonitor(),
            ]);
            if (!monitor) return;
            const width = monitor.size.width;
            const height = monitor.size.height;
            if (width <= 0 || height <= 0) return;
            await api
              .updateSearchPosition(
                (position.x - monitor.position.x) / width,
                (position.y - monitor.position.y) / height,
              )
              .catch(() => undefined);
          })();
        }, 280);
      })
      .then((stop) => {
        unlisten = stop;
      });
    return () => {
      unlisten?.();
      if (timer) window.clearTimeout(timer);
    };
  }, [appWindow]);

  const index = useMemo(
    () => createSearchIndex(items, categories),
    [categories, items],
  );

  const results = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed) return searchItems(index, trimmed).slice(0, 7);
    const recent = [...items]
      .sort((a, b) => {
        const opened = (b.lastOpened ?? 0) - (a.lastOpened ?? 0);
        if (opened !== 0) return opened;
        return Number(b.favorite) - Number(a.favorite) || b.modified - a.modified;
      })
      .slice(0, 5);
    return recent;
  }, [index, items, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const height = pendingItem
      ? 252
      : results.length > 0
        ? Math.min(540, 138 + results.length * 56)
        : 160;
    void appWindow
      .setSize(new LogicalSize(WINDOW_WIDTH, height))
      .catch(() => undefined);
  }, [appWindow, pendingItem, results.length]);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-result-index="${active}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const open = useCallback(
    async (item: Item) => {
      if (item.encrypted && !vaultUnlocked) {
        setPendingItem(item);
        setPassword("");
        setUnlockError("");
        window.setTimeout(() => passwordRef.current?.focus(), 40);
        return;
      }
      try {
        await api.openItem(item.id);
        await api.hideQuickSearch();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [appWindow, vaultUnlocked],
  );

  const unlockAndOpen = async (event: FormEvent) => {
    event.preventDefault();
    if (!pendingItem || !password) return;
    setUnlocking(true);
    setUnlockError("");
    try {
      await api.unlockVault(password);
      setVaultUnlocked(true);
      await api.openItem(pendingItem.id);
      setPendingItem(null);
      await api.hideQuickSearch();
    } catch (reason) {
      setUnlockError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUnlocking(false);
    }
  };

  const handleKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void api.hideQuickSearch();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) =>
        results.length === 0 ? 0 : (current + 1) % results.length,
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) =>
        results.length === 0
          ? 0
          : (current - 1 + results.length) % results.length,
      );
      return;
    }
    if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      void open(results[active]);
    }
  };

  return (
    <div className="quick-window" onKeyDown={handleKey}>
      <div className="quick-card">
        <div className="quick-input-row">
          <span className="quick-drag" data-tauri-drag-region title="拖动搜索条">
            <GripVertical size={14} />
          </span>
          <Search size={19} strokeWidth={1.8} className="quick-search-icon" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setError("");
            }}
            placeholder="搜索文件或软件，输入后 Enter 直接打开…"
            aria-label="快速搜索文件或软件"
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              className="quick-clear"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="清空"
            >
              <X size={14} />
            </button>
          )}
          <kbd>Ctrl Shift Space</kbd>
          <button
            type="button"
            className="quick-close"
            onClick={() => void api.hideQuickSearch()}
            aria-label="隐藏快速搜索"
          >
            <X size={15} />
          </button>
        </div>

        {pendingItem ? (
          <div className="quick-unlock">
            <span className="quick-unlock-icon">
              <LockKeyhole size={20} strokeWidth={1.6} />
            </span>
            <div className="quick-unlock-copy">
              <strong>解锁「{pendingItem.name}」</strong>
              <span>该文件已加密，输入保险箱密码后直接打开。</span>
            </div>
            <form onSubmit={(event) => void unlockAndOpen(event)}>
              <input
                ref={passwordRef}
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setUnlockError("");
                }}
                placeholder="保险箱密码"
                autoComplete="current-password"
              />
              <button type="submit" disabled={unlocking || !password}>
                {unlocking ? (
                  <span className="spin">◌</span>
                ) : (
                  <ShieldCheck size={13} />
                )}
                解锁并打开
              </button>
            </form>
            {unlockError && <span className="quick-unlock-error">{unlockError}</span>}
            <button
              type="button"
              className="quick-unlock-cancel"
              onClick={() => {
                setPendingItem(null);
                setPassword("");
                setUnlockError("");
                inputRef.current?.focus();
              }}
            >
              取消
            </button>
          </div>
        ) : results.length > 0 ? (
          <div className="quick-results" ref={listRef}>
            <div className="quick-section-title">
              {query.trim() ? "搜索结果" : "最近打开"}
              <span>{results.length}</span>
            </div>
            {results.map((item, position) => (
              <button
                type="button"
                key={item.id}
                data-result-index={position}
                className={`quick-result ${position === active ? "active" : ""}`}
                onMouseEnter={() => setActive(position)}
                onClick={() => void open(item)}
              >
                <ItemGlyph item={item} size="sm" />
                <span className="quick-result-copy">
                  <strong>{item.name}</strong>
                  <small>
                    {item.encrypted
                      ? "已加密 · 需要密码"
                      : typeLabel(item)}
                    {item.kind === "folder" && item.contentCount > 0
                      ? ` · 包含 ${item.contentCount} 个文件`
                      : ""}
                    {item.source ? ` · ${item.source}` : ""}
                    {item.categories[0]
                      ? ` · ${categoryName(item.categories[0], categories)}`
                      : ""}
                  </small>
                </span>
                {item.encrypted ? (
                  <LockKeyhole size={14} className="quick-kind" />
                ) : item.kind === "app" ? (
                  <AppWindow size={14} className="quick-kind" />
                ) : (
                  <FileText size={14} className="quick-kind" />
                )}
                {position === active ? (
                  <span className="quick-enter">
                    <CornerDownLeft size={12} /> 打开
                  </span>
                ) : (
                  <ArrowUpRight size={14} className="quick-open" />
                )}
              </button>
            ))}
          </div>
        ) : null}

        {!loading && !pendingItem && results.length === 0 && (
          <div className="quick-empty">
            {error
              ? error
              : items.length === 0
                ? "资料库还是空的，先在 DeskNest 里导入文件或快捷方式。"
                : "没有匹配的文件或软件。"}
          </div>
        )}

        <div className="quick-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 选择
          </span>
          <span>
            <kbd>Enter</kbd> 打开
          </span>
          <span>
            <kbd>Esc</kbd> 隐藏
          </span>
          <span className="quick-brand">DeskNest Quick</span>
        </div>
      </div>
    </div>
  );
}
