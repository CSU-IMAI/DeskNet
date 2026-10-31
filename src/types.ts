export type ItemKind = "file" | "folder" | "app";

export interface Item {
  id: string;
  key: string;
  kind: ItemKind;
  name: string;
  path: string;
  target: string | null;
  extension: string;
  size: number;
  modified: number;
  categories: string[];
  favorite: boolean;
  lastOpened: number | null;
  missing: boolean;
  source: string | null;
  createdAt: number | null;
  encrypted: boolean;
  originalSize: number | null;
  icon: string | null;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

export interface Settings {
  autoBackup: boolean;
  backupRetention: number;
  backupInterval: BackupInterval;
  backupOnChange: boolean;
}

export type BackupInterval = "manual" | "hourly" | "daily" | "weekly";

export interface BackupManifestEntry {
  key: string;
  name: string;
  size: number;
  modified: number;
  backedUp: boolean;
}

export interface BackupManifest {
  lastBackup: number | null;
  backedUp: BackupManifestEntry[];
  pending: BackupManifestEntry[];
}

export interface BackupPackageInfo {
  path: string;
  name: string;
  size: number;
  createdAt: number;
  includedBackups: number;
}

export type ZoneFilter = "all" | "apps" | "files" | "encrypted";

export interface DesktopZone {
  id: string;
  name: string;
  color: string;
  filter: ZoneFilter;
  categoryId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: number;
}

export interface DesktopSettings {
  zones: DesktopZone[];
  zonesVisible: boolean;
  searchX: number;
  searchY: number;
  searchCustom: boolean;
}

export interface StorageInfo {
  dataRoot: string;
  libraryPath: string;
  backupPath: string;
  shortcutsPath: string;
  fileCount: number;
  appCount: number;
  totalSize: number;
  lastBackup: number | null;
}

export interface Bootstrap {
  items: Item[];
  categories: Category[];
  settings: Settings;
  desktop: DesktopSettings;
  storage: StorageInfo;
  platform: string;
  dataRoot: string;
  version: string;
  vaultConfigured: boolean;
  vaultUnlocked: boolean;
}

export interface VaultStatus {
  configured: boolean;
  unlocked: boolean;
  encryptedCount: number;
}

export interface ImportResult {
  imported: Item[];
  importedKeys: string[];
  skipped: string[];
  errors: string[];
}

export interface BackupInfo {
  path: string;
  name: string;
  size: number;
  createdAt: number;
  kind: "manual" | "auto" | "pre-restore";
}

export type ViewKind =
  | "all"
  | "files"
  | "apps"
  | "favorites"
  | "recent"
  | "category";

export interface ActiveView {
  kind: ViewKind;
  categoryId?: string;
}

export type Layout = "grid" | "list";
export type SortKey = "modified" | "name" | "size" | "opened";
export type Theme = "light" | "dark";

export type ToastTone = "success" | "error" | "info";

export interface ToastMessage {
  id: string;
  tone: ToastTone;
  title: string;
  detail?: string;
}

export interface ImportProgress {
  active: boolean;
  label: string;
}
