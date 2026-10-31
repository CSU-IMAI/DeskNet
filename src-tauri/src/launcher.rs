use crate::library;
use crate::models::{AppRecord, ItemKind, LaunchKind};
use crate::store::AppData;
use crate::util::now_ms;
use crate::vault;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

pub fn open_item(data: &AppData, id: &str) -> Result<(), String> {
    let (kind, key) = library::split_id(id)?;
    match kind {
        ItemKind::File => {
            let path = data.library_path(&key)?;
            if !path.exists() {
                return Err("文件不存在，可能已被移动或删除".to_string());
            }
            let state = data.snapshot()?;
            let open_path = if state.encrypted_files.contains_key(&key) {
                let cached = data
                    .cached_vault_key()
                    .ok_or_else(|| "保险箱已锁定，请输入密码后再查看".to_string())?;
                let name = path
                    .file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_else(|| "document".to_string());
                let temp = vault::decrypted_temp_path(&data.decrypted, &name);
                vault::decrypt_file_to(&path, &cached, &temp)?;
                let cleanup = temp.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(15 * 60));
                    let _ = fs::remove_file(cleanup);
                });
                temp
            } else {
                path
            };
            if let Err(error) = open::that_detached(&open_path) {
                if state.encrypted_files.contains_key(&key) {
                    let _ = fs::remove_file(&open_path);
                }
                return Err(format!("无法打开文件：{error}"));
            }
            let _ = data.mutate(|state| {
                state.recent.insert(key.clone(), now_ms());
                Ok(())
            });
            Ok(())
        }
        ItemKind::Folder => {
            let path = data.library_path(&key)?;
            if !path.exists() {
                return Err("文件夹不存在，可能已被移动或删除".to_string());
            }
            open::that_detached(&path)
                .map_err(|error| format!("无法打开文件夹：{error}"))?;
            let _ = data.mutate(|state| {
                state.recent.insert(key.clone(), now_ms());
                Ok(())
            });
            Ok(())
        }
        ItemKind::App => {
            let state = data.snapshot()?;
            let app = state
                .apps
                .iter()
                .find(|app| app.id == key)
                .cloned()
                .ok_or_else(|| "软件映射不存在".to_string())?;
            launch_app(data, &app)?;
            let _ = data.mutate(|state| {
                state.recent.insert(app.id.clone(), now_ms());
                Ok(())
            });
            Ok(())
        }
    }
}

pub fn launch_app(data: &AppData, app: &AppRecord) -> Result<(), String> {
    match app.launch_kind {
        LaunchKind::Url => {
            if app.target.trim().is_empty() {
                return Err("网址快捷方式没有目标地址".to_string());
            }
            open::that_detached(&app.target)
                .map_err(|error| format!("无法打开网址：{error}"))
        }
        LaunchKind::Shortcut => {
            let managed = app
                .shortcut_file
                .as_ref()
                .and_then(|file| data.shortcuts_path(file).ok())
                .filter(|path| path.exists());
            if let Some(path) = managed {
                return open::that_detached(&path)
                    .map_err(|error| format!("无法启动快捷方式：{error}"));
            }
            launch_command(app)
        }
        LaunchKind::DesktopEntry => {
            let managed = app
                .shortcut_file
                .as_ref()
                .and_then(|file| data.shortcuts_path(file).ok())
                .filter(|path| path.exists());
            if let Some(path) = managed {
                #[cfg(target_os = "linux")]
                {
                    if let Ok(status) = Command::new("gio")
                        .arg("launch")
                        .arg(&path)
                        .status()
                    {
                        if status.success() {
                            return Ok(());
                        }
                    }
                }
                let _ = path;
            }
            launch_command(app)
        }
        LaunchKind::Command => launch_command(app),
    }
}

fn launch_command(app: &AppRecord) -> Result<(), String> {
    let target = Path::new(&app.target);
    if target.is_absolute() && !target.exists() {
        return Err(format!(
            "目标程序不存在：{}",
            target.display()
        ));
    }
    let mut command = Command::new(target);
    command.args(&app.args);
    if let Some(working_dir) = app.working_dir.as_deref() {
        let directory = Path::new(working_dir);
        if directory.is_dir() {
            command.current_dir(directory);
        }
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法启动「{}」：{error}", app.name))
}

pub fn reveal_item(data: &AppData, id: &str) -> Result<(), String> {
    let (kind, key) = library::split_id(id)?;
    let target: PathBuf = match kind {
        ItemKind::File | ItemKind::Folder => data.library_path(&key)?,
        ItemKind::App => {
            let state = data.snapshot()?;
            let app = state
                .apps
                .iter()
                .find(|app| app.id == key)
                .ok_or_else(|| "软件映射不存在".to_string())?;
            let target_path = PathBuf::from(&app.target);
            if matches!(app.launch_kind, LaunchKind::Shortcut | LaunchKind::Command)
                && target_path.exists()
            {
                target_path
            } else if let Some(file) = &app.shortcut_file {
                data.shortcuts_path(file)?
            } else {
                target_path
            }
        }
    };
    reveal_path(&target)
}

pub fn reveal_path(target: &Path) -> Result<(), String> {
    if !target.exists() {
        return Err(format!("路径不存在：{}", target.display()));
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg(format!("/select,{}", target.display()))
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("无法打开资源管理器：{error}"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let parent = if target.is_dir() {
            target
        } else {
            target
                .parent()
                .ok_or_else(|| "无法定位所在文件夹".to_string())?
        };
        open::that_detached(parent)
            .map_err(|error| format!("无法打开所在文件夹：{error}"))
    }
}

pub fn open_folder(data: &AppData, kind: &str) -> Result<(), String> {
    let path = match kind {
        "library" => &data.library,
        "backups" => &data.backups,
        "shortcuts" => &data.shortcuts,
        "data" => &data.root,
        _ => return Err("未知的目录类型".to_string()),
    };
    open::that_detached(path)
        .map_err(|error| format!("无法打开目录 {}：{error}", path.display()))
}
