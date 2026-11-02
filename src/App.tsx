import {
  ArrowDownWideNarrow,
  Grid2X2,
  List,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Dispatch, SetStateAction } from "react";
import { api, isDesktopRuntime, normalizeError } from "./lib/api";
import { formatBytes } from "./lib/format";
import { createSearchIndex, searchItems, sortItems } from "./lib/search";
import type {
  ActiveView,
  BackupInfo,
  BackupManifest,
  Bootstrap,
  Category,
  DesktopSettings,
  DesktopZone,
  ImportResult,
  Item,
  Layout,
  Settings,
  SortKey,
  StorageInfo,
  Theme,
  ToastMessage,
  ToastTone,
  VaultStatus,
} from "./types";
import { BackupModal } from "./components/BackupModal";
import { CategoryModal } from "./components/CategoryModal";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ContextMenu } from "./components/ContextMenu";
import { DetailPanel } from "./components/DetailPanel";
import { DropOverlay } from "./components/DropOverlay";
import { EmptyState } from "./components/EmptyState";
import { ItemCard } from "./components/ItemCard";
import { ItemRow } from "./components/ItemRow";
import { RenameDialog } from "./components/RenameDialog";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { Topbar } from "./components/Topbar";
import { VaultModal } from "./components/VaultModal";
import { ZonesModal } from "./components/ZonesModal";

type CategoryDraft =
  | { mode: "create" }
  | { mode: "edit"; category: Category };

interface ConfirmRequest {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  action: () => Promise<void> | void;
}

interface ContextRequest {
  item: Item;
  x: number;
  y: number;
}

function useStoredState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored) return JSON.parse(stored) as T;
    } catch {
      // Ignore storage failures and fall back to the initial value.
    }
    return initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // localStorage is only an enhancement.
    }
  }, [key, value]);
  return [value, setValue];
}

function viewTitle(view: ActiveView, categories: Category[]): string {
  switch (view.kind) {
    case "files":
      return "文件库";
    case "apps":
      return "软件库";
    case "favorites":
      return "收藏";
    case "recent":
      return "最近打开";
    case "category":
      return (
        categories.find((category) => category.id === view.categoryId)?.name ??
        "分类"
      );
    case "all":
    default:
      return "全部项目";
  }
}

function viewEyebrow(view: ActiveView): string {
  switch (view.kind) {
    case "files":
      return "FILES";
    case "apps":
      return "APPLICATIONS";
    case "favorites":
      return "FAVORITES";
    case "recent":
      return "RECENT";
    case "category":
      return "CUSTOM CATEGORY";
    case "all":
    default:
      return "DESKTOP, ORGANIZED";
  }
}

function viewDescription(view: ActiveView): string {
  switch (view.kind) {
    case "files":
      return "文档、图片与素材的统一资料库";
    case "apps":
      return "从快捷方式映射来的软件，一键启动";
    case "favorites":
      return "常用的文件与软件，触手可及";
    case "recent":
      return "按最近打开时间排列";
    case "category":
      return "自定义分类中的文件与软件";
    case "all":
    default:
      return "文件和软件的统一入口";
  }
}

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [settings, setSettings] = useState<Settings>({
    autoBackup: true,
    backupRetention: 10,
    backupInterval: "daily",
    backupOnChange: true,
    autoStart: false,
  });
  const [desktop, setDesktop] = useState<DesktopSettings>({
    zones: [],
    zonesVisible: false,
    searchX: -1,
    searchY: -1,
    searchCustom: false,
    zoneOpacity: 0.78,
  });
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [version, setVersion] = useState("1.0.0");
  const [platform, setPlatform] = useState("windows");
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fatal, setFatal] = useState("");

  const [query, setQuery] = useState("");
  const [activeView, setActiveView] = useState<ActiveView>({ kind: "all" });
  const [sort, setSort] = useStoredState<SortKey>("desknest.sort", "modified");
  const [layout, setLayout] = useStoredState<Layout>("desknest.layout", "grid");
  const [theme, setTheme] = useStoredState<Theme>(
    "desknest.theme",
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [dragCategoryId, setDragCategoryId] = useState<string | null>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastTimers = useRef(new Map<string, number>());
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null);
  const [renameTarget, setRenameTarget] = useState<Item | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
    null,
  );
  const [contextRequest, setContextRequest] = useState<ContextRequest | null>(
    null,
  );
  const [backupOpen, setBackupOpen] = useState(false);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupManifest, setBackupManifest] = useState<BackupManifest | null>(null);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringPath, setRestoringPath] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [zonesModalOpen, setZonesModalOpen] = useState(false);
  const [vaultConfigured, setVaultConfigured] = useState(false);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [vaultModal, setVaultModal] = useState<
    "setup" | "unlock" | "unlocked" | null
  >(null);
  const [pendingVaultAction, setPendingVaultAction] = useState<{
    kind: "open" | "encrypt" | "decrypt";
    item: Item;
  } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragCategoryRef = useRef<string | null>(null);
  const dropHandlerRef = useRef<
    (paths: string[], categoryId?: string) => void
  >(() => undefined);
  const autoChecked = useRef(false);

  const notify = useCallback(
    (tone: ToastTone, title: string, detail?: string) => {
      const id = crypto.randomUUID();
      setToasts((current) => [
        ...current.slice(-3),
        { id, tone, title, detail },
      ]);
      const timer = window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
        toastTimers.current.delete(id);
      }, 4600);
      toastTimers.current.set(id, timer);
    },
    [],
  );

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimers.current.get(id);
    if (timer) window.clearTimeout(timer);
    toastTimers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showError = useCallback(
    (error: unknown, title = "操作失败") => {
      notify("error", title, normalizeError(error));
    },
    [notify],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(
    () => () => {
      for (const timer of toastTimers.current.values()) {
        window.clearTimeout(timer);
      }
    },
    [],
  );

  const applyBootstrap = useCallback((payload: Bootstrap) => {
    setItems(payload.items);
    setCategories(payload.categories);
    setSettings(payload.settings);
    setDesktop(payload.desktop);
    setVaultConfigured(payload.vaultConfigured);
    setVaultUnlocked(payload.vaultUnlocked);
    setStorage(payload.storage);
    setPlatform(payload.platform);
    setVersion(payload.version);
    setInitialized(true);
    setFatal("");
    setSelectedId((current) =>
      current && payload.items.some((item) => item.id === current)
        ? current
        : null,
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api.bootstrap();
      applyBootstrap(payload);
    } catch (error) {
      setFatal(normalizeError(error));
    } finally {
      setLoading(false);
    }
  }, [applyBootstrap]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshStorage = useCallback(async () => {
    try {
      setStorage(await api.storageInfo());
    } catch {
      // A stale size summary should not interrupt the main workflow.
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [nextItems, nextStorage] = await Promise.all([
        api.refreshItems(),
        api.storageInfo(),
      ]);
      setItems(nextItems);
      setStorage(nextStorage);
      setSelectedId((current) =>
        current && nextItems.some((item) => item.id === current)
          ? current
          : null,
      );
    } catch (error) {
      showError(error, "刷新资料库失败");
    } finally {
      setRefreshing(false);
    }
  }, [showError]);

  useEffect(() => {
    const stopPromise = listen("items-changed", () => {
      void api
        .bootstrap()
        .then((bootstrap) => {
          setItems(bootstrap.items);
          setCategories(bootstrap.categories);
          setStorage(bootstrap.storage);
          setSelectedId((current) =>
            current && bootstrap.items.some((item) => item.id === current)
              ? current
              : null,
          );
        })
        .catch(() => undefined);
    });
    return () => {
      void stopPromise.then((stop) => stop());
    };
  }, []);

  const scanLibrary = useCallback(async () => {
    setRefreshing(true);
    try {
      const [nextItems, nextStorage] = await Promise.all([
        api.refreshItems(),
        api.storageInfo(),
      ]);
      setItems(nextItems);
      setStorage(nextStorage);
      setSelectedId((current) =>
        current && nextItems.some((item) => item.id === current) ? current : null,
      );
      const folderCount = nextItems.filter(
        (item) => item.kind === "folder" && item.contentCount > 0,
      ).length;
      notify(
        "success",
        "资料库索引已重建",
        `已扫描 ${nextItems.length} 个保存项目，其中 ${folderCount} 个文件夹已建立内容索引`,
      );
    } catch (error) {
      showError(error, "扫描资料库失败");
    } finally {
      setRefreshing(false);
    }
  }, [notify, showError]);

  const afterImport = useCallback(
    async (result: ImportResult, category?: Category | null) => {
      await refresh();
      if (result.imported.length === 1) {
        setSelectedId(result.imported[0].id);
      }
      if (result.imported.length > 0) {
        notify(
          "success",
          `已导入 ${result.imported.length} 个项目`,
          category
            ? `已保存并归档到「${category.name}」`
            : "文件已复制到统一资料库，快捷方式已建立映射",
        );
      }
      if (result.errors.length > 0) {
        notify(
          "error",
          `${result.errors.length} 个项目导入失败`,
          result.errors[0],
        );
      }
      if (result.imported.length === 0 && result.skipped.length > 0) {
        notify("info", "没有新增项目", result.skipped[0]);
      }
    },
    [notify, refresh],
  );

  const handleImportFiles = useCallback(async () => {
    try {
      const paths = await api.pickFiles();
      if (paths.length === 0) {
        if (!isDesktopRuntime) {
          notify(
            "info",
            "当前是浏览器预览模式",
            "请运行 npm run desktop 打开桌面应用后再导入文件。",
          );
        }
        return;
      }
      setImporting(true);
      const result = await api.importPaths(paths);
      await afterImport(result);
    } catch (error) {
      showError(error, "导入失败");
    } finally {
      setImporting(false);
    }
  }, [afterImport, notify, showError]);

  const handleImportDesktop = useCallback(async () => {
    setImporting(true);
    try {
      const result = await api.importDesktopShortcuts();
      await afterImport(result);
    } catch (error) {
      showError(error, "扫描桌面失败");
    } finally {
      setImporting(false);
    }
  }, [afterImport, showError]);

  const handleDropPaths = useCallback(
    async (paths: string[], categoryId?: string) => {
      if (paths.length === 0) return;
      const category = categoryId
        ? categories.find((candidate) => candidate.id === categoryId)
        : null;
      setImporting(true);
      try {
        const result = await api.importPaths(paths, category?.id);
        await afterImport(result, category);
      } catch (error) {
        showError(error, "拖入导入失败");
      } finally {
        setImporting(false);
      }
    },
    [afterImport, categories, showError],
  );

  dropHandlerRef.current = (paths, categoryId) => {
    void handleDropPaths(paths, categoryId);
  };

  useEffect(() => {
    if (!isDesktopRuntime) {
      const prevent = (event: DragEvent) => event.preventDefault();
      window.addEventListener("dragover", prevent);
      window.addEventListener("drop", prevent);
      return () => {
        window.removeEventListener("dragover", prevent);
        window.removeEventListener("drop", prevent);
      };
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        if (disposed) return;
        unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            const ratio = window.devicePixelRatio || 1;
            const x = payload.position.x / ratio;
            const y = payload.position.y / ratio;
            const element = document
              .elementFromPoint(x, y)
              ?.closest<HTMLElement>("[data-category-id]");
            const categoryId = element?.dataset.categoryId ?? null;
            dragCategoryRef.current = categoryId;
            setDragCategoryId(categoryId);
            setDragActive(true);
            return;
          }
          if (payload.type === "drop") {
            const categoryId = dragCategoryRef.current ?? undefined;
            dragCategoryRef.current = null;
            setDragActive(false);
            setDragCategoryId(null);
            dropHandlerRef.current(payload.paths, categoryId);
            return;
          }
          dragCategoryRef.current = null;
          setDragActive(false);
          setDragCategoryId(null);
        });
      } catch (error) {
        console.error("DeskNest drag-drop listener failed", error);
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!initialized || !isDesktopRuntime || autoChecked.current) return;
    autoChecked.current = true;
    void api
      .runAutoBackup()
      .then(async (backup) => {
        if (!backup) return;
        await refreshStorage();
        notify(
          "success",
          "已生成今日自动备份",
          `${backup.name} · ${formatBytes(backup.size)}`,
        );
      })
      .catch((error) => console.warn("DeskNest auto backup failed", error));
  }, [initialized, notify, refreshStorage]);

  useEffect(() => {
    if (!isDesktopRuntime) return;
    let disposed = false;
    let unlistenSettings: (() => void) | undefined;
    let unlistenOpen: (() => void) | undefined;
    let unlistenVault: (() => void) | undefined;
    let unlistenLocked: (() => void) | undefined;
    void listen<DesktopSettings>("desktop-settings-changed", (event) => {
      setDesktop(event.payload);
    }).then((stop) => {
      if (disposed) stop();
      else unlistenSettings = stop;
    });
    void listen("open-zones-manager", () => {
      setZonesModalOpen(true);
    }).then((stop) => {
      if (disposed) stop();
      else unlistenOpen = stop;
    });
    void listen<VaultStatus>("vault-status-changed", (event) => {
      setVaultConfigured(event.payload.configured);
      setVaultUnlocked(event.payload.unlocked);
    }).then((stop) => {
      if (disposed) stop();
      else unlistenVault = stop;
    });
    void listen("vault-locked", () => {
      setVaultUnlocked(false);
      setVaultModal(null);
      setPendingVaultAction(null);
      notify("info", "保险箱已自动锁定", "锁屏或重启后需要再次输入密码。");
    }).then((stop) => {
      if (disposed) stop();
      else unlistenLocked = stop;
    });
    return () => {
      disposed = true;
      unlistenSettings?.();
      unlistenOpen?.();
      unlistenVault?.();
      unlistenLocked?.();
    };
  }, [notify]);

  useEffect(() => {
    if (
      activeView.kind === "category" &&
      activeView.categoryId &&
      !categories.some((category) => category.id === activeView.categoryId)
    ) {
      setActiveView({ kind: "all" });
    }
  }, [activeView, categories]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeView, query]);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (modifier && event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
        return;
      }
      if (
        event.key === "Escape" &&
        !document.querySelector(".modal-layer")
      ) {
        setContextRequest(null);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  const baseItems = useMemo(() => {
    switch (activeView.kind) {
      case "files":
        return items.filter(
          (item) => item.kind === "file" || item.kind === "folder",
        );
      case "apps":
        return items.filter((item) => item.kind === "app");
      case "favorites":
        return items.filter((item) => item.favorite);
      case "recent":
        return items.filter((item) => item.lastOpened);
      case "category":
        return items.filter((item) =>
          item.categories.includes(activeView.categoryId ?? ""),
        );
      case "all":
      default:
        return items;
    }
  }, [activeView, items]);

  const searchIndex = useMemo(
    () => createSearchIndex(baseItems, categories),
    [baseItems, categories],
  );

  const visibleItems = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed) {
      return searchItems(searchIndex, trimmed);
    }
    if (activeView.kind === "recent") {
      return [...baseItems].sort(
        (a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0),
      );
    }
    return sortItems(baseItems, sort);
  }, [activeView.kind, baseItems, query, searchIndex, sort]);

  const selectedItem = useMemo(
    () =>
      items.find((item) => item.id === selectedId) ??
      visibleItems.find((item) => item.id === selectedId) ??
      null,
    [items, selectedId, visibleItems],
  );

  const currentCategory = useMemo(
    () =>
      activeView.kind === "category"
        ? categories.find((category) => category.id === activeView.categoryId) ??
          null
        : null,
    [activeView, categories],
  );

  const viewLabel = currentCategory?.name ?? viewTitle(activeView, categories);
  const activeDragCategory = dragCategoryId
    ? categories.find((category) => category.id === dragCategoryId)
    : null;

  const handleViewChange = useCallback((view: ActiveView) => {
    setActiveView(view);
    setQuery("");
    setSelectedId(null);
  }, []);

  const openDirect = useCallback(
    async (item: Item) => {
      try {
        await api.openItem(item.id);
        const timestamp = Date.now();
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, lastOpened: timestamp }
              : candidate,
          ),
        );
      } catch (error) {
        showError(
          error,
          item.kind === "app" ? "无法启动软件" : "无法打开文件",
        );
      }
    },
    [showError],
  );

  const runVaultAction = useCallback(
    async (action: { kind: "open" | "encrypt" | "decrypt"; item: Item }) => {
      if (action.kind === "open") {
        await openDirect(action.item);
        return;
      }
      try {
        const updated =
          action.kind === "encrypt"
            ? await api.encryptItem(action.item.id)
            : await api.decryptItem(action.item.id);
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === action.item.id ? updated : candidate,
          ),
        );
        notify(
          "success",
          action.kind === "encrypt" ? "文件已加密" : "文件已解除加密",
          action.item.name,
        );
      } catch (error) {
        showError(
          error,
          action.kind === "encrypt" ? "加密失败" : "解除加密失败",
        );
      }
    },
    [notify, openDirect, showError],
  );

  const requestVaultAction = useCallback(
    (kind: "open" | "encrypt" | "decrypt", item: Item) => {
      if (kind === "encrypt" && !vaultConfigured) {
        setPendingVaultAction({ kind, item });
        setVaultModal("setup");
        return;
      }
      if (!vaultConfigured) {
        showError("请先在保险箱中设置密码", "保险箱尚未设置");
        return;
      }
      if (!vaultUnlocked) {
        setPendingVaultAction({ kind, item });
        setVaultModal("unlock");
        return;
      }
      void runVaultAction({ kind, item });
    },
    [runVaultAction, showError, vaultConfigured, vaultUnlocked],
  );

  const handleOpen = useCallback(
    async (item: Item) => {
      if (item.encrypted) {
        requestVaultAction("open", item);
        return;
      }
      await openDirect(item);
    },
    [openDirect, requestVaultAction],
  );

  const handleVaultStatus = useCallback(
    (status: VaultStatus) => {
      setVaultConfigured(status.configured);
      setVaultUnlocked(status.unlocked);
      if (status.unlocked && pendingVaultAction) {
        const action = pendingVaultAction;
        setPendingVaultAction(null);
        void runVaultAction(action);
      }
    },
    [pendingVaultAction, runVaultAction],
  );

  const openVaultModal = useCallback(() => {
    setVaultModal(
      !vaultConfigured ? "setup" : !vaultUnlocked ? "unlock" : "unlocked",
    );
  }, [vaultConfigured, vaultUnlocked]);

  const handleReveal = useCallback(
    async (item: Item) => {
      try {
        await api.revealItem(item.id);
      } catch (error) {
        showError(error, "无法打开所在文件夹");
      }
    },
    [showError],
  );

  const handleToggleFavorite = useCallback(
    async (item: Item) => {
      const next = !item.favorite;
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, favorite: next }
            : candidate,
        ),
      );
      try {
        const stored = await api.toggleFavorite(item.id);
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, favorite: stored }
              : candidate,
          ),
        );
      } catch (error) {
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, favorite: item.favorite }
              : candidate,
          ),
        );
        showError(error, "更新收藏失败");
      }
    },
    [showError],
  );

  const handleUpdateCategories = useCallback(
    async (item: Item, categoryIds: string[]) => {
      const previous = item.categories;
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, categories: categoryIds }
            : candidate,
        ),
      );
      try {
        await api.setItemCategories(item.id, categoryIds);
      } catch (error) {
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, categories: previous }
              : candidate,
          ),
        );
        showError(error, "更新分类失败");
      }
    },
    [showError],
  );

  const handleAssignCategory = useCallback(
    async (itemId: string, categoryId: string) => {
      const item = items.find((candidate) => candidate.id === itemId);
      const category = categories.find((candidate) => candidate.id === categoryId);
      if (!item || !category) return;
      if (item.categories.includes(categoryId)) {
        notify("info", "已经在这个分类里", `「${item.name}」属于「${category.name}」`);
        return;
      }
      const next = [...item.categories, categoryId];
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === itemId
            ? { ...candidate, categories: next }
            : candidate,
        ),
      );
      try {
        await api.setItemCategories(itemId, next);
        notify("success", `已归档到「${category.name}」`, item.name);
      } catch (error) {
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === itemId
              ? { ...candidate, categories: item.categories }
              : candidate,
          ),
        );
        showError(error, "归档失败");
      }
    },
    [categories, items, notify, showError],
  );

  const saveCategory = useCallback(
    async (name: string, color: string) => {
      if (!categoryDraft) return;
      if (categoryDraft.mode === "create") {
        const created = await api.createCategory(name, color);
        setCategories((current) => [...current, created]);
        notify("success", "分类已创建", `「${created.name}」`);
      } else {
        const updated = await api.updateCategory(
          categoryDraft.category.id,
          name,
          color,
        );
        setCategories((current) =>
          current.map((category) =>
            category.id === updated.id ? updated : category,
          ),
        );
        notify("success", "分类已更新", `「${updated.name}」`);
      }
    },
    [categoryDraft, notify],
  );

  const requestDeleteCategory = useCallback(
    (category: Category) => {
      setCategoryDraft(null);
      setConfirmRequest({
        title: "删除这个分类？",
        message: `「${category.name}」分类将被删除。`,
        detail: "分类中的文件与软件不会被删除，只会失去这个分类标记。",
        confirmLabel: "删除分类",
        tone: "danger",
        action: async () => {
          await api.deleteCategory(category.id);
          setCategories((current) =>
            current.filter((candidate) => candidate.id !== category.id),
          );
          setItems((current) =>
            current.map((item) => ({
              ...item,
              categories: item.categories.filter(
                (categoryId) => categoryId !== category.id,
              ),
            })),
          );
          setActiveView((current) =>
            current.kind === "category" && current.categoryId === category.id
              ? { kind: "all" }
              : current,
          );
          notify("success", "分类已删除", `「${category.name}」`);
        },
      });
    },
    [notify],
  );

  const requestDeleteItem = useCallback(
    (item: Item) => {
      const isApp = item.kind === "app";
      setConfirmRequest({
        title: isApp ? "移除这个软件映射？" : "删除这个文件？",
        message: `「${item.name}」${isApp ? "将从软件库中移除。" : "将移入系统回收站。"}`,
        detail: isApp
          ? "不会卸载原始软件，也不会删除它的安装目录。"
          : "文件会从统一资料库中移除，同时清理对应的分类、收藏与最近打开记录。",
        confirmLabel: isApp ? "移除映射" : "删除文件",
        tone: "danger",
        action: async () => {
          await api.deleteItem(item.id);
          setSelectedId(null);
          setContextRequest(null);
          await refresh();
          notify(
            "success",
            isApp ? "已移除软件映射" : "文件已移入回收站",
            item.name,
          );
        },
      });
    },
    [notify, refresh],
  );

  const saveRename = useCallback(
    async (name: string) => {
      if (!renameTarget) return;
      const updated = await api.renameItem(renameTarget.id, name);
      setItems((current) =>
        current.map((item) =>
          item.id === renameTarget.id ? updated : item,
        ),
      );
      setSelectedId(updated.id);
      setRenameTarget(null);
      notify("success", "已重命名", updated.name);
    },
    [notify, renameTarget],
  );

  const openBackups = useCallback(async () => {
    setBackupOpen(true);
    setBackupsLoading(true);
    try {
      const [list, manifest] = await Promise.all([
        api.listBackups(),
        api.backupManifest(),
      ]);
      setBackups(list);
      setBackupManifest(manifest);
    } catch (error) {
      showError(error, "读取备份列表失败");
    } finally {
      setBackupsLoading(false);
    }
  }, [showError]);

  const refreshBackupManifest = useCallback(async () => {
    try {
      setBackupManifest(await api.backupManifest());
    } catch {
      // Keep the existing manifest if refresh fails.
    }
  }, []);

  const createBackup = useCallback(async () => {
    setCreatingBackup(true);
    try {
      const backup = await api.createBackup();
      await refreshStorage();
      setBackups(await api.listBackups());
      await refreshBackupManifest();
      notify(
        "success",
        "离线备份已完成",
        `${backup.name} · ${formatBytes(backup.size)}`,
      );
    } catch (error) {
      showError(error, "备份失败");
    } finally {
      setCreatingBackup(false);
    }
  }, [notify, refreshBackupManifest, refreshStorage, showError]);

  const requestRestoreBackup = useCallback(
    (backup: BackupInfo) => {
      setConfirmRequest({
        title: "恢复这份备份？",
        message: `将用「${backup.name}」替换当前资料库与软件映射。`,
        detail:
          "恢复前会自动创建一份保护备份。当前正在编辑但尚未保存的内容不会包含在备份中。",
        confirmLabel: "恢复备份",
        tone: "danger",
        action: async () => {
          setRestoringPath(backup.path);
          try {
            const payload = await api.restoreBackup(backup.path);
            applyBootstrap(payload);
            setBackups(await api.listBackups());
            await refreshBackupManifest();
            setSelectedId(null);
            setActiveView({ kind: "all" });
            setQuery("");
            setBackupOpen(false);
            notify("success", "恢复完成", "资料库与软件映射已回滚到备份状态。");
          } finally {
            setRestoringPath(null);
          }
        },
      });
    },
    [applyBootstrap, notify, refreshBackupManifest],
  );

  const requestDeleteBackup = useCallback(
    (backup: BackupInfo) => {
      setConfirmRequest({
        title: "删除这份备份？",
        message: backup.name,
        detail: "只会删除这个本地 ZIP 文件，不会影响当前资料库。",
        confirmLabel: "删除备份",
        tone: "danger",
        action: async () => {
          await api.deleteBackup(backup.path);
          setBackups(await api.listBackups());
          await refreshStorage();
          await refreshBackupManifest();
          notify("success", "备份已删除", backup.name);
        },
      });
    },
    [notify, refreshBackupManifest, refreshStorage],
  );

  const handlePackageRestored = useCallback(
    async (payload: Bootstrap) => {
      applyBootstrap(payload);
      setBackups(await api.listBackups());
      await refreshBackupManifest();
      setSelectedId(null);
      setActiveView({ kind: "all" });
      setQuery("");
      notify("success", "备份包已还原", "资料库、软件映射和设置已整体恢复。");
    },
    [applyBootstrap, notify, refreshBackupManifest],
  );

  const updateBackupSettings = useCallback(
    async (
      autoBackup: boolean,
      retention: number,
      interval: Settings["backupInterval"],
      backupOnChange: boolean,
    ) => {
      const previous = settings;
      setSettings({
        autoBackup,
        backupRetention: retention,
        backupInterval: interval,
        backupOnChange,
        autoStart: settings.autoStart,
      });
      try {
        const updated = await api.updateSettings(
          autoBackup,
          retention,
          interval,
          backupOnChange,
        );
        setSettings(updated);
      } catch (error) {
        setSettings(previous);
        showError(error, "更新备份设置失败");
      }
    },
    [settings, showError],
  );

  const updateAutoStart = useCallback(
    async (enabled: boolean) => {
      const previous = settings;
      setSettings((current) => ({ ...current, autoStart: enabled }));
      try {
        const updated = await api.setAutoStart(enabled);
        setSettings(updated);
        notify(
          "success",
          enabled ? "已开启开机自启动" : "已关闭开机自启动",
          enabled
            ? "下次登录 Windows 后会静默启动到系统托盘"
            : "下次登录 Windows 时不会自动启动 DeskNest",
        );
      } catch (error) {
        setSettings(previous);
        showError(error, "更新开机自启动失败");
      }
    },
    [settings, notify, showError],
  );

  const openFolder = useCallback(
    async (kind: "library" | "backups" | "data" | "shortcuts") => {
      try {
        await api.openFolder(kind);
      } catch (error) {
        showError(error, "无法打开目录");
      }
    },
    [showError],
  );

  const openQuickSearch = useCallback(async () => {
    if (!isDesktopRuntime) {
      notify(
        "info",
        "浮动搜索条需要在桌面应用中打开",
        "运行 npm run desktop 启动 Tauri 窗口后即可使用。",
      );
      return;
    }
    try {
      await api.showQuickSearch();
    } catch (error) {
      showError(error, "无法打开快速搜索");
    }
  }, [notify, showError]);

  const openZonesEditor = useCallback(async () => {
    try {
      const payload = await api.bootstrap();
      setDesktop(payload.desktop);
    } catch {
      // Keep the last known layout if the refresh fails.
    }
    setZonesModalOpen(true);
  }, []);

  const toggleZones = useCallback(async () => {
    try {
      const next = await api.toggleZonesVisibility();
      setDesktop(next);
      notify(
        next.zonesVisible ? "success" : "info",
        next.zonesVisible ? "桌面分区已显示" : "桌面分区已隐藏",
        next.zonesVisible
          ? "点击分区里的文件或软件即可直接打开"
          : "可以随时从左侧或 Ctrl + Shift + D 再次显示",
      );
    } catch (error) {
      showError(error, "切换桌面分区失败");
    }
  }, [notify, showError]);

  const toggleDesktopMode = useCallback(async () => {
    try {
      if (desktop.zonesVisible) {
        const next = await api.setZonesVisible(false);
        setDesktop(next);
        await api.hideQuickSearch();
        notify("info", "桌面模式已关闭", "透明分区与桌面搜索已隐藏");
      } else {
        const next = await api.setZonesVisible(true);
        setDesktop(next);
        notify(
          "success",
          "桌面模式已开启",
          "透明分区与桌面搜索胶囊已显示",
        );
      }
    } catch (error) {
      showError(error, "切换桌面模式失败");
    }
  }, [desktop.zonesVisible, notify, showError]);

  const saveZones = useCallback(
    async (zones: DesktopZone[], visible: boolean) => {
      const next = await api.saveDesktopSettings(zones, visible);
      setDesktop(next);
      notify(
        "success",
        visible ? "桌面分区已更新并显示" : "桌面分区已保存",
        `${next.zones.length} 个分区 · 可直接点击分区内容打开`,
      );
    },
    [notify],
  );

  const handleZoneOpacityChange = useCallback(
    async (opacity: number) => {
      setDesktop((current) => ({ ...current, zoneOpacity: opacity }));
      try {
        const next = await api.setZoneOpacity(opacity);
        setDesktop(next);
      } catch (reason) {
        notify(
          "error",
          "无法保存分区透明度",
          reason instanceof Error ? reason.message : String(reason),
        );
      }
    },
    [notify],
  );

  if (loading && !initialized) {
    return (
      <div className="boot-screen">
        <img src="/mark.svg" alt="" className="boot-mark" />
        <div className="boot-copy">
          <strong>DeskNest</strong>
          <span>正在整理你的桌面…</span>
        </div>
        <span className="boot-line" />
      </div>
    );
  }

  if (fatal && !initialized) {
    return (
      <div className="boot-screen error">
        <img src="/mark.svg" alt="" className="boot-mark" />
        <div className="boot-copy">
          <strong>DeskNest 无法启动</strong>
          <span>{fatal}</span>
        </div>
        <button type="button" className="button button-primary" onClick={() => void load()}>
          <RefreshCw size={15} /> 重试
        </button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        items={items}
        categories={categories}
        activeView={activeView}
        lastBackup={storage?.lastBackup ?? null}
        externalCategoryId={dragCategoryId}
        zonesVisible={desktop.zonesVisible}
        onViewChange={handleViewChange}
        onCreateCategory={() => setCategoryDraft({ mode: "create" })}
        onEditCategory={(category) => setCategoryDraft({ mode: "edit", category })}
        onOpenBackups={() => void openBackups()}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenQuickSearch={() => void openQuickSearch()}
        onOpenZones={() => void openZonesEditor()}
        onToggleZones={() => void toggleZones()}
        onItemDroppedOnCategory={(itemId, categoryId) =>
          void handleAssignCategory(itemId, categoryId)
        }
      />

      <main className="main-shell">
        <Topbar
          query={query}
          searchRef={searchRef}
          theme={theme}
          importing={importing}
          loading={refreshing}
          vaultConfigured={vaultConfigured}
          vaultUnlocked={vaultUnlocked}
          desktopMode={desktop.zonesVisible}
          onQueryChange={setQuery}
          onClearQuery={() => setQuery("")}
          onImportFiles={() => void handleImportFiles()}
          onImportDesktop={() => void handleImportDesktop()}
          onRefresh={() => void refresh()}
          onScan={() => void scanLibrary()}
          onOpenBackups={() => void openBackups()}
          onOpenVault={openVaultModal}
          onToggleDesktopMode={() => void toggleDesktopMode()}
          onToggleTheme={() =>
            setTheme((current) => (current === "light" ? "dark" : "light"))
          }
        />

        <div className="content" ref={contentRef}>
          <div className={`page-heading ${query ? "searching" : ""}`}>
            <div className="page-heading-copy">
              <p className="eyebrow">
                {query ? "SEARCH RESULTS" : viewEyebrow(activeView)}
              </p>
              <h1>{query ? "搜索结果" : viewLabel}</h1>
              <p className="page-sub">
                {query
                  ? `在「${viewLabel}」中查找 “${query.trim()}”`
                  : viewDescription(activeView)}
                <span className="dot-separator" />
                <strong>{visibleItems.length}</strong> 个项目
              </p>
            </div>

            <div className="view-tools">
              {query ? (
                <span className="relevance-label">按相关度</span>
              ) : (
                <label className="sort-control" title="排序方式">
                  <ArrowDownWideNarrow size={15} />
                  <select
                    value={sort}
                    onChange={(event) =>
                      setSort(event.target.value as SortKey)
                    }
                    aria-label="排序方式"
                  >
                    <option value="modified">最近更新</option>
                    <option value="name">名称 A–Z</option>
                    <option value="size">文件大小</option>
                    <option value="opened">最近打开</option>
                  </select>
                </label>
              )}
              <div className="segmented" role="group" aria-label="布局">
                <button
                  type="button"
                  className={layout === "grid" ? "active" : ""}
                  onClick={() => setLayout("grid")}
                  aria-label="网格视图"
                  title="网格视图"
                >
                  <Grid2X2 size={15} />
                </button>
                <button
                  type="button"
                  className={layout === "list" ? "active" : ""}
                  onClick={() => setLayout("list")}
                  aria-label="列表视图"
                  title="列表视图"
                >
                  <List size={16} />
                </button>
              </div>
            </div>
          </div>

          {visibleItems.length === 0 ? (
            <EmptyState
              query={query.trim()}
              viewLabel={viewLabel}
              isCategory={activeView.kind === "category"}
              onImportFiles={() => void handleImportFiles()}
              onImportDesktop={() => void handleImportDesktop()}
              onClearSearch={() => setQuery("")}
            />
          ) : layout === "grid" ? (
            <div className="item-grid">
              {visibleItems.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  categories={categories}
                  selected={item.id === selectedId}
                  onSelect={(selected) => setSelectedId(selected.id)}
                  onOpen={(target) => void handleOpen(target)}
                  onToggleFavorite={(target) => void handleToggleFavorite(target)}
                  onContextMenu={(target, x, y) => {
                    setSelectedId(target.id);
                    setContextRequest({ item: target, x, y });
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="item-list">
              <div className="list-header" aria-hidden="true">
                <span />
                <span>名称</span>
                <span>分类</span>
                <span>大小</span>
                <span>修改时间</span>
                <span />
              </div>
              {visibleItems.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  categories={categories}
                  selected={item.id === selectedId}
                  onSelect={(selected) => setSelectedId(selected.id)}
                  onOpen={(target) => void handleOpen(target)}
                  onToggleFavorite={(target) => void handleToggleFavorite(target)}
                  onContextMenu={(target, x, y) => {
                    setSelectedId(target.id);
                    setContextRequest({ item: target, x, y });
                  }}
                />
              ))}
            </div>
          )}

          {importing && (
            <div className="import-strip">
              <Loader2 size={15} className="spin" />
              正在复制文件、解析快捷方式并建立索引…
            </div>
          )}
        </div>
      </main>

      {selectedItem && (
        <DetailPanel
          item={selectedItem}
          categories={categories}
          vaultConfigured={vaultConfigured}
          vaultUnlocked={vaultUnlocked}
          onClose={() => setSelectedId(null)}
          onOpen={(item) => void handleOpen(item)}
          onReveal={(item) => void handleReveal(item)}
          onToggleFavorite={(item) => void handleToggleFavorite(item)}
          onRename={setRenameTarget}
          onDelete={requestDeleteItem}
          onUpdateCategories={(item, ids) =>
            void handleUpdateCategories(item, ids)
          }
          onCreateCategory={() => setCategoryDraft({ mode: "create" })}
          onEncrypt={(item) => requestVaultAction("encrypt", item)}
          onDecrypt={(item) => requestVaultAction("decrypt", item)}
          onNotify={(title) => notify("success", title)}
        />
      )}

      {contextRequest && (
        <ContextMenu
          item={contextRequest.item}
          x={contextRequest.x}
          y={contextRequest.y}
          onClose={() => setContextRequest(null)}
          onOpen={(item) => void handleOpen(item)}
          onReveal={(item) => void handleReveal(item)}
          onToggleFavorite={(item) => void handleToggleFavorite(item)}
          onRename={setRenameTarget}
          onDelete={requestDeleteItem}
          onManageCategories={(item) => setSelectedId(item.id)}
        />
      )}

      {categoryDraft && (
        <CategoryModal
          mode={categoryDraft.mode}
          category={
            categoryDraft.mode === "edit" ? categoryDraft.category : undefined
          }
          onClose={() => setCategoryDraft(null)}
          onSave={saveCategory}
          onDelete={
            categoryDraft.mode === "edit"
              ? requestDeleteCategory
              : undefined
          }
        />
      )}

      {renameTarget && (
        <RenameDialog
          item={renameTarget}
          onClose={() => setRenameTarget(null)}
          onSave={saveRename}
        />
      )}

      {confirmRequest && (
        <ConfirmDialog
          title={confirmRequest.title}
          message={confirmRequest.message}
          detail={confirmRequest.detail}
          confirmLabel={confirmRequest.confirmLabel}
          tone={confirmRequest.tone}
          onClose={() => setConfirmRequest(null)}
          onConfirm={confirmRequest.action}
        />
      )}

      {backupOpen && (
        <BackupModal
          backups={backups}
          loading={backupsLoading}
          creating={creatingBackup}
          restoringPath={restoringPath}
          settings={settings}
          manifest={backupManifest}
          lastBackup={storage?.lastBackup ?? null}
          onClose={() => setBackupOpen(false)}
          onCreate={() => void createBackup()}
          onRestore={requestRestoreBackup}
          onDelete={requestDeleteBackup}
          onOpenFolder={() => void openFolder("backups")}
          onToggleAuto={(value) =>
            void updateBackupSettings(
              value,
              settings.backupRetention,
              settings.backupInterval,
              settings.backupOnChange,
            )
          }
          onRetentionChange={(value) =>
            void updateBackupSettings(
              settings.autoBackup,
              value,
              settings.backupInterval,
              settings.backupOnChange,
            )
          }
          onIntervalChange={(value) =>
            void updateBackupSettings(
              settings.autoBackup,
              settings.backupRetention,
              value,
              settings.backupOnChange,
            )
          }
          onToggleChange={(value) =>
            void updateBackupSettings(
              settings.autoBackup,
              settings.backupRetention,
              settings.backupInterval,
              value,
            )
          }
          onPackageRestored={handlePackageRestored}
        />
      )}

      {settingsOpen && storage && (
        <SettingsModal
          storage={storage}
          desktop={desktop}
          vaultConfigured={vaultConfigured}
          vaultUnlocked={vaultUnlocked}
          version={version}
          platform={platform}
          theme={theme}
          autoStart={settings.autoStart}
          onClose={() => setSettingsOpen(false)}
          onThemeChange={setTheme}
          onAutoStartChange={(enabled) => void updateAutoStart(enabled)}
          onZoneOpacityChange={handleZoneOpacityChange}
          onOpenFolder={(kind) => void openFolder(kind)}
          onOpenBackups={() => {
            setSettingsOpen(false);
            void openBackups();
          }}
          onImportDesktop={() => {
            setSettingsOpen(false);
            void handleImportDesktop();
          }}
          onOpenQuickSearch={() => {
            setSettingsOpen(false);
            void openQuickSearch();
          }}
          onOpenZones={() => {
            setSettingsOpen(false);
            void openZonesEditor();
          }}
          onOpenVault={() => {
            setSettingsOpen(false);
            openVaultModal();
          }}
        />
      )}

      {zonesModalOpen && (
        <ZonesModal
          desktop={desktop}
          categories={categories}
          items={items}
          onClose={() => setZonesModalOpen(false)}
          onSave={saveZones}
        />
      )}

      {vaultModal && (
        <VaultModal
          mode={vaultModal}
          encryptedCount={items.filter((item) => item.encrypted).length}
          onClose={() => {
            setVaultModal(null);
            setPendingVaultAction(null);
          }}
          onStatus={handleVaultStatus}
        />
      )}

      <DropOverlay
        active={dragActive}
        categoryName={activeDragCategory?.name ?? null}
        importing={importing}
      />

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
