use crate::models::{AppState, Item, ItemKind, StorageInfo};
use crate::util::{now_ms, path_string};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

pub struct AppData {
    pub root: PathBuf,
    pub library: PathBuf,
    pub shortcuts: PathBuf,
    pub backups: PathBuf,
    pub decrypted: PathBuf,
    pub state_file: PathBuf,
    pub platform: &'static str,
    pub state: Mutex<AppState>,
    pub vault_key: Mutex<Option<[u8; 32]>>,
    pub items_cache: Mutex<Option<Vec<Item>>>,
    pub backup_dirty: AtomicBool,
    pub backup_changed_at: Mutex<i64>,
}

impl AppData {
    pub fn init(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|error| {
            format!("无法创建数据目录 {}：{error}", root.display())
        })?;
        let state_file = root.join("state.json");
        let state = match fs::read(&state_file) {
            Ok(bytes) => match serde_json::from_slice::<AppState>(&bytes) {
                Ok(state) => state,
                Err(error) => {
                    let corrupt = root.join(format!("state.corrupt-{}.json", now_ms()));
                    let _ = fs::copy(&state_file, &corrupt);
                    eprintln!(
                        "DeskNest: state.json 解析失败（{error}），已备份到 {}",
                        corrupt.display()
                    );
                    AppState::default()
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => AppState::default(),
            Err(error) => return Err(format!("无法读取状态文件：{error}")),
        };

        let library = state
            .library_path
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join("library"));
        let backups = state
            .backup_path
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join("backups"));
        let shortcuts = root.join("shortcuts");
        let decrypted = root.join("decrypted");
        for directory in [&library, &shortcuts, &backups, &decrypted] {
            fs::create_dir_all(directory).map_err(|error| {
                format!("无法创建数据目录 {}：{error}", directory.display())
            })?;
        }

        let data = Self {
            root,
            library,
            shortcuts,
            backups,
            decrypted,
            state_file,
            platform: std::env::consts::OS,
            state: Mutex::new(state),
            vault_key: Mutex::new(None),
            items_cache: Mutex::new(None),
            backup_dirty: AtomicBool::new(false),
            backup_changed_at: Mutex::new(0),
        };
        data.purge_decrypted();
        data.persist()?;
        Ok(data)
    }

    pub fn snapshot(&self) -> Result<AppState, String> {
        self.state
            .lock()
            .map(|state| state.clone())
            .map_err(|_| "状态锁已损坏，请重启应用".to_string())
    }

    pub fn cached_items(&self) -> Result<Vec<Item>, String> {
        if let Ok(guard) = self.items_cache.lock() {
            if let Some(items) = guard.as_ref() {
                return Ok(items.clone());
            }
        }
        let items = crate::library::build_items(self)?;
        if let Ok(mut guard) = self.items_cache.lock() {
            *guard = Some(items.clone());
        }
        Ok(items)
    }

    pub fn rebuild_items(&self) -> Result<Vec<Item>, String> {
        let items = crate::library::build_items(self)?;
        if let Ok(mut guard) = self.items_cache.lock() {
            *guard = Some(items.clone());
        }
        Ok(items)
    }

    pub fn invalidate_items(&self) {
        if let Ok(mut guard) = self.items_cache.lock() {
            *guard = None;
        }
        self.mark_library_changed();
    }

    pub fn mark_library_changed(&self) {
        if let Ok(mut changed) = self.backup_changed_at.lock() {
            *changed = now_ms();
        }
        self.backup_dirty.store(true, Ordering::SeqCst);
    }

    pub fn take_backup_change(&self, debounce_ms: i64) -> bool {
        if !self.backup_dirty.load(Ordering::SeqCst) {
            return false;
        }
        let changed = self
            .backup_changed_at
            .lock()
            .map(|value| *value)
            .unwrap_or(0);
        if now_ms() - changed < debounce_ms {
            return false;
        }
        self.backup_dirty.store(false, Ordering::SeqCst);
        true
    }

    pub fn mark_backup_dirty_again(&self) {
        self.backup_dirty.store(true, Ordering::SeqCst);
    }

    pub fn clear_backup_change(&self) {
        self.backup_dirty.store(false, Ordering::SeqCst);
    }

    pub fn storage_info_for(&self, state: &AppState, items: &[Item]) -> StorageInfo {
        let file_count = items
            .iter()
            .filter(|item| item.kind != ItemKind::App)
            .count();
        let total_size = items
            .iter()
            .filter(|item| item.kind != ItemKind::App)
            .map(|item| item.size)
            .sum();
        StorageInfo {
            data_root: path_string(&self.root),
            library_path: path_string(&self.library),
            backup_path: path_string(&self.backups),
            shortcuts_path: path_string(&self.shortcuts),
            file_count,
            app_count: state.apps.len(),
            total_size,
            last_backup: self.last_backup(),
        }
    }

    pub fn mutate<T>(
        &self,
        operation: impl FnOnce(&mut AppState) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "状态锁已损坏，请重启应用".to_string())?;
        let result = operation(&mut state)?;
        self.save(&state)?;
        Ok(result)
    }

    fn persist(&self) -> Result<(), String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "状态锁已损坏，请重启应用".to_string())?;
        self.save(&state)
    }

    pub fn save(&self, state: &AppState) -> Result<(), String> {
        let json = serde_json::to_vec_pretty(state)
            .map_err(|error| format!("无法序列化状态：{error}"))?;
        let temporary = self.state_file.with_extension("json.tmp");
        fs::write(&temporary, json).map_err(|error| format!("无法写入状态文件：{error}"))?;
        fs::rename(&temporary, &self.state_file)
            .map_err(|error| format!("无法提交状态文件：{error}"))?;
        Ok(())
    }

    pub fn library_size(&self) -> u64 {
        walkdir::WalkDir::new(&self.library)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
            .filter_map(|entry| entry.metadata().ok())
            .map(|metadata| metadata.len())
            .sum()
    }

    pub fn last_backup(&self) -> Option<i64> {
        fs::read_dir(&self.backups)
            .ok()?
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .map(|extension| extension.eq_ignore_ascii_case("zip"))
                    .unwrap_or(false)
            })
            .filter_map(|entry| entry.metadata().ok())
            .filter_map(|metadata| metadata.modified().ok())
            .filter_map(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64)
            .max()
    }

    pub fn storage_info(&self) -> Result<StorageInfo, String> {
        let state = self.snapshot()?;
        let items = self.cached_items()?;
        Ok(self.storage_info_for(&state, &items))
    }

    pub fn category_exists(&self, state: &AppState, id: &str) -> bool {
        state.categories.iter().any(|category| category.id == id)
    }

    pub fn library_path(&self, key: &str) -> Result<PathBuf, String> {
        let relative = crate::util::safe_relative(key)?;
        let path = self.library.join(relative);
        if !path.starts_with(&self.library) {
            return Err("项目路径不合法".to_string());
        }
        Ok(path)
    }

    pub fn shortcuts_path(&self, file: &str) -> Result<PathBuf, String> {
        let relative = crate::util::safe_relative(file)?;
        let path = self.shortcuts.join(relative);
        if !path.starts_with(&self.shortcuts) {
            return Err("快捷方式路径不合法".to_string());
        }
        Ok(path)
    }

    pub fn set_vault_key(&self, key: [u8; 32]) -> Result<(), String> {
        let mut guard = self
            .vault_key
            .lock()
            .map_err(|_| "保险箱状态已损坏".to_string())?;
        *guard = Some(key);
        Ok(())
    }

    pub fn cached_vault_key(&self) -> Option<[u8; 32]> {
        self.vault_key.lock().ok().and_then(|guard| *guard)
    }

    pub fn vault_unlocked(&self) -> bool {
        self.vault_key
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    pub fn clear_vault(&self) {
        if let Ok(mut guard) = self.vault_key.lock() {
            if let Some(key) = guard.as_mut() {
                key.fill(0);
            }
            *guard = None;
        }
        self.purge_decrypted();
    }

    pub fn purge_decrypted(&self) {
        if let Ok(entries) = fs::read_dir(&self.decrypted) {
            for entry in entries.filter_map(Result::ok) {
                let path = entry.path();
                if path.is_dir() {
                    let _ = fs::remove_dir_all(path);
                } else {
                    let _ = fs::remove_file(path);
                }
            }
        }
    }
}

fn copy_directory_contents(source: &Path, target: &Path) -> Result<(), String> {
    let entries = fs::read_dir(source)
        .map_err(|error| format!("无法读取 {}：{error}", source.display()))?;
    for entry in entries.filter_map(Result::ok) {
        let from = entry.path();
        let to = target.join(entry.file_name());
        if from.is_dir() {
            fs::create_dir_all(&to)
                .map_err(|error| format!("无法创建 {}：{error}", to.display()))?;
            copy_directory_contents(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|error| {
                format!(
                    "无法复制 {} 到 {}：{error}",
                    from.display(),
                    to.display()
                )
            })?;
        }
    }
    Ok(())
}

/// Move a data directory to a new empty location. Copy first, then remove
/// the old directory only after every entry has been written successfully.
pub fn migrate_directory(source: &Path, target: &Path) -> Result<(), String> {
    if source == target {
        return Ok(());
    }
    if target.starts_with(source) || source.starts_with(target) {
        return Err("新目录不能位于旧目录内部，旧目录也不能位于新目录内部".to_string());
    }
    if target.exists() {
        let empty = fs::read_dir(target)
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false);
        if !empty {
            return Err("请选择一个空目录，或一个尚不存在的目录".to_string());
        }
    }
    fs::create_dir_all(target)
        .map_err(|error| format!("无法创建新目录 {}：{error}", target.display()))?;
    if source.exists() {
        copy_directory_contents(source, target)?;
        let _ = fs::remove_dir_all(source);
    }
    Ok(())
}
