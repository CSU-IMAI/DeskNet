use crate::models::{
    AppState, BackupInfo, BackupManifest, BackupManifestEntry, BackupPackageInfo,
    ItemKind, VaultSettings, APP_NAME,
};
use crate::store::AppData;
use crate::util::{metadata_ms, now_ms, path_string, relative_key};
use crate::vault;
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};
use uuid::Uuid;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const AUTO_PREFIX: &str = "DeskNest-Auto-";
const MANUAL_PREFIX: &str = "DeskNest-Backup-";
const PRE_RESTORE_PREFIX: &str = "DeskNest-PreRestore-";

pub fn create_backup(data: &AppData, kind: &str) -> Result<BackupInfo, String> {
    let prefix = match kind {
        "auto" => AUTO_PREFIX,
        "pre-restore" => PRE_RESTORE_PREFIX,
        _ => MANUAL_PREFIX,
    };
    let stamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let path = unique_backup_path(&data.backups, prefix, &stamp);
    let state = data.snapshot()?;

    if let Err(error) = write_archive(data, &state, &path) {
        let _ = fs::remove_file(&path);
        return Err(error);
    }
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("无法读取备份文件信息：{error}"))?;
    Ok(BackupInfo {
        path: path_string(&path),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "DeskNest 备份".to_string()),
        size: metadata.len(),
        created_at: metadata_ms(&metadata),
        kind: kind.to_string(),
    })
}

fn unique_backup_path(directory: &Path, prefix: &str, stamp: &str) -> PathBuf {
    for index in 1..1000 {
        let suffix = if index == 1 {
            String::new()
        } else {
            format!("-{index}")
        };
        let path = directory.join(format!("{prefix}{stamp}{suffix}.zip"));
        if !path.exists() {
            return path;
        }
    }
    directory.join(format!("{prefix}{stamp}-{}.zip", now_ms()))
}

fn write_archive(data: &AppData, state: &AppState, path: &Path) -> Result<(), String> {
    let file = File::create(path).map_err(|error| format!("无法创建备份文件：{error}"))?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let manifest = serde_json::to_vec_pretty(&serde_json::json!({
        "app": APP_NAME,
        "version": env!("CARGO_PKG_VERSION"),
        "createdAt": now_ms(),
        "format": 1
    }))
    .map_err(|error| format!("无法生成备份清单：{error}"))?;
    writer
        .start_file("manifest.json", options)
        .map_err(|error| format!("无法写入备份清单：{error}"))?;
    writer
        .write_all(&manifest)
        .map_err(|error| format!("无法写入备份清单：{error}"))?;

    let state_json = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("无法序列化状态：{error}"))?;
    writer
        .start_file("state.json", options)
        .map_err(|error| format!("无法写入状态备份：{error}"))?;
    writer
        .write_all(&state_json)
        .map_err(|error| format!("无法写入状态备份：{error}"))?;

    for (root, folder) in [
        (&data.library, "library"),
        (&data.shortcuts, "shortcuts"),
    ] {
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let Some(relative) = relative_key(entry.path(), root) else {
                continue;
            };
            let archive_name = format!("{folder}/{relative}");
            writer
                .start_file(archive_name, options)
                .map_err(|error| format!("无法写入备份条目：{error}"))?;
            let mut input = File::open(entry.path())
                .map_err(|error| format!("无法读取 {}：{error}", entry.path().display()))?;
            std::io::copy(&mut input, &mut writer)
                .map_err(|error| format!("写入备份内容失败：{error}"))?;
        }
    }

    writer
        .finish()
        .map_err(|error| format!("完成备份失败：{error}"))?;
    Ok(())
}

pub fn list_backups(data: &AppData) -> Result<Vec<BackupInfo>, String> {
    let mut output = Vec::new();
    let entries = fs::read_dir(&data.backups)
        .map_err(|error| format!("无法读取备份目录：{error}"))?;
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if !path
            .extension()
            .map(|extension| extension.eq_ignore_ascii_case("zip"))
            .unwrap_or(false)
        {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().to_string();
        output.push(BackupInfo {
            path: path_string(&path),
            kind: kind_from_name(&name).to_string(),
            name,
            size: metadata.len(),
            created_at: metadata_ms(&metadata),
        });
    }
    output.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(output)
}

fn kind_from_name(name: &str) -> &'static str {
    if name.starts_with(AUTO_PREFIX) {
        "auto"
    } else if name.starts_with(PRE_RESTORE_PREFIX) {
        "pre-restore"
    } else {
        "manual"
    }
}

pub fn delete_backup(data: &AppData, path: &str) -> Result<(), String> {
    let validated = validate_backup_path(data, path)?;
    fs::remove_file(&validated).map_err(|error| format!("删除备份失败：{error}"))
}

pub fn auto_backup(data: &AppData) -> Result<Option<BackupInfo>, String> {
    let state = data.snapshot()?;
    if !state.settings.auto_backup {
        return Ok(None);
    }
    let interval = match state.settings.backup_interval.as_str() {
        "hourly" => 60 * 60 * 1000,
        "weekly" => 7 * 24 * 60 * 60 * 1000,
        "daily" => 24 * 60 * 60 * 1000,
        _ => return Ok(None),
    };
    let has_files = data
        .cached_items()
        .map(|items| {
            items
                .iter()
                .any(|item| item.kind != ItemKind::App)
        })
        .unwrap_or(false);
    if state.apps.is_empty() && state.categories.is_empty() && !has_files {
        return Ok(None);
    }
    if let Some(last) = data.last_backup() {
        if now_ms() - last < interval {
            return Ok(None);
        }
    }
    let info = create_backup(data, "auto")?;
    let retention = state.settings.backup_retention.clamp(1, 100);
    let _ = prune_auto_backups(data, retention);
    Ok(Some(info))
}

pub fn start_backup_scheduler(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut interval_ticks = 0u32;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let data = app.state::<AppData>();
            let settings = match data.snapshot() {
                Ok(state) => state.settings,
                Err(_) => continue,
            };
            if settings.auto_backup && settings.backup_on_change {
                if data.take_backup_change(3_000) {
                    match change_backup(&data) {
                        Ok(Some(info)) => {
                            let _ = app.emit("backup-created", &info);
                        }
                        Ok(None) => {}
                        Err(_) => data.mark_backup_dirty_again(),
                    }
                }
            }
            interval_ticks += 2;
            if interval_ticks >= 60 {
                interval_ticks = 0;
                if settings.auto_backup && settings.backup_interval != "manual" {
                    if let Ok(Some(info)) = auto_backup(&data) {
                        let _ = app.emit("backup-created", &info);
                    }
                }
            }
        }
    });
}

pub fn change_backup(data: &AppData) -> Result<Option<BackupInfo>, String> {
    let state = data.snapshot()?;
    if !state.settings.auto_backup || !state.settings.backup_on_change {
        return Ok(None);
    }
    let has_files = data
        .cached_items()
        .map(|items| {
            items
                .iter()
                .any(|item| item.kind != ItemKind::App)
        })
        .unwrap_or(false);
    if state.apps.is_empty() && state.categories.is_empty() && !has_files {
        return Ok(None);
    }
    let info = create_backup(data, "auto")?;
    let retention = state.settings.backup_retention.clamp(1, 100);
    let _ = prune_auto_backups(data, retention);
    Ok(Some(info))
}

pub fn manifest(data: &AppData) -> Result<BackupManifest, String> {
    let last_backup = data.last_backup();
    let mut backed_up = Vec::new();
    let mut pending = Vec::new();
    if data.library.exists() {
        for entry in WalkDir::new(&data.library)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let Some(key) = relative_key(entry.path(), &data.library) else {
                continue;
            };
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            let modified = metadata_ms(&metadata);
            let is_backed_up = last_backup
                .map(|time| modified <= time.max(0) as u64)
                .unwrap_or(false);
            let item = BackupManifestEntry {
                name: key.clone(),
                key,
                size: metadata.len(),
                modified,
                backed_up: is_backed_up,
            };
            if is_backed_up {
                backed_up.push(item);
            } else {
                pending.push(item);
            }
        }
    }
    backed_up.sort_by(|a, b| b.modified.cmp(&a.modified));
    pending.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(BackupManifest {
        last_backup,
        backed_up,
        pending,
    })
}

fn prune_auto_backups(data: &AppData, retention: usize) -> Result<(), String> {
    let backups = list_backups(data)?;
    let autos: Vec<&BackupInfo> = backups
        .iter()
        .filter(|backup| backup.kind == "auto")
        .collect();
    for backup in autos.into_iter().skip(retention) {
        let _ = fs::remove_file(&backup.path);
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageHeader {
    version: u32,
    salt: String,
    verifier: String,
    created_at: i64,
}

const PACKAGE_MAGIC: &[u8; 5] = b"DSNB1";
const PACKAGE_MAX_HEADER: u32 = 64 * 1024;

pub fn export_package(
    data: &AppData,
    destination: &Path,
    password: &str,
) -> Result<BackupPackageInfo, String> {
    vault::validate_password(password)?;
    let id = Uuid::new_v4();
    let snapshot = data.root.join(format!(".export-snapshot-{id}.zip"));
    let container = data.root.join(format!(".export-container-{id}.zip"));
    let result = (|| -> Result<BackupPackageInfo, String> {
        let state = data.snapshot()?;
        write_archive(data, &state, &snapshot)?;

        let file = File::create(&container)
            .map_err(|error| format!("无法创建导出容器：{error}"))?;
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .unix_permissions(0o644);
        writer
            .start_file("snapshot.zip", options)
            .map_err(|error| format!("无法写入导出快照：{error}"))?;
        let mut snapshot_input = File::open(&snapshot)
            .map_err(|error| format!("无法读取导出快照：{error}"))?;
        std::io::copy(&mut snapshot_input, &mut writer)
            .map_err(|error| format!("无法复制导出快照：{error}"))?;
        drop(snapshot_input);

        let history = list_backups(data)?;
        let mut included_backups = 1;
        for backup in history.iter().take(40) {
            let source = PathBuf::from(&backup.path);
            if !source.exists() {
                continue;
            }
            writer
                .start_file(format!("history/{}", backup.name), options)
                .map_err(|error| format!("无法写入历史备份：{error}"))?;
            let mut input = File::open(&source)
                .map_err(|error| format!("无法读取历史备份：{error}"))?;
            std::io::copy(&mut input, &mut writer)
                .map_err(|error| format!("无法复制历史备份：{error}"))?;
            included_backups += 1;
        }
        writer
            .finish()
            .map_err(|error| format!("无法完成导出容器：{error}"))?;

        let (settings, key) = vault::create_vault(password)?;
        vault::encrypt_file(&container, &key)?;
        let header = PackageHeader {
            version: 1,
            salt: settings.salt,
            verifier: settings.verifier,
            created_at: now_ms(),
        };
        let header_bytes = serde_json::to_vec(&header)
            .map_err(|error| format!("无法生成备份包头部：{error}"))?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("无法创建导出目录：{error}"))?;
        }
        let mut output = File::create(destination)
            .map_err(|error| format!("无法创建备份包：{error}"))?;
        output
            .write_all(PACKAGE_MAGIC)
            .map_err(|error| format!("无法写入备份包：{error}"))?;
        output
            .write_all(&(header_bytes.len() as u32).to_le_bytes())
            .map_err(|error| format!("无法写入备份包：{error}"))?;
        output
            .write_all(&header_bytes)
            .map_err(|error| format!("无法写入备份包：{error}"))?;
        let mut encrypted = File::open(&container)
            .map_err(|error| format!("无法读取加密容器：{error}"))?;
        std::io::copy(&mut encrypted, &mut output)
            .map_err(|error| format!("无法写入加密数据：{error}"))?;
        let metadata = fs::metadata(destination)
            .map_err(|error| format!("无法读取备份包信息：{error}"))?;
        Ok(BackupPackageInfo {
            path: path_string(destination),
            name: destination
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| "DeskNest 加密备份包".to_string()),
            size: metadata.len(),
            created_at: metadata_ms(&metadata),
            included_backups,
        })
    })();
    let _ = fs::remove_file(&snapshot);
    let _ = fs::remove_file(&container);
    result
}

pub fn restore_package(
    data: &AppData,
    package: &Path,
    password: &str,
) -> Result<(), String> {
    let id = Uuid::new_v4();
    let payload = data.root.join(format!(".package-payload-{id}.dsne"));
    let inner_zip = data.root.join(format!(".package-inner-{id}.zip"));
    let snapshot = data
        .backups
        .join(format!(".package-snapshot-{id}.zip"));
    let result = (|| -> Result<(), String> {
        let mut input = File::open(package)
            .map_err(|error| format!("无法打开备份包：{error}"))?;
        let mut magic = [0u8; 5];
        input
            .read_exact(&mut magic)
            .map_err(|_| "备份包格式不正确".to_string())?;
        if &magic != PACKAGE_MAGIC {
            return Err("不是 DeskNest 加密备份包".to_string());
        }
        let mut length_bytes = [0u8; 4];
        input
            .read_exact(&mut length_bytes)
            .map_err(|_| "备份包头部不完整".to_string())?;
        let header_len = u32::from_le_bytes(length_bytes);
        if header_len == 0 || header_len > PACKAGE_MAX_HEADER {
            return Err("备份包头部长度不正确".to_string());
        }
        let mut header_bytes = vec![0u8; header_len as usize];
        input
            .read_exact(&mut header_bytes)
            .map_err(|_| "备份包头部不完整".to_string())?;
        let header: PackageHeader = serde_json::from_slice(&header_bytes)
            .map_err(|_| "备份包头部损坏".to_string())?;
        if header.version != 1 {
            return Err("不支持的备份包版本".to_string());
        }
        let settings = VaultSettings {
            enabled: true,
            salt: header.salt,
            verifier: header.verifier,
            created_at: header.created_at,
        };
        let key = vault::unlock_vault(&settings, password)?;

        let mut payload_file = File::create(&payload)
            .map_err(|error| format!("无法创建临时解密文件：{error}"))?;
        std::io::copy(&mut input, &mut payload_file)
            .map_err(|error| format!("无法读取备份包数据：{error}"))?;
        drop(payload_file);
        vault::decrypt_file_to(&payload, &key, &inner_zip)?;

        let mut archive = ZipArchive::new(
            File::open(&inner_zip)
                .map_err(|error| format!("无法读取备份容器：{error}"))?,
        )
        .map_err(|error| format!("备份容器损坏：{error}"))?;
        {
            let mut entry = archive
                .by_name("snapshot.zip")
                .map_err(|_| "备份包中缺少完整快照".to_string())?;
            let mut output = File::create(&snapshot)
                .map_err(|error| format!("无法创建恢复快照：{error}"))?;
            std::io::copy(&mut entry, &mut output)
                .map_err(|error| format!("无法解出恢复快照：{error}"))?;
        }
        drop(archive);
        restore_backup(data, &path_string(&snapshot))?;
        Ok(())
    })();
    let _ = fs::remove_file(&payload);
    let _ = fs::remove_file(&inner_zip);
    let _ = fs::remove_file(&snapshot);
    result
}

pub fn restore_backup(data: &AppData, path: &str) -> Result<(), String> {
    let validated = validate_backup_path(data, path)?;
    let temp = data
        .root
        .join(format!(".restore-{}", Uuid::new_v4()));
    if temp.exists() {
        let _ = fs::remove_dir_all(&temp);
    }
    fs::create_dir_all(&temp)
        .map_err(|error| format!("无法创建恢复临时目录：{error}"))?;

    let extraction = extract_archive(&validated, &temp);
    if let Err(error) = extraction {
        let _ = fs::remove_dir_all(&temp);
        return Err(error);
    }

    let state_bytes = match fs::read(temp.join("state.json")) {
        Ok(bytes) => bytes,
        Err(error) => {
            let _ = fs::remove_dir_all(&temp);
            return Err(format!("备份中缺少 state.json：{error}"));
        }
    };
    let restored: AppState = match serde_json::from_slice(&state_bytes) {
        Ok(state) => state,
        Err(error) => {
            let _ = fs::remove_dir_all(&temp);
            return Err(format!("备份中的状态文件无法解析：{error}"));
        }
    };

    if !temp.join("library").exists() {
        fs::create_dir_all(temp.join("library"))
            .map_err(|error| format!("无法准备资料库目录：{error}"))?;
    }
    if !temp.join("shortcuts").exists() {
        fs::create_dir_all(temp.join("shortcuts"))
            .map_err(|error| format!("无法准备快捷方式目录：{error}"))?;
    }

    let _safety = create_backup(data, "pre-restore")?;

    replace_directory(&temp.join("library"), &data.library)?;
    replace_directory(&temp.join("shortcuts"), &data.shortcuts)?;

    {
        let mut guard = data
            .state
            .lock()
            .map_err(|_| "状态锁已损坏，请重启应用".to_string())?;
        let mut restored = restored;
        restored.library_path = Some(path_string(&data.library));
        restored.backup_path = Some(path_string(&data.backups));
        *guard = restored;
        data.save(&guard)?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(entries) = fs::read_dir(&data.shortcuts) {
            for entry in entries.filter_map(Result::ok) {
                if entry
                    .path()
                    .extension()
                    .map(|ext| ext.eq_ignore_ascii_case("desktop"))
                    .unwrap_or(false)
                {
                    let _ = fs::set_permissions(
                        entry.path(),
                        fs::Permissions::from_mode(0o755),
                    );
                }
            }
        }
    }

    let _ = fs::remove_dir_all(&temp);
    Ok(())
}

fn extract_archive(path: &Path, destination: &Path) -> Result<(), String> {
    let file = File::open(path).map_err(|error| format!("无法读取备份：{error}"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| format!("备份文件已损坏：{error}"))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("读取备份条目失败：{error}"))?;
        let Some(relative) = entry.enclosed_name() else {
            return Err("备份中包含不安全的路径".to_string());
        };
        let components: Vec<String> = relative
            .components()
            .filter_map(|component| match component {
                std::path::Component::Normal(value) => {
                    Some(value.to_string_lossy().to_string())
                }
                _ => None,
            })
            .collect();
        let allowed = match components.first().map(String::as_str) {
            Some("library") | Some("shortcuts") => {
                components.len() >= 2 || entry.is_dir()
            }
            Some("state.json") | Some("manifest.json") => components.len() == 1,
            _ => false,
        };
        if !allowed {
            return Err(format!(
                "备份中包含未知条目：{}",
                relative.display()
            ));
        }

        let target = destination.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&target)
                .map_err(|error| format!("创建恢复目录失败：{error}"))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("创建恢复目录失败：{error}"))?;
        }
        let mut output = File::create(&target)
            .map_err(|error| format!("创建恢复文件失败：{error}"))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("写入恢复文件失败：{error}"))?;
    }
    Ok(())
}

fn validate_backup_path(data: &AppData, path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    let canonical = fs::canonicalize(&candidate)
        .map_err(|error| format!("备份文件不存在：{error}"))?;
    let root = fs::canonicalize(&data.backups)
        .map_err(|error| format!("备份目录不可用：{error}"))?;
    if !canonical.starts_with(&root) {
        return Err("只能操作 DeskNest 备份目录内的文件".to_string());
    }
    if !canonical
        .extension()
        .map(|extension| extension.eq_ignore_ascii_case("zip"))
        .unwrap_or(false)
    {
        return Err("不是有效的 ZIP 备份".to_string());
    }
    Ok(canonical)
}

fn replace_directory(source: &Path, target: &Path) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "无法定位数据目录".to_string())?;
    let backup = parent.join(format!(
        ".restore-old-{}",
        Uuid::new_v4()
    ));
    let had_target = target.exists();
    if had_target {
        fs::rename(target, &backup)
            .map_err(|error| format!("无法暂存当前数据：{error}"))?;
    }
    match fs::rename(source, target) {
        Ok(()) => {
            let _ = fs::remove_dir_all(&backup);
            Ok(())
        }
        Err(error) => {
            if had_target {
                let _ = fs::rename(&backup, target);
            }
            Err(format!("替换数据目录失败：{error}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Category;

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("desknest-{label}-{}", Uuid::new_v4()))
    }

    #[test]
    fn creates_and_restores_a_backup() {
        let root = test_root("backup");
        let data = AppData::init(root.clone()).expect("init app data");
        fs::write(data.library.join("笔记.docx"), b"original").expect("write file");
        data.mutate(|state| {
            state.categories.push(Category {
                id: "work".to_string(),
                name: "工作".to_string(),
                color: "#5f7f6b".to_string(),
                created_at: now_ms(),
            });
            state
                .assignments
                .insert("笔记.docx".to_string(), vec!["work".to_string()]);
            Ok(())
        })
        .expect("write state");

        let backup = create_backup(&data, "manual").expect("create backup");
        assert!(Path::new(&backup.path).exists());
        assert_eq!(list_backups(&data).expect("list").len(), 1);

        fs::write(data.library.join("笔记.docx"), b"changed").expect("change file");
        fs::write(data.library.join("新增.txt"), b"new").expect("add file");
        restore_backup(&data, &backup.path).expect("restore");

        assert_eq!(
            fs::read_to_string(data.library.join("笔记.docx")).expect("read"),
            "original"
        );
        assert!(!data.library.join("新增.txt").exists());
        let restored = data.snapshot().expect("snapshot");
        assert_eq!(restored.categories.len(), 1);
        assert_eq!(restored.assignments.get("笔记.docx").unwrap().len(), 1);
        assert!(list_backups(&data).expect("list").len() >= 2);
        let _ = fs::remove_dir_all(root);
    }
}
