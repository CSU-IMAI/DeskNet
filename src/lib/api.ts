import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  BackupInfo,
  BackupManifest,
  BackupPackageInfo,
  Bootstrap,
  Category,
  DesktopSettings,
  DesktopZone,
  DragPathInfo,
  ImportResult,
  Item,
  Settings,
  StorageInfo,
  VaultStatus,
} from "../types";

export const isDesktopRuntime =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

const now = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;

const demoCategories: Category[] = [
  { id: "cat-work", name: "工作", color: "#5f7f6b", createdAt: now - 30 * DAY },
  { id: "cat-design", name: "设计", color: "#d96343", createdAt: now - 25 * DAY },
  { id: "cat-study", name: "学习", color: "#6c7fb4", createdAt: now - 20 * DAY },
  { id: "cat-media", name: "素材", color: "#c79a4b", createdAt: now - 14 * DAY },
  { id: "cat-tools", name: "工具", color: "#5e93a1", createdAt: now - 9 * DAY },
];

function fileItem(
  name: string,
  extension: string,
  size: number,
  age: number,
  categories: string[],
  favorite = false,
  opened: number | null = null,
): Item {
  return {
    id: `file:${name}`,
    key: name,
    kind: "file",
    name,
    path: `C:\\Users\\Thinpad\\DeskNest\\library\\${name}`,
    target: null,
    extension,
    size,
    modified: now - age,
    categories,
    favorite,
    lastOpened: opened,
    missing: false,
    source: null,
    createdAt: now - age - 4 * DAY,
    encrypted: false,
    originalSize: size,
    icon: null,
  };
}

function appItem(
  name: string,
  extension: string,
  target: string,
  source: string,
  categories: string[],
  favorite = false,
  opened: number | null = null,
): Item {
  return {
    id: `app:${name}`,
    key: name,
    kind: "app",
    name,
    path: target,
    target,
    extension,
    size: 0,
    modified: now - 3 * DAY,
    categories,
    favorite,
    lastOpened: opened,
    missing: false,
    source,
    createdAt: now - 45 * DAY,
    encrypted: false,
    originalSize: null,
    icon: null,
  };
}

const demoItems: Item[] = [
  fileItem("2026 产品路线图.docx", "docx", 1_248_000, 2 * HOUR, ["cat-work"], false, now - 4 * HOUR),
  appItem(
    "Figma",
    "lnk",
    "C:\\Program Files\\Figma\\Figma.exe",
    "Windows 快捷方式",
    ["cat-design", "cat-tools"],
    true,
    now - 18 * 60_000,
  ),
  fileItem("品牌视觉规范.pdf", "pdf", 8_812_000, DAY, ["cat-design"], true, now - DAY),
  appItem(
    "Visual Studio Code",
    "lnk",
    "C:\\Users\\Thinpad\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
    "Windows 快捷方式",
    ["cat-work", "cat-tools"],
    true,
    now - 2 * HOUR,
  ),
  fileItem("DeskNest 需求池.xlsx", "xlsx", 184_320, 5 * HOUR, ["cat-work"]),
  fileItem("产品演示.mp4", "mp4", 134_217_728, 3 * DAY, ["cat-media"]),
  appItem("Notion", "url", "https://www.notion.so", "网址快捷方式", ["cat-work"], false, now - 3 * DAY),
  fileItem("官网首页.fig", "fig", 25_165_824, 4 * HOUR, ["cat-design"], false, now - 6 * HOUR),
  fileItem("会议记录 10.31.md", "md", 12_480, 40 * 60_000, ["cat-study"]),
  appItem(
    "Blender",
    "lnk",
    "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe",
    "Windows 快捷方式",
    ["cat-design", "cat-media"],
    false,
    now - 6 * DAY,
  ),
  fileItem("季度复盘.pptx", "pptx", 7_126_000, 2 * DAY, ["cat-work"], false, now - 2 * DAY),
  appItem(
    "Arc",
    "lnk",
    "C:\\Users\\Thinpad\\AppData\\Local\\Programs\\Arc\\Arc.exe",
    "Windows 快捷方式",
    ["cat-tools"],
    false,
    now - 30 * 60_000,
  ),
  fileItem("客户访谈录音.mp3", "mp3", 38_400_000, 5 * DAY, ["cat-media", "cat-study"]),
  fileItem("界面草图.png", "png", 2_240_000, 7 * HOUR, ["cat-design"]),
];

let demoStore = {
  items: demoItems,
  categories: demoCategories,
  settings: {
    autoBackup: true,
    backupRetention: 10,
    backupInterval: "daily",
    backupOnChange: true,
  } as Settings,
  desktop: {
    zonesVisible: true,
    searchX: -1,
    searchY: -1,
    searchCustom: false,
    zoneOpacity: 0.78,
    zones: [
      {
        id: "zone-programs",
        name: "程序区",
        color: "#5f7f6b",
        filter: "apps",
        categoryId: null,
        x: 0.055,
        y: 0.18,
        width: 0.28,
        height: 0.34,
        createdAt: now - 20 * DAY,
      },
      {
        id: "zone-files",
        name: "文件区",
        color: "#d96343",
        filter: "files",
        categoryId: null,
        x: 0.365,
        y: 0.18,
        width: 0.28,
        height: 0.34,
        createdAt: now - 20 * DAY,
      },
      {
        id: "zone-encrypted",
        name: "加密区",
        color: "#7b6b9c",
        filter: "encrypted",
        categoryId: null,
        x: 0.675,
        y: 0.18,
        width: 0.28,
        height: 0.34,
        createdAt: now - 20 * DAY,
      },
    ],
  } as DesktopSettings,
  vaultConfigured: false,
  vaultUnlocked: false,
  backups: [
    {
      path: "C:\\Users\\Thinpad\\AppData\\Roaming\\com.desknest.manager\\backups\\DeskNest-Backup-20261031-133000.zip",
      name: "DeskNest-Backup-20261031-133000.zip",
      size: 198_400_000,
      createdAt: now - 2 * HOUR,
      kind: "manual",
    },
    {
      path: "C:\\Users\\Thinpad\\AppData\\Roaming\\com.desknest.manager\\backups\\DeskNest-Auto-20261030-090000.zip",
      name: "DeskNest-Auto-20261030-090000.zip",
      size: 191_200_000,
      createdAt: now - DAY,
      kind: "auto",
    },
    {
      path: "C:\\Users\\Thinpad\\AppData\\Roaming\\com.desknest.manager\\backups\\DeskNest-PreRestore-20261028-181500.zip",
      name: "DeskNest-PreRestore-20261028-181500.zip",
      size: 187_600_000,
      createdAt: now - 2 * DAY,
      kind: "pre-restore",
    },
  ] as BackupInfo[],
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function demoStorage(): StorageInfo {
  const bytes = demoStore.items.reduce((sum, item) => sum + item.size, 0);
  const lastBackup = demoStore.backups.reduce(
    (latest, backup) => Math.max(latest, backup.createdAt),
    0,
  );
  return {
    dataRoot: "C:\\Users\\Thinpad\\AppData\\Roaming\\com.desknest.manager",
    libraryPath: "C:\\Users\\Thinpad\\AppData\\Roaming\\com.desknest.manager\\library",
    backupPath: "C:\\Users\\Thinpad\\AppData\\Roaming\\com.desknest.manager\\backups",
    shortcutsPath: "C:\\Users\\Thinpad\\AppData\\Roaming\\com.desknest.manager\\shortcuts",
    fileCount: demoStore.items.filter((item) => item.kind === "file").length,
    appCount: demoStore.items.filter((item) => item.kind === "app").length,
    totalSize: bytes,
    lastBackup: lastBackup || null,
  };
}

function demoBootstrap(): Bootstrap {
  return {
    items: clone(demoStore.items),
    categories: clone(demoStore.categories),
    settings: clone(demoStore.settings),
    desktop: clone(demoStore.desktop),
    storage: demoStorage(),
    platform: "windows",
    dataRoot: "C:\\Users\\Thinpad\\AppData\\Roaming\\com.desknest.manager",
    version: "1.0.0",
    vaultConfigured: demoStore.vaultConfigured,
    vaultUnlocked: demoStore.vaultUnlocked,
  };
}

function demoError(message: string): never {
  throw new Error(message);
}

const demoApi = {
  async bootstrap(): Promise<Bootstrap> {
    return demoBootstrap();
  },
  async refreshItems(): Promise<Item[]> {
    return clone(demoStore.items);
  },
  async pickFiles(): Promise<string[]> {
    return [];
  },
  async importPaths(paths: string[]): Promise<ImportResult> {
    return {
      imported: [],
      importedKeys: [],
      skipped: paths.map((path) => `${path}（浏览器预览模式不会复制文件）`),
      errors: [],
    };
  },
  async classifyPaths(paths: string[]): Promise<DragPathInfo[]> {
    return paths.map((path) => ({
      path,
      kind: /\.(exe|lnk|url|desktop|appimage)$/i.test(path)
        ? ("app" as const)
        : ("file" as const),
    }));
  },
  async importDesktopShortcuts(): Promise<ImportResult> {
    return {
      imported: [],
      importedKeys: [],
      skipped: ["浏览器预览模式不会读取桌面"],
      errors: [],
    };
  },
  async openItem(id: string): Promise<void> {
    const item = demoStore.items.find((candidate) => candidate.id === id);
    if (!item) demoError("项目不存在");
    if (item.encrypted && !demoStore.vaultUnlocked) {
      demoError("保险箱已锁定，请输入密码后再查看");
    }
    item.lastOpened = Date.now();
  },
  async revealItem(): Promise<void> {
    return;
  },
  async openFolder(): Promise<void> {
    return;
  },
  async deleteItem(id: string): Promise<void> {
    demoStore.items = demoStore.items.filter((item) => item.id !== id);
  },
  async renameItem(id: string, name: string): Promise<Item> {
    const item = demoStore.items.find((candidate) => candidate.id === id);
    if (!item) demoError("项目不存在");
    item.name = name;
    return clone(item);
  },
  async toggleFavorite(id: string): Promise<boolean> {
    const item = demoStore.items.find((candidate) => candidate.id === id);
    if (!item) demoError("项目不存在");
    item.favorite = !item.favorite;
    return item.favorite;
  },
  async setItemCategories(id: string, categoryIds: string[]): Promise<void> {
    const item = demoStore.items.find((candidate) => candidate.id === id);
    if (!item) demoError("项目不存在");
    item.categories = [...categoryIds];
  },
  async createCategory(name: string, color: string): Promise<Category> {
    const category: Category = {
      id: `cat-${Date.now()}`,
      name,
      color,
      createdAt: Date.now(),
    };
    demoStore.categories.push(category);
    return clone(category);
  },
  async updateCategory(id: string, name: string, color: string): Promise<Category> {
    const category = demoStore.categories.find((candidate) => candidate.id === id);
    if (!category) demoError("分类不存在");
    category.name = name;
    category.color = color;
    return clone(category);
  },
  async deleteCategory(id: string): Promise<void> {
    demoStore.categories = demoStore.categories.filter((category) => category.id !== id);
    for (const item of demoStore.items) {
      item.categories = item.categories.filter((categoryId) => categoryId !== id);
    }
  },
  async updateSettings(
    autoBackup: boolean,
    backupRetention: number,
    backupInterval: Settings["backupInterval"],
    backupOnChange: boolean,
  ): Promise<Settings> {
    demoStore.settings = {
      autoBackup,
      backupRetention,
      backupInterval,
      backupOnChange,
    };
    return { ...demoStore.settings };
  },
  async backupManifest(): Promise<BackupManifest> {
    return {
      lastBackup: demoStore.backups[0]?.createdAt ?? null,
      backedUp: demoStore.items
        .filter((item) => item.kind === "file")
        .map((item) => ({
          key: item.key,
          name: item.name,
          size: item.size,
          modified: item.modified,
          backedUp: true,
        })),
      pending: [],
    };
  },
  async listBackups(): Promise<BackupInfo[]> {
    return clone(demoStore.backups);
  },
  async createBackup(): Promise<BackupInfo> {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, "")
      .slice(0, 14);
    const backup: BackupInfo = {
      path: `C:\\Users\\Thinpad\\AppData\\Roaming\\com.desknest.manager\\backups\\DeskNest-Backup-${stamp}.zip`,
      name: `DeskNest-Backup-${stamp}.zip`,
      size: demoStorage().totalSize + 42_000,
      createdAt: Date.now(),
      kind: "manual",
    };
    demoStore.backups.unshift(backup);
    return clone(backup);
  },
  async restoreBackup(): Promise<Bootstrap> {
    return demoBootstrap();
  },
  async deleteBackup(path: string): Promise<void> {
    demoStore.backups = demoStore.backups.filter((backup) => backup.path !== path);
  },
  async exportBackupPackage(): Promise<BackupPackageInfo> {
    return {
      path: "C:\\Users\\Thinpad\\Desktop\\DeskNest-Backup.dnb",
      name: "DeskNest-Backup.dnb",
      size: 32 * 1024 * 1024,
      createdAt: Date.now(),
      includedBackups: 1,
    };
  },
  async restoreBackupPackage(): Promise<Bootstrap> {
    return demoBootstrap();
  },
  async runAutoBackup(): Promise<BackupInfo | null> {
    return null;
  },
  async clearRecent(): Promise<void> {
    for (const item of demoStore.items) item.lastOpened = null;
  },
  async showQuickSearch(): Promise<void> {
    return;
  },
  async hideQuickSearch(): Promise<void> {
    return;
  },
  async toggleQuickSearch(): Promise<void> {
    return;
  },
  async setZonesVisible(visible: boolean): Promise<DesktopSettings> {
    demoStore.desktop.zonesVisible = visible;
    return clone(demoStore.desktop);
  },
  async toggleZonesVisibility(): Promise<DesktopSettings> {
    demoStore.desktop.zonesVisible = !demoStore.desktop.zonesVisible;
    return clone(demoStore.desktop);
  },
  async saveDesktopSettings(
    zones: DesktopZone[],
    zonesVisible: boolean,
  ): Promise<DesktopSettings> {
    demoStore.desktop = {
      ...demoStore.desktop,
      zones: clone(zones),
      zonesVisible,
    };
    return clone(demoStore.desktop);
  },
  async updateSearchPosition(x: number, y: number): Promise<void> {
    demoStore.desktop.searchX = x;
    demoStore.desktop.searchY = y;
  },
  async setZoneOpacity(opacity: number): Promise<DesktopSettings> {
    demoStore.desktop.zoneOpacity = opacity;
    return clone(demoStore.desktop);
  },
  async updateZoneBounds(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<void> {
    const zone = demoStore.desktop.zones.find((entry) => entry.id === id);
    if (!zone) return;
    zone.x = x;
    zone.y = y;
    zone.width = width;
    zone.height = height;
  },
  async openZonesManager(): Promise<void> {
    return;
  },
  async getVaultStatus(): Promise<VaultStatus> {
    return {
      configured: demoStore.vaultConfigured,
      unlocked: demoStore.vaultUnlocked,
      encryptedCount: demoStore.items.filter((item) => item.encrypted).length,
    };
  },
  async configureVault(): Promise<VaultStatus> {
    demoStore.vaultConfigured = true;
    demoStore.vaultUnlocked = true;
    return this.getVaultStatus();
  },
  async unlockVault(): Promise<VaultStatus> {
    if (!demoStore.vaultConfigured) demoError("请先设置保险箱密码");
    demoStore.vaultUnlocked = true;
    return this.getVaultStatus();
  },
  async lockVault(): Promise<VaultStatus> {
    demoStore.vaultUnlocked = false;
    return this.getVaultStatus();
  },
  async encryptItem(id: string): Promise<Item> {
    if (!demoStore.vaultUnlocked) demoError("保险箱已锁定");
    const item = demoStore.items.find((candidate) => candidate.id === id);
    if (!item) demoError("项目不存在");
    item.encrypted = true;
    item.originalSize = item.size;
    return clone(item);
  },
  async decryptItem(id: string): Promise<Item> {
    if (!demoStore.vaultUnlocked) demoError("保险箱已锁定");
    const item = demoStore.items.find((candidate) => candidate.id === id);
    if (!item) demoError("项目不存在");
    item.encrypted = false;
    item.originalSize = null;
    return clone(item);
  },
  async storageInfo(): Promise<StorageInfo> {
    return demoStorage();
  },
  async changeStoragePath(): Promise<void> {
    return;
  },
};

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(normalizeError(error));
  }
}

export const api = {
  bootstrap: (): Promise<Bootstrap> =>
    isDesktopRuntime ? call<Bootstrap>("bootstrap") : demoApi.bootstrap(),
  refreshItems: (): Promise<Item[]> =>
    isDesktopRuntime ? call<Item[]>("refresh_items") : demoApi.refreshItems(),
  pickFiles: async (): Promise<string[]> => {
    if (!isDesktopRuntime) return demoApi.pickFiles();
    const result = await openDialog({
      multiple: true,
      directory: false,
      title: "选择要导入的文件或软件快捷方式",
    });
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  },
  importPaths: (paths: string[], categoryId?: string): Promise<ImportResult> =>
    isDesktopRuntime
      ? call<ImportResult>("import_paths", { paths, categoryId: categoryId ?? null })
      : demoApi.importPaths(paths),
  classifyPaths: (paths: string[]): Promise<DragPathInfo[]> =>
    isDesktopRuntime
      ? call<DragPathInfo[]>("classify_paths", { paths })
      : demoApi.classifyPaths(paths),
  importDesktopShortcuts: (): Promise<ImportResult> =>
    isDesktopRuntime
      ? call<ImportResult>("import_desktop_shortcuts")
      : demoApi.importDesktopShortcuts(),
  openItem: (id: string): Promise<void> =>
    isDesktopRuntime ? call<void>("open_item", { id }) : demoApi.openItem(id),
  revealItem: (id: string): Promise<void> =>
    isDesktopRuntime ? call<void>("reveal_item", { id }) : demoApi.revealItem(),
  openFolder: (kind: "library" | "backups" | "shortcuts" | "data"): Promise<void> =>
    isDesktopRuntime ? call<void>("open_folder", { kind }) : demoApi.openFolder(),
  deleteItem: (id: string): Promise<void> =>
    isDesktopRuntime ? call<void>("delete_item", { id }) : demoApi.deleteItem(id),
  renameItem: (id: string, name: string): Promise<Item> =>
    isDesktopRuntime
      ? call<Item>("rename_item", { id, name })
      : demoApi.renameItem(id, name),
  toggleFavorite: (id: string): Promise<boolean> =>
    isDesktopRuntime
      ? call<boolean>("toggle_favorite", { id })
      : demoApi.toggleFavorite(id),
  setItemCategories: (id: string, categoryIds: string[]): Promise<void> =>
    isDesktopRuntime
      ? call<void>("set_item_categories", { id, categoryIds })
      : demoApi.setItemCategories(id, categoryIds),
  createCategory: (name: string, color: string): Promise<Category> =>
    isDesktopRuntime
      ? call<Category>("create_category", { name, color })
      : demoApi.createCategory(name, color),
  updateCategory: (id: string, name: string, color: string): Promise<Category> =>
    isDesktopRuntime
      ? call<Category>("update_category", { id, name, color })
      : demoApi.updateCategory(id, name, color),
  deleteCategory: (id: string): Promise<void> =>
    isDesktopRuntime
      ? call<void>("delete_category", { id })
      : demoApi.deleteCategory(id),
  updateSettings: (
    autoBackup: boolean,
    backupRetention: number,
    backupInterval: Settings["backupInterval"],
    backupOnChange: boolean,
  ): Promise<Settings> =>
    isDesktopRuntime
      ? call<Settings>("update_settings", {
          autoBackup,
          backupRetention,
          backupInterval,
          backupOnChange,
        })
      : demoApi.updateSettings(
          autoBackup,
          backupRetention,
          backupInterval,
          backupOnChange,
        ),
  backupManifest: (): Promise<BackupManifest> =>
    isDesktopRuntime
      ? call<BackupManifest>("backup_manifest")
      : demoApi.backupManifest(),
  listBackups: (): Promise<BackupInfo[]> =>
    isDesktopRuntime ? call<BackupInfo[]>("list_backups") : demoApi.listBackups(),
  createBackup: (): Promise<BackupInfo> =>
    isDesktopRuntime ? call<BackupInfo>("create_backup") : demoApi.createBackup(),
  restoreBackup: (path: string): Promise<Bootstrap> =>
    isDesktopRuntime
      ? call<Bootstrap>("restore_backup", { path })
      : demoApi.restoreBackup(),
  deleteBackup: (path: string): Promise<void> =>
    isDesktopRuntime
      ? call<void>("delete_backup", { path })
      : demoApi.deleteBackup(path),
  exportBackupPackage: (
    path: string,
    password: string,
  ): Promise<BackupPackageInfo> =>
    isDesktopRuntime
      ? call<BackupPackageInfo>("export_backup_package", { path, password })
      : demoApi.exportBackupPackage(),
  restoreBackupPackage: (
    path: string,
    password: string,
  ): Promise<Bootstrap> =>
    isDesktopRuntime
      ? call<Bootstrap>("restore_backup_package", { path, password })
      : demoApi.restoreBackupPackage(),
  runAutoBackup: (): Promise<BackupInfo | null> =>
    isDesktopRuntime
      ? call<BackupInfo | null>("run_auto_backup")
      : demoApi.runAutoBackup(),
  clearRecent: (): Promise<void> =>
    isDesktopRuntime ? call<void>("clear_recent") : demoApi.clearRecent(),
  showQuickSearch: (): Promise<void> =>
    isDesktopRuntime ? call<void>("show_quick_search") : demoApi.showQuickSearch(),
  hideQuickSearch: (): Promise<void> =>
    isDesktopRuntime ? call<void>("hide_quick_search") : demoApi.hideQuickSearch(),
  toggleQuickSearch: (): Promise<void> =>
    isDesktopRuntime
      ? call<void>("toggle_quick_search")
      : demoApi.toggleQuickSearch(),
  setZonesVisible: (visible: boolean): Promise<DesktopSettings> =>
    isDesktopRuntime
      ? call<DesktopSettings>("set_zones_visible", { visible })
      : demoApi.setZonesVisible(visible),
  toggleZonesVisibility: (): Promise<DesktopSettings> =>
    isDesktopRuntime
      ? call<DesktopSettings>("toggle_zones_visibility")
      : demoApi.toggleZonesVisibility(),
  saveDesktopSettings: (
    zones: DesktopZone[],
    zonesVisible: boolean,
  ): Promise<DesktopSettings> =>
    isDesktopRuntime
      ? call<DesktopSettings>("save_desktop_settings", { zones, zonesVisible })
      : demoApi.saveDesktopSettings(zones, zonesVisible),
  updateZoneBounds: (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<void> =>
    isDesktopRuntime
      ? call<void>("update_zone_bounds", { id, x, y, width, height })
      : demoApi.updateZoneBounds(id, x, y, width, height),
  updateSearchPosition: (x: number, y: number): Promise<void> =>
    isDesktopRuntime
      ? call<void>("update_search_position", { x, y })
      : demoApi.updateSearchPosition(x, y),
  setZoneOpacity: (opacity: number): Promise<DesktopSettings> =>
    isDesktopRuntime
      ? call<DesktopSettings>("set_zone_opacity", { opacity })
      : demoApi.setZoneOpacity(opacity),
  openZonesManager: (): Promise<void> =>
    isDesktopRuntime
      ? call<void>("open_zones_manager")
      : demoApi.openZonesManager(),
  getVaultStatus: (): Promise<VaultStatus> =>
    isDesktopRuntime
      ? call<VaultStatus>("get_vault_status")
      : demoApi.getVaultStatus(),
  configureVault: (password: string): Promise<VaultStatus> =>
    isDesktopRuntime
      ? call<VaultStatus>("configure_vault", { password })
      : demoApi.configureVault(),
  unlockVault: (password: string): Promise<VaultStatus> =>
    isDesktopRuntime
      ? call<VaultStatus>("unlock_vault", { password })
      : demoApi.unlockVault(),
  lockVault: (): Promise<VaultStatus> =>
    isDesktopRuntime ? call<VaultStatus>("lock_vault") : demoApi.lockVault(),
  encryptItem: (id: string): Promise<Item> =>
    isDesktopRuntime
      ? call<Item>("encrypt_item", { id })
      : demoApi.encryptItem(id),
  decryptItem: (id: string): Promise<Item> =>
    isDesktopRuntime
      ? call<Item>("decrypt_item", { id })
      : demoApi.decryptItem(id),
  storageInfo: (): Promise<StorageInfo> =>
    isDesktopRuntime ? call<StorageInfo>("storage_info") : demoApi.storageInfo(),
  changeStoragePath: (
    kind: "library" | "backups",
    path: string,
  ): Promise<void> =>
    isDesktopRuntime
      ? call<void>("change_storage_path", { kind, path })
      : demoApi.changeStoragePath(),
};

export { normalizeError };
