use crate::backup;
use crate::importer;
use crate::launcher;
use crate::library;
use crate::models::{
    AppState, BackupInfo, BackupManifest, BackupPackageInfo, Bootstrap, Category, DesktopSettings, DesktopZone,
    DragPathInfo, ImportResult, Item, ItemKind, Settings, StorageInfo, VaultStatus,
};
use crate::store::AppData;
use crate::util::{
    now_ms, path_string, relative_key, validate_file_name,
};
use crate::vault;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

fn build_bootstrap(data: &AppData) -> Result<Bootstrap, String> {
    let state = data.snapshot()?;
    let items = data.cached_items()?;
    let storage = data.storage_info_for(&state, &items);
    Ok(Bootstrap {
        items,
        categories: state.categories.clone(),
        settings: state.settings.clone(),
        desktop: state.desktop.clone(),
        storage,
        platform: data.platform.to_string(),
        data_root: path_string(&data.root),
        version: env!("CARGO_PKG_VERSION").to_string(),
        vault_configured: state.vault.enabled,
        vault_unlocked: data.vault_unlocked(),
    })
}

fn vault_status(data: &AppData) -> Result<VaultStatus, String> {
    let state = data.snapshot()?;
    Ok(VaultStatus {
        configured: state.vault.enabled,
        unlocked: data.vault_unlocked(),
        encrypted_count: state.encrypted_files.len(),
    })
}

fn broadcast_vault_status(app: &AppHandle) {
    let data = app.state::<AppData>();
    if let Ok(status) = vault_status(&data) {
        let _ = app.emit("vault-status-changed", &status);
    }
}

#[tauri::command]
pub fn bootstrap(app: AppHandle) -> Result<Bootstrap, String> {
    let data = app.state::<AppData>();
    build_bootstrap(&data)
}

#[tauri::command]
pub fn refresh_items(app: AppHandle) -> Result<Vec<Item>, String> {
    let data = app.state::<AppData>();
    let items = data.rebuild_items()?;
    let _ = app.emit("items-changed", ());
    Ok(items)
}

#[tauri::command]
pub fn classify_paths(paths: Vec<String>) -> Vec<DragPathInfo> {
    paths
        .into_iter()
        .map(|path| DragPathInfo {
            kind: importer::classify_path(std::path::Path::new(&path)).to_string(),
            path,
        })
        .collect()
}

#[tauri::command]
pub async fn import_paths(
    app: AppHandle,
    paths: Vec<String>,
    category_id: Option<String>,
) -> Result<ImportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.state::<AppData>();
        let result = importer::import_paths(&data, paths, category_id)?;
        data.invalidate_items();
        let _ = app.emit("items-changed", ());
        Ok(result)
    })
    .await
    .map_err(|error| format!("导入任务失败：{error}"))?
}

#[tauri::command]
pub async fn import_desktop_shortcuts(app: AppHandle) -> Result<ImportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.state::<AppData>();
        let result = importer::import_desktop_shortcuts(&data)?;
        data.invalidate_items();
        let _ = app.emit("items-changed", ());
        Ok(result)
    })
    .await
    .map_err(|error| format!("扫描桌面任务失败：{error}"))?
}

#[tauri::command]
pub async fn open_item(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.state::<AppData>();
        launcher::open_item(&data, &id)
    })
    .await
    .map_err(|error| format!("打开任务失败：{error}"))?
}

#[tauri::command]
pub fn reveal_item(app: AppHandle, id: String) -> Result<(), String> {
    let data = app.state::<AppData>();
    launcher::reveal_item(&data, &id)
}

#[tauri::command]
pub fn open_folder(app: AppHandle, kind: String) -> Result<(), String> {
    let data = app.state::<AppData>();
    launcher::open_folder(&data, &kind)
}

#[tauri::command]
pub async fn delete_item(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.state::<AppData>();
        let (kind, key) = library::split_id(&id)?;
        match kind {
            ItemKind::File => {
                let path = data.library_path(&key)?;
                if !path.exists() {
                    return Err("文件不存在".to_string());
                }
                trash::delete(&path).map_err(|error| {
                    format!("移入回收站失败：{error}（文件仍保留在资料库中）")
                })?;
                data.mutate(|state| {
                    library::forget_key(state, &key);
                    Ok(())
                })?;
            }
            ItemKind::Folder => {
                let path = data.library_path(&key)?;
                if !path.exists() {
                    return Err("文件夹不存在".to_string());
                }
                trash::delete(&path).map_err(|error| {
                    format!("移入回收站失败：{error}（文件夹仍保留在资料库中）")
                })?;
                data.mutate(|state| {
                    library::forget_key(state, &key);
                    let prefix = format!("{key}/");
                    state.encrypted_files.retain(|file, _| {
                        file != &key && !file.starts_with(&prefix)
                    });
                    Ok(())
                })?;
            }
            ItemKind::App => {
                let record = data.mutate(|state| {
                    let position = state
                        .apps
                        .iter()
                        .position(|app| app.id == key)
                        .ok_or_else(|| "软件映射不存在".to_string())?;
                    let record = state.apps.remove(position);
                    library::forget_key(state, &key);
                    Ok(record)
                })?;
                if let Some(file) = record.shortcut_file {
                    if let Ok(path) = data.shortcuts_path(&file) {
                        let _ = fs::remove_file(path);
                    }
                }
            }
        }
        data.invalidate_items();
        let _ = app.emit("items-changed", ());
        Ok(())
    })
    .await
    .map_err(|error| format!("删除任务失败：{error}"))?
}

#[tauri::command]
pub fn rename_item(app: AppHandle, id: String, name: String) -> Result<Item, String> {
    let data = app.state::<AppData>();
    let (kind, key) = library::split_id(&id)?;
    match kind {
        ItemKind::File => {
            let old_path = data.library_path(&key)?;
            if !old_path.exists() {
                return Err("文件不存在".to_string());
            }
            let new_name = validate_file_name(&name)?;
            let parent = old_path
                .parent()
                .ok_or_else(|| "无法定位文件目录".to_string())?;
            let new_path = parent.join(&new_name);
            if new_path == old_path {
                return library::find_item(&data, &id);
            }
            if new_path.exists() {
                return Err("同一目录下已存在同名文件".to_string());
            }
            fs::rename(&old_path, &new_path)
                .map_err(|error| format!("重命名失败：{error}"))?;
            let new_key = relative_key(&new_path, &data.library)
                .ok_or_else(|| "无法生成新索引".to_string())?;
            data.mutate(|state| {
                library::move_key(state, &key, &new_key);
                Ok(())
            })?;
            data.invalidate_items();
        let _ = app.emit("items-changed", ());
            library::find_item(&data, &format!("file:{new_key}"))
        }
        ItemKind::Folder => {
            let old_path = data.library_path(&key)?;
            if !old_path.exists() {
                return Err("文件夹不存在".to_string());
            }
            let new_name = validate_file_name(&name)?;
            let parent = old_path
                .parent()
                .ok_or_else(|| "无法定位文件夹目录".to_string())?;
            let new_path = parent.join(&new_name);
            if new_path == old_path {
                return library::find_item(&data, &id);
            }
            if new_path.exists() {
                return Err("同一目录下已存在同名文件夹".to_string());
            }
            fs::rename(&old_path, &new_path)
                .map_err(|error| format!("重命名失败：{error}"))?;
            let new_key = relative_key(&new_path, &data.library)
                .ok_or_else(|| "无法生成新索引".to_string())?;
            data.mutate(|state| {
                library::move_key(state, &key, &new_key);
                let old_prefix = format!("{key}/");
                let new_prefix = format!("{new_key}/");
                let moved: Vec<(String, crate::models::EncryptedFileMeta)> = state
                    .encrypted_files
                    .iter()
                    .filter(|(file, _)| file.starts_with(&old_prefix))
                    .map(|(file, meta)| (file.clone(), meta.clone()))
                    .collect();
                for (old, meta) in moved {
                    state.encrypted_files.remove(&old);
                    let suffix = old.trim_start_matches(&old_prefix);
                    state
                        .encrypted_files
                        .insert(format!("{new_prefix}{suffix}"), meta);
                }
                Ok(())
            })?;
            data.invalidate_items();
            let _ = app.emit("items-changed", ());
            library::find_item(&data, &format!("folder:{new_key}"))
        }
        ItemKind::App => {
            let label = validate_label(&name)?;
            data.mutate(|state| {
                let app = state
                    .apps
                    .iter_mut()
                    .find(|app| app.id == key)
                    .ok_or_else(|| "软件映射不存在".to_string())?;
                app.name = label;
                Ok(())
            })?;
            data.invalidate_items();
        let _ = app.emit("items-changed", ());
            library::find_item(&data, &id)
        }
    }
}

fn validate_label(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("名称不能为空".to_string());
    }
    if trimmed.chars().count() > 80 {
        return Err("名称最多 80 个字符".to_string());
    }
    if trimmed.chars().any(char::is_control) {
        return Err("名称中包含不可见字符".to_string());
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
pub fn toggle_favorite(app: AppHandle, id: String) -> Result<bool, String> {
    let data = app.state::<AppData>();
    let item = library::find_item(&data, &id)?;
    data.mutate(|state| {
        if state.favorites.contains(&item.key) {
            state.favorites.remove(&item.key);
            Ok(false)
        } else {
            state.favorites.insert(item.key.clone());
            Ok(true)
        }
    })
}

#[tauri::command]
pub fn set_item_categories(
    app: AppHandle,
    id: String,
    category_ids: Vec<String>,
) -> Result<(), String> {
    let data = app.state::<AppData>();
    library::set_categories(&data, &id, category_ids)?;
    data.invalidate_items();
    let _ = app.emit("items-changed", ());
    Ok(())
}

#[tauri::command]
pub fn create_category(
    app: AppHandle,
    name: String,
    color: String,
) -> Result<Category, String> {
    let data = app.state::<AppData>();
    let name = validate_category_name(&name)?;
    let color = validate_color(&color);
    let category = data.mutate(|state| {
        ensure_unique_category_name(state, &name, None)?;
        let category = Category {
            id: Uuid::new_v4().to_string(),
            name,
            color,
            created_at: now_ms(),
        };
        state.categories.push(category.clone());
        Ok(category)
    })?;
    data.invalidate_items();
    let _ = app.emit("items-changed", ());
    Ok(category)
}

#[tauri::command]
pub fn update_category(
    app: AppHandle,
    id: String,
    name: String,
    color: String,
) -> Result<Category, String> {
    let data = app.state::<AppData>();
    let name = validate_category_name(&name)?;
    let color = validate_color(&color);
    let category = data.mutate(|state| {
        ensure_unique_category_name(state, &name, Some(&id))?;
        let category = state
            .categories
            .iter_mut()
            .find(|category| category.id == id)
            .ok_or_else(|| "分类不存在".to_string())?;
        category.name = name;
        category.color = color;
        Ok(category.clone())
    })?;
    data.invalidate_items();
    let _ = app.emit("items-changed", ());
    Ok(category)
}

#[tauri::command]
pub fn delete_category(app: AppHandle, id: String) -> Result<(), String> {
    let data = app.state::<AppData>();
    data.mutate(|state| {
        let before = state.categories.len();
        state.categories.retain(|category| category.id != id);
        if before == state.categories.len() {
            return Err("分类不存在".to_string());
        }
        for values in state.assignments.values_mut() {
            values.retain(|category_id| category_id != &id);
        }
        state
            .assignments
            .retain(|_, categories| !categories.is_empty());
        for zone in &mut state.desktop.zones {
            if zone.category_id.as_deref() == Some(id.as_str()) {
                zone.category_id = None;
            }
        }
        Ok(())
    })?;
    data.invalidate_items();
    let _ = app.emit("items-changed", ());
    Ok(())
}

fn validate_category_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("分类名称不能为空".to_string());
    }
    if trimmed.chars().count() > 24 {
        return Err("分类名称最多 24 个字符".to_string());
    }
    if trimmed.chars().any(char::is_control) {
        return Err("分类名称包含不可见字符".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_color(color: &str) -> String {
    let trimmed = color.trim();
    let valid = trimmed.len() == 7
        && trimmed.starts_with('#')
        && trimmed[1..].chars().all(|character| character.is_ascii_hexdigit());
    if valid {
        trimmed.to_lowercase()
    } else {
        "#5f7f6b".to_string()
    }
}

fn ensure_unique_category_name(
    state: &AppState,
    name: &str,
    except_id: Option<&str>,
) -> Result<(), String> {
    let duplicate = state.categories.iter().any(|category| {
        Some(category.id.as_str()) != except_id
            && category.name.eq_ignore_ascii_case(name)
    });
    if duplicate {
        Err("已存在同名分类".to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    auto_backup: bool,
    backup_retention: usize,
    backup_interval: String,
    backup_on_change: bool,
) -> Result<Settings, String> {
    let data = app.state::<AppData>();
    data.mutate(|state| {
        let interval = match backup_interval.as_str() {
            "hourly" | "daily" | "weekly" => backup_interval.clone(),
            _ => "manual".to_string(),
        };
        state.settings = Settings {
            auto_backup,
            backup_retention: backup_retention.clamp(1, 100),
            backup_interval: interval,
            backup_on_change,
        };
        Ok(state.settings.clone())
    })
}

#[tauri::command]
pub fn list_backups(app: AppHandle) -> Result<Vec<BackupInfo>, String> {
    let data = app.state::<AppData>();
    backup::list_backups(&data)
}

#[tauri::command]
pub fn backup_manifest(app: AppHandle) -> Result<BackupManifest, String> {
    let data = app.state::<AppData>();
    backup::manifest(&data)
}

#[tauri::command]
pub async fn export_backup_package(
    app: AppHandle,
    path: String,
    password: String,
) -> Result<BackupPackageInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.state::<AppData>();
        backup::export_package(&data, std::path::Path::new(&path), &password)
    })
    .await
    .map_err(|error| format!("导出任务失败：{error}"))?
}

#[tauri::command]
pub async fn restore_backup_package(
    app: AppHandle,
    path: String,
    password: String,
) -> Result<Bootstrap, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.state::<AppData>();
        backup::restore_package(&data, std::path::Path::new(&path), &password)?;
        data.clear_vault();
        data.invalidate_items();
        let _ = app.emit("items-changed", ());
        build_bootstrap(&data)
    })
    .await
    .map_err(|error| format!("恢复任务失败：{error}"))?
}

#[tauri::command]
pub async fn create_backup(app: AppHandle) -> Result<BackupInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.state::<AppData>();
        let info = backup::create_backup(&data, "manual")?;
        data.clear_backup_change();
        Ok(info)
    })
    .await
    .map_err(|error| format!("备份任务失败：{error}"))?
}

#[tauri::command]
pub async fn restore_backup(app: AppHandle, path: String) -> Result<Bootstrap, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.state::<AppData>();
        backup::restore_backup(&data, &path)?;
        data.clear_vault();
        data.invalidate_items();
        let _ = app.emit("items-changed", ());
        build_bootstrap(&data)
    })
    .await
    .map_err(|error| format!("恢复任务失败：{error}"))?
}

#[tauri::command]
pub async fn delete_backup(app: AppHandle, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.state::<AppData>();
        backup::delete_backup(&data, &path)
    })
    .await
    .map_err(|error| format!("删除备份任务失败：{error}"))?
}

#[tauri::command]
pub async fn run_auto_backup(app: AppHandle) -> Result<Option<BackupInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.state::<AppData>();
        backup::auto_backup(&data)
    })
    .await
    .map_err(|error| format!("自动备份任务失败：{error}"))?
}

#[tauri::command]
pub fn clear_recent(app: AppHandle) -> Result<(), String> {
    let data = app.state::<AppData>();
    data.mutate(|state| {
        state.recent.clear();
        Ok(())
    })
}

#[tauri::command]
pub fn storage_info(app: AppHandle) -> Result<StorageInfo, String> {
    let data = app.state::<AppData>();
    data.storage_info()
}

#[tauri::command]
pub fn change_storage_path(
    app: AppHandle,
    kind: String,
    path: String,
) -> Result<(), String> {
    let target = PathBuf::from(path.trim());
    if !target.is_absolute() {
        return Err("请选择绝对路径".to_string());
    }
    let target = fs::canonicalize(&target).unwrap_or(target);
    let data = app.state::<AppData>();
    let (current, other) = match kind.as_str() {
        "library" => (&data.library, &data.backups),
        "backups" => (&data.backups, &data.library),
        _ => return Err("未知的目录类型".to_string()),
    };
    if current == &target {
        return Ok(());
    }
    if target.starts_with(other) || other.starts_with(&target) {
        return Err("资料库和备份目录不能互相包含".to_string());
    }
    crate::store::migrate_directory(current, &target)?;
    data.mutate(|state| {
        match kind.as_str() {
            "library" => state.library_path = Some(path_string(&target)),
            "backups" => state.backup_path = Some(path_string(&target)),
            _ => {}
        }
        Ok(())
    })?;
    app.restart();
}

#[tauri::command]
pub fn show_quick_search(app: AppHandle) -> Result<(), String> {
    crate::desktop::show_quick_search(&app)
}

#[tauri::command]
pub fn hide_quick_search(app: AppHandle) -> Result<(), String> {
    crate::desktop::hide_quick_search(&app)
}

#[tauri::command]
pub fn toggle_quick_search(app: AppHandle) -> Result<(), String> {
    crate::desktop::toggle_quick_search(&app)
}

#[tauri::command]
pub fn set_zones_visible(
    app: AppHandle,
    visible: bool,
) -> Result<DesktopSettings, String> {
    let data = app.state::<AppData>();
    let settings = data.mutate(|state| {
        state.desktop.zones_visible = visible;
        Ok(state.desktop.clone())
    })?;
    crate::desktop::apply_zones_visibility(&app, visible);
    let _ = app.emit("desktop-settings-changed", &settings);
    Ok(settings)
}

#[tauri::command]
pub fn toggle_zones_visibility(app: AppHandle) -> Result<DesktopSettings, String> {
    let data = app.state::<AppData>();
    crate::desktop::toggle_zones_visibility(&app)?;
    Ok(data.snapshot()?.desktop)
}

#[tauri::command]
pub fn save_desktop_settings(
    app: AppHandle,
    zones: Vec<DesktopZone>,
    zones_visible: bool,
) -> Result<DesktopSettings, String> {
    crate::desktop::save_desktop_settings(&app, zones, zones_visible)
}

#[tauri::command]
pub fn update_zone_bounds(
    app: AppHandle,
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    crate::desktop::update_zone_bounds(&app, &id, x, y, width, height)
}

#[tauri::command]
pub fn update_search_position(
    app: AppHandle,
    x: f64,
    y: f64,
) -> Result<(), String> {
    crate::desktop::update_search_position(&app, x, y)
}

#[tauri::command]
pub fn set_zone_opacity(
    app: AppHandle,
    opacity: f64,
) -> Result<DesktopSettings, String> {
    crate::desktop::set_zone_opacity(&app, opacity)
}

#[tauri::command]
pub fn open_zones_manager(app: AppHandle) -> Result<(), String> {
    crate::desktop::focus_zones_manager(&app);
    Ok(())
}

#[tauri::command]
pub fn get_vault_status(app: AppHandle) -> Result<VaultStatus, String> {
    let data = app.state::<AppData>();
    vault_status(&data)
}

#[tauri::command]
pub fn configure_vault(app: AppHandle, password: String) -> Result<VaultStatus, String> {
    let data = app.state::<AppData>();
    let (settings, key) = vault::create_vault(&password)?;
    let status = data.mutate(|state| {
        if state.vault.enabled {
            return Err("保险箱密码已经设置".to_string());
        }
        state.vault = settings;
        Ok(VaultStatus {
            configured: true,
            unlocked: true,
            encrypted_count: state.encrypted_files.len(),
        })
    })?;
    data.set_vault_key(key)?;
    broadcast_vault_status(&app);
    Ok(status)
}

#[tauri::command]
pub fn unlock_vault(app: AppHandle, password: String) -> Result<VaultStatus, String> {
    let data = app.state::<AppData>();
    let state = data.snapshot()?;
    let key = vault::unlock_vault(&state.vault, &password)?;
    data.set_vault_key(key)?;
    let status = vault_status(&data)?;
    broadcast_vault_status(&app);
    Ok(status)
}

#[tauri::command]
pub fn lock_vault(app: AppHandle) -> Result<VaultStatus, String> {
    let data = app.state::<AppData>();
    data.clear_vault();
    let status = vault_status(&data)?;
    broadcast_vault_status(&app);
    Ok(status)
}

#[tauri::command]
pub async fn encrypt_item(app: AppHandle, id: String) -> Result<Item, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.state::<AppData>();
        let (kind, key) = library::split_id(&id)?;
        if kind == ItemKind::App {
            return Err("软件卡片不能加密".to_string());
        }
        let state = data.snapshot()?;
        if !state.vault.enabled {
            return Err("请先设置保险箱密码".to_string());
        }
        let cached = data
            .cached_vault_key()
            .ok_or_else(|| "保险箱已锁定，请先输入密码".to_string())?;

        if kind == ItemKind::File {
            if state.encrypted_files.contains_key(&key) {
                return library::find_item(&data, &id);
            }
            let path = data.library_path(&key)?;
            if !path.exists() {
                return Err("文件不存在".to_string());
            }
            let meta = vault::encrypt_file(&path, &cached)?;
            data.mutate(|state| {
                state.encrypted_files.insert(key.clone(), meta);
                Ok(())
            })?;
        } else {
            let folder = data.library_path(&key)?;
            if !folder.is_dir() {
                return Err("文件夹不存在".to_string());
            }
            for entry in walkdir::WalkDir::new(&folder)
                .follow_links(false)
                .into_iter()
                .filter_map(Result::ok)
            {
                if !entry.file_type().is_file() {
                    continue;
                }
                let relative = relative_key(entry.path(), &data.library)
                    .ok_or_else(|| "无法生成文件索引".to_string())?;
                if state.encrypted_files.contains_key(&relative) {
                    continue;
                }
                let meta = vault::encrypt_file(entry.path(), &cached)?;
                data.mutate(|state| {
                    state.encrypted_files.insert(relative.clone(), meta);
                    Ok(())
                })?;
            }
        }

        data.invalidate_items();
        let _ = app.emit("items-changed", ());
        library::find_item(&data, &id)
    })
    .await
    .map_err(|error| format!("加密任务失败：{error}"))?
}

#[tauri::command]
pub async fn decrypt_item(app: AppHandle, id: String) -> Result<Item, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.state::<AppData>();
        let (kind, key) = library::split_id(&id)?;
        if kind == ItemKind::App {
            return Err("软件卡片没有可解密的文件".to_string());
        }
        let state = data.snapshot()?;
        let cached = data
            .cached_vault_key()
            .ok_or_else(|| "保险箱已锁定，请先输入密码".to_string())?;

        if kind == ItemKind::File {
            if !state.encrypted_files.contains_key(&key) {
                return library::find_item(&data, &id);
            }
            let path = data.library_path(&key)?;
            vault::decrypt_file_in_place(&path, &cached)?;
            data.mutate(|state| {
                state.encrypted_files.remove(&key);
                Ok(())
            })?;
        } else {
            let prefix = format!("{key}/");
            let keys: Vec<String> = state
                .encrypted_files
                .keys()
                .filter(|file| file.starts_with(&prefix))
                .cloned()
                .collect();
            for relative in keys {
                let path = data.library_path(&relative)?;
                if path.exists() {
                    vault::decrypt_file_in_place(&path, &cached)?;
                }
                data.mutate(|state| {
                    state.encrypted_files.remove(&relative);
                    Ok(())
                })?;
            }
        }

        data.invalidate_items();
        let _ = app.emit("items-changed", ());
        library::find_item(&data, &id)
    })
    .await
    .map_err(|error| format!("解密任务失败：{error}"))?
}
