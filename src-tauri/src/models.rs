use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const APP_NAME: &str = "DeskNest";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum LaunchKind {
    Shortcut,
    DesktopEntry,
    Url,
    #[default]
    Command,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppRecord {
    pub id: String,
    pub name: String,
    pub target: String,
    pub args: Vec<String>,
    pub working_dir: Option<String>,
    pub launch_kind: LaunchKind,
    pub shortcut_file: Option<String>,
    pub original_path: Option<String>,
    pub source: String,
    pub created_at: i64,
}

impl Default for AppRecord {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            target: String::new(),
            args: Vec::new(),
            working_dir: None,
            launch_kind: LaunchKind::Command,
            shortcut_file: None,
            original_path: None,
            source: "应用".to_string(),
            created_at: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub auto_backup: bool,
    pub backup_retention: usize,
    pub backup_interval: String,
    pub backup_on_change: bool,
    pub auto_start: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_backup: true,
            backup_retention: 10,
            backup_interval: "daily".to_string(),
            backup_on_change: true,
            auto_start: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AppState {
    pub categories: Vec<Category>,
    pub apps: Vec<AppRecord>,
    pub favorites: BTreeSet<String>,
    pub recent: BTreeMap<String, i64>,
    pub assignments: BTreeMap<String, Vec<String>>,
    pub settings: Settings,
    pub desktop: DesktopSettings,
    pub vault: VaultSettings,
    pub encrypted_files: BTreeMap<String, EncryptedFileMeta>,
    pub library_path: Option<String>,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct VaultSettings {
    pub enabled: bool,
    pub salt: String,
    pub verifier: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EncryptedFileMeta {
    pub original_size: u64,
    pub encrypted_size: u64,
    pub created_at: i64,
}

impl Default for EncryptedFileMeta {
    fn default() -> Self {
        Self {
            original_size: 0,
            encrypted_size: 0,
            created_at: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopZone {
    pub id: String,
    pub name: String,
    pub color: String,
    pub filter: String,
    pub category_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub created_at: i64,
}

impl Default for DesktopZone {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: "新分区".to_string(),
            color: "#5f7f6b".to_string(),
            filter: "all".to_string(),
            category_id: None,
            x: 0.56,
            y: 0.54,
            width: 0.28,
            height: 0.3,
            created_at: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopSettings {
    pub zones: Vec<DesktopZone>,
    pub zones_visible: bool,
    pub search_x: f64,
    pub search_y: f64,
    pub search_custom: bool,
    #[serde(default = "default_zone_opacity")]
    pub zone_opacity: f64,
    #[serde(default)]
    pub zone_layout_version: u32,
}

fn default_zone_opacity() -> f64 {
    0.78
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            zones: vec![
                DesktopZone {
                    id: "zone-programs".to_string(),
                    name: "程序区".to_string(),
                    color: "#5f7f6b".to_string(),
                    filter: "apps".to_string(),
                    category_id: None,
                    x: 0.055,
                    y: 0.16,
                    width: 0.30,
                    height: 0.38,
                    created_at: 0,
                },
                DesktopZone {
                    id: "zone-files".to_string(),
                    name: "文件区".to_string(),
                    color: "#d96343".to_string(),
                    filter: "files".to_string(),
                    category_id: None,
                    x: 0.365,
                    y: 0.16,
                    width: 0.30,
                    height: 0.38,
                    created_at: 0,
                },
                DesktopZone {
                    id: "zone-encrypted".to_string(),
                    name: "加密区".to_string(),
                    color: "#7b6b9c".to_string(),
                    filter: "encrypted".to_string(),
                    category_id: None,
                    x: 0.675,
                    y: 0.16,
                    width: 0.30,
                    height: 0.38,
                    created_at: 0,
                },
            ],
            zones_visible: false,
            search_x: -1.0,
            search_y: -1.0,
            search_custom: false,
            zone_opacity: default_zone_opacity(),
            zone_layout_version: 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    File,
    Folder,
    App,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderContent {
    pub name: String,
    pub relative: String,
    pub extension: String,
    pub size: u64,
    pub modified: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub key: String,
    pub kind: ItemKind,
    pub name: String,
    pub path: String,
    pub target: Option<String>,
    pub extension: String,
    pub size: u64,
    pub modified: u64,
    pub categories: Vec<String>,
    pub favorite: bool,
    pub last_opened: Option<i64>,
    pub missing: bool,
    pub source: Option<String>,
    pub created_at: Option<i64>,
    pub encrypted: bool,
    pub original_size: Option<u64>,
    pub icon: Option<String>,
    pub contents: Vec<FolderContent>,
    pub content_count: usize,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: Vec<Item>,
    pub imported_keys: Vec<String>,
    pub skipped: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub data_root: String,
    pub library_path: String,
    pub backup_path: String,
    pub shortcuts_path: String,
    pub file_count: usize,
    pub app_count: usize,
    pub total_size: u64,
    pub last_backup: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub items: Vec<Item>,
    pub categories: Vec<Category>,
    pub settings: Settings,
    pub desktop: DesktopSettings,
    pub storage: StorageInfo,
    pub platform: String,
    pub data_root: String,
    pub version: String,
    pub vault_configured: bool,
    pub vault_unlocked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub created_at: u64,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPackageInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub created_at: u64,
    pub included_backups: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DragPathInfo {
    pub path: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub configured: bool,
    pub unlocked: bool,
    pub encrypted_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifestEntry {
    pub key: String,
    pub name: String,
    pub size: u64,
    pub modified: u64,
    pub backed_up: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub last_backup: Option<i64>,
    pub backed_up: Vec<BackupManifestEntry>,
    pub pending: Vec<BackupManifestEntry>,
}
