use crate::models::{AppRecord, AppState, FolderContent, Item, ItemKind, LaunchKind};
use crate::store::AppData;
use crate::util::{
    extension_of, metadata_ms, path_string, relative_key,
};
use std::fs;
use std::path::{Path, PathBuf};

const IGNORED_NAMES: &[&str] = &["desktop.ini", "thumbs.db", ".ds_store"];

pub fn build_items(data: &AppData) -> Result<Vec<Item>, String> {
    let state = data.snapshot()?;
    Ok(build_items_with_state(data, &state))
}

pub fn build_items_with_state(data: &AppData, state: &AppState) -> Vec<Item> {
    let mut items = Vec::new();
    scan_files(data, state, &mut items);
    for app in &state.apps {
        items.push(app_item(data, state, app));
    }
    items
}

fn scan_files(data: &AppData, state: &AppState, output: &mut Vec<Item>) {
    let entries = match fs::read_dir(&data.library) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().to_string();
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        let Some(key) = relative_key(&path, &data.library) else {
            continue;
        };
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let categories = state
            .assignments
            .get(&key)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|id| state.categories.iter().any(|category| &category.id == id))
            .collect::<Vec<_>>();

        if file_type.is_dir() {
            let prefix = format!("{key}/");
            let encrypted = state.encrypted_files.keys().any(|file| {
                file == &key || file.starts_with(&prefix)
            });
            let mut size = 0u64;
            let mut modified = metadata_ms(&metadata);
            let mut contents = Vec::new();
            for child in walkdir::WalkDir::new(&path)
                .follow_links(false)
                .into_iter()
                .filter_map(Result::ok)
            {
                if !child.file_type().is_file() {
                    continue;
                }
                if let Ok(metadata) = child.metadata() {
                    size += metadata.len();
                    modified = modified.max(metadata_ms(&metadata));
                    let relative = child
                        .path()
                        .strip_prefix(&path)
                        .map(|value| value.to_string_lossy().replace('\\', "/"))
                        .unwrap_or_default();
                    let name = child.file_name().to_string_lossy().to_string();
                    if relative.is_empty()
                        || IGNORED_NAMES.contains(&name.to_lowercase().as_str())
                    {
                        continue;
                    }
                    contents.push(FolderContent {
                        name,
                        relative,
                        extension: extension_of(&child.path().to_string_lossy()),
                        size: metadata.len(),
                        modified: metadata_ms(&metadata),
                    });
                }
            }
            contents.sort_by(|left, right| left.relative.cmp(&right.relative));
            let content_count = contents.len();
            output.push(Item {
                id: format!("folder:{key}"),
                key: key.clone(),
                kind: ItemKind::Folder,
                name,
                path: path_string(&path),
                target: None,
                extension: "folder".to_string(),
                size,
                modified,
                categories,
                favorite: state.favorites.contains(&key),
                last_opened: state.recent.get(&key).copied(),
                missing: false,
                source: None,
                created_at: metadata.created().ok().map(|created| {
                    created
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|duration| duration.as_millis() as i64)
                        .unwrap_or_default()
                }),
                encrypted,
                original_size: None,
                icon: None,
                contents,
                content_count,
            });
            continue;
        }

        if !file_type.is_file()
            || IGNORED_NAMES.contains(&name.to_lowercase().as_str())
        {
            continue;
        }
        let encrypted_meta = state.encrypted_files.get(&key);
        output.push(Item {
            id: format!("file:{key}"),
            key: key.clone(),
            kind: ItemKind::File,
            name,
            path: path_string(&path),
            target: None,
            extension: extension_of(&path.to_string_lossy()),
            size: encrypted_meta
                .map(|meta| meta.original_size)
                .unwrap_or_else(|| metadata.len()),
            modified: metadata_ms(&metadata),
            categories,
            favorite: state.favorites.contains(&key),
            last_opened: state.recent.get(&key).copied(),
            missing: false,
            source: None,
            created_at: metadata.created().ok().map(|created| {
                created
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|duration| duration.as_millis() as i64)
                    .unwrap_or_default()
            }),
            encrypted: encrypted_meta.is_some(),
            original_size: encrypted_meta.map(|meta| meta.original_size),
            icon: None,
            contents: Vec::new(),
            content_count: 0,
        });
    }
}

fn app_item(data: &AppData, state: &AppState, app: &AppRecord) -> Item {
    let managed = app
        .shortcut_file
        .as_ref()
        .and_then(|file| data.shortcuts_path(file).ok());
    let primary_path: PathBuf = match app.launch_kind {
        LaunchKind::Shortcut | LaunchKind::DesktopEntry => managed
            .clone()
            .unwrap_or_else(|| PathBuf::from(&app.target)),
        LaunchKind::Command | LaunchKind::Url => PathBuf::from(&app.target),
    };

    let mut missing = false;
    match app.launch_kind {
        LaunchKind::Url => {}
        LaunchKind::Command => {
            missing = !Path::new(&app.target).exists();
        }
        LaunchKind::Shortcut => {
            missing = managed.as_ref().map(|path| !path.exists()).unwrap_or(true)
                || (Path::new(&app.target).is_absolute() && !Path::new(&app.target).exists());
        }
        LaunchKind::DesktopEntry => {
            missing = managed.as_ref().map(|path| !path.exists()).unwrap_or(true);
        }
    }

    let metadata = fs::metadata(&primary_path).ok();
    let target_metadata = if app.launch_kind == LaunchKind::Command {
        None
    } else {
        fs::metadata(&app.target).ok()
    };
    let size = metadata
        .as_ref()
        .map(|value| value.len())
        .or_else(|| target_metadata.as_ref().map(|value| value.len()))
        .unwrap_or(0);
    let modified = metadata
        .as_ref()
        .map(metadata_ms)
        .or_else(|| target_metadata.as_ref().map(metadata_ms))
        .unwrap_or(0);

    let categories = state
        .assignments
        .get(&app.id)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|id| state.categories.iter().any(|category| &category.id == id))
        .collect();

    Item {
        id: format!("app:{}", app.id),
        key: app.id.clone(),
        kind: ItemKind::App,
        name: app.name.clone(),
        path: path_string(&primary_path),
        target: Some(app.target.clone()),
        extension: extension_of(&primary_path.to_string_lossy()),
        size,
        modified,
        categories,
        favorite: state.favorites.contains(&app.id),
        last_opened: state.recent.get(&app.id).copied(),
        missing,
        source: Some(app.source.clone()),
        created_at: Some(app.created_at),
        encrypted: false,
        original_size: None,
        icon: crate::icons::data_url(data, app, &primary_path),
        contents: Vec::new(),
        content_count: 0,
    }
}

pub fn split_id(id: &str) -> Result<(ItemKind, String), String> {
    if let Some(key) = id.strip_prefix("folderfile:") {
        if key.is_empty() {
            return Err("文件 id 不合法".to_string());
        }
        return Ok((ItemKind::File, key.to_string()));
    }
    if let Some(key) = id.strip_prefix("file:") {
        return Ok((ItemKind::File, key.to_string()));
    }
    if let Some(key) = id.strip_prefix("folder:") {
        if key.is_empty() {
            return Err("文件夹 id 不合法".to_string());
        }
        return Ok((ItemKind::Folder, key.to_string()));
    }
    if let Some(key) = id.strip_prefix("app:") {
        if key.is_empty() {
            return Err("应用 id 不合法".to_string());
        }
        return Ok((ItemKind::App, key.to_string()));
    }
    Err("未知的项目类型".to_string())
}

pub fn find_item(data: &AppData, id: &str) -> Result<Item, String> {
    let items = build_items(data)?;
    if let Some(item) = items.iter().find(|item| item.id == id) {
        return Ok(item.clone());
    }
    let key = id
        .strip_prefix("folderfile:")
        .or_else(|| id.strip_prefix("file:"))
        .ok_or_else(|| "项目不存在，可能已被移动或删除".to_string())?;
    let (folder_key, relative) = key
        .split_once('/')
        .ok_or_else(|| "文件夹内容索引不存在".to_string())?;
    let folder = items
        .iter()
        .find(|item| item.kind == ItemKind::Folder && item.key == folder_key)
        .ok_or_else(|| "文件夹不存在".to_string())?;
    let content = folder
        .contents
        .iter()
        .find(|entry| entry.relative == relative)
        .ok_or_else(|| "文件不存在，可能已被移动或删除".to_string())?;
    Ok(folder_content_item(folder, content))
}

fn folder_content_item(folder: &Item, content: &FolderContent) -> Item {
    let separator = if folder.path.contains('\\') { '\\' } else { '/' };
    Item {
        id: format!("folderfile:{}/{}", folder.key, content.relative),
        key: format!("{}/{}", folder.key, content.relative),
        kind: ItemKind::File,
        name: content.name.clone(),
        path: format!("{}{}{}", folder.path, separator, content.relative),
        target: None,
        extension: content.extension.clone(),
        size: content.size,
        modified: content.modified,
        categories: folder.categories.clone(),
        favorite: folder.favorite,
        last_opened: None,
        missing: false,
        source: Some(format!("位于「{}」", folder.name)),
        created_at: None,
        encrypted: folder.encrypted,
        original_size: Some(content.size),
        icon: None,
        contents: Vec::new(),
        content_count: 0,
    }
}

pub fn forget_key(state: &mut AppState, key: &str) {
    state.favorites.remove(key);
    state.recent.remove(key);
    state.assignments.remove(key);
    state.encrypted_files.remove(key);
}

pub fn move_key(state: &mut AppState, old_key: &str, new_key: &str) {
    if state.favorites.remove(old_key) {
        state.favorites.insert(new_key.to_string());
    }
    if let Some(value) = state.recent.remove(old_key) {
        state.recent.insert(new_key.to_string(), value);
    }
    if let Some(value) = state.assignments.remove(old_key) {
        state.assignments.insert(new_key.to_string(), value);
    }
    if let Some(value) = state.encrypted_files.remove(old_key) {
        state.encrypted_files.insert(new_key.to_string(), value);
    }
}

pub fn assign_category(state: &mut AppState, key: &str, category_id: &str) {
    let entry = state.assignments.entry(key.to_string()).or_default();
    if !entry.iter().any(|id| id == category_id) {
        entry.push(category_id.to_string());
    }
}

pub fn set_categories(
    data: &AppData,
    id: &str,
    category_ids: Vec<String>,
) -> Result<(), String> {
    let (_, key) = split_id(id)?;
    data.mutate(|state| {
        let mut valid: Vec<String> = Vec::new();
        for id in category_ids {
            if state.categories.iter().any(|category| category.id == id)
                && !valid.contains(&id)
            {
                valid.push(id);
            }
        }
        if valid.is_empty() {
            state.assignments.remove(&key);
        } else {
            state.assignments.insert(key.clone(), valid);
        }
        Ok(())
    })
}
