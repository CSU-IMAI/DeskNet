use crate::library;
use crate::models::{AppRecord, ImportResult, LaunchKind};
use crate::store::AppData;
use crate::util::{
    extension_of, now_ms, path_string, relative_key, unique_destination,
};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "windows")]
use std::process::Command;
use uuid::Uuid;

struct ShortcutMetadata {
    name: Option<String>,
    target: String,
    args: Vec<String>,
    working_dir: Option<String>,
    source: String,
    launch_kind: LaunchKind,
}

pub fn is_app_candidate(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let extension = extension_of(&path.to_string_lossy());
    match std::env::consts::OS {
        "windows" => matches!(extension.as_str(), "lnk" | "url" | "exe"),
        "linux" => {
            extension == "desktop"
                || (extension == "appimage" && is_executable(path))
        }
        _ => extension == "desktop",
    }
}

pub fn import_paths(
    data: &AppData,
    paths: Vec<String>,
    category_id: Option<String>,
) -> Result<ImportResult, String> {
    if let Some(category_id) = category_id.as_deref() {
        let state = data.snapshot()?;
        if !data.category_exists(&state, category_id) {
            return Err("目标分类不存在".to_string());
        }
    }

    let mut result = ImportResult::default();
    let mut new_keys: Vec<String> = Vec::new();

    for raw in paths {
        if raw.trim().is_empty() {
            continue;
        }
        let path = PathBuf::from(&raw);
        if !path.exists() {
            result
                .errors
                .push(format!("找不到：{}", path.display()));
            continue;
        }

        if path.starts_with(&data.root) {
            result
                .skipped
                .push(format!("{} 已在 DeskNest 数据目录中", path.display()));
            continue;
        }
        if path.starts_with(&data.library) {
            result
                .skipped
                .push(format!("{} 已在资料库中", path.display()));
            continue;
        }

        if path.is_dir() {
            match import_folder(data, &path) {
                Ok(None) => {
                    result.skipped.push(format!(
                        "文件夹「{}」中没有可导入的文件",
                        path.display()
                    ));
                }
                Ok(Some(key)) => new_keys.push(key),
                Err(error) => result.errors.push(error),
            }
            continue;
        }

        if is_app_candidate(&path) {
            match import_app(data, &path) {
                Ok(ImportAppOutcome::Imported(key)) => new_keys.push(key),
                Ok(ImportAppOutcome::Duplicate(name)) => {
                    result.skipped.push(format!("「{name}」已在软件列表中"));
                }
                Err(error) => result.errors.push(error),
            }
            continue;
        }

        match import_file(data, &path) {
            Ok(key) => new_keys.push(key),
            Err(error) => result.errors.push(error),
        }
    }

    if let Some(category_id) = category_id {
        if !new_keys.is_empty() {
            data.mutate(|state| {
                if state
                    .categories
                    .iter()
                    .any(|category| category.id == category_id)
                {
                    for key in &new_keys {
                        library::assign_category(state, key, &category_id);
                    }
                }
                Ok(())
            })?;
        }
    }

    let state = data.snapshot()?;
    let wanted: HashSet<String> = new_keys.iter().cloned().collect();
    let all = library::build_items_with_state(data, &state);
    result.imported = all
        .into_iter()
        .filter(|item| wanted.contains(&item.key) || wanted.contains(&item.id))
        .collect();
    result.imported_keys = new_keys;
    Ok(result)
}

pub fn import_desktop_shortcuts(data: &AppData) -> Result<ImportResult, String> {
    let desktop = dirs::desktop_dir().ok_or_else(|| "无法定位当前用户的桌面目录".to_string())?;
    if !desktop.exists() {
        return Err(format!("桌面目录不存在：{}", desktop.display()));
    }
    let mut paths = Vec::new();
    for entry in fs::read_dir(&desktop)
        .map_err(|error| format!("无法读取桌面目录：{error}"))?
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if is_app_candidate(&path) {
            paths.push(path_string(&path));
        }
    }
    if paths.is_empty() {
        return Ok(ImportResult::default());
    }
    import_paths(data, paths, None)
}

fn import_file(data: &AppData, source: &Path) -> Result<String, String> {
    let file_name = source
        .file_name()
        .ok_or_else(|| format!("无法读取文件名：{}", source.display()))?;
    let destination = unique_destination(&data.library, file_name);
    fs::copy(source, &destination).map_err(|error| {
        let _ = fs::remove_file(&destination);
        format!(
            "复制「{}」失败：{error}",
            source.file_name().unwrap_or_default().to_string_lossy()
        )
    })?;
    relative_key(&destination, &data.library)
        .ok_or_else(|| "无法生成资料库索引".to_string())
}

fn import_folder(data: &AppData, source: &Path) -> Result<Option<String>, String> {
    let folder_name = source
        .file_name()
        .ok_or_else(|| format!("无法读取文件夹名：{}", source.display()))?;
    let destination = unique_destination(&data.library, folder_name);
    fs::create_dir_all(&destination)
        .map_err(|error| format!("无法创建导入目录：{error}"))?;

    let mut copied = 0usize;
    for entry in walkdir::WalkDir::new(source)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        if entry.file_type().is_symlink() {
            continue;
        }
        if entry.path() == source {
            continue;
        }
        let Ok(relative) = entry.path().strip_prefix(source) else {
            continue;
        };
        let target = destination.join(relative);
        if entry.file_type().is_dir() {
            let _ = fs::create_dir_all(&target);
        } else if entry.file_type().is_file() {
            if let Some(parent) = target.parent() {
                let _ = fs::create_dir_all(parent);
            }
            match fs::copy(entry.path(), &target) {
                Ok(_) => copied += 1,
                Err(error) => {
                    eprintln!(
                        "DeskNest: 复制 {} 失败：{error}",
                        entry.path().display()
                    );
                }
            }
        }
    }

    if copied == 0 {
        let _ = fs::remove_dir_all(&destination);
        return Ok(None);
    }

    let key = relative_key(&destination, &data.library)
        .ok_or_else(|| "无法生成文件夹索引".to_string())?;
    Ok(Some(key))
}

enum ImportAppOutcome {
    Imported(String),
    Duplicate(String),
}

fn import_app(data: &AppData, source: &Path) -> Result<ImportAppOutcome, String> {
    let canonical = fs::canonicalize(source).unwrap_or_else(|_| source.to_path_buf());
    let canonical_text = path_string(&canonical);
    let state = data.snapshot()?;
    if let Some(existing) = state.apps.iter().find(|app| {
        app.original_path
            .as_deref()
            .map(|value| value.eq_ignore_ascii_case(&canonical_text))
            .unwrap_or(false)
    }) {
        return Ok(ImportAppOutcome::Duplicate(existing.name.clone()));
    }

    let extension = extension_of(&source.to_string_lossy());
    let file_stem = source
        .file_stem()
        .map(|value| value.to_string_lossy().trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "未命名软件".to_string());
    let metadata = read_shortcut_metadata(source, &extension);
    let name = metadata
        .as_ref()
        .and_then(|value| value.name.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(file_stem);
    let launch_kind = metadata
        .as_ref()
        .map(|value| value.launch_kind.clone())
        .unwrap_or(LaunchKind::Command);
    let target = metadata
        .as_ref()
        .map(|value| value.target.clone())
        .unwrap_or_else(|| path_string(source));
    let args = metadata
        .as_ref()
        .map(|value| value.args.clone())
        .unwrap_or_default();
    let working_dir = metadata
        .as_ref()
        .and_then(|value| value.working_dir.clone());
    let source_label = metadata
        .as_ref()
        .map(|value| value.source.clone())
        .unwrap_or_else(|| "应用".to_string());

    let needs_copy = matches!(
        launch_kind,
        LaunchKind::Shortcut | LaunchKind::DesktopEntry | LaunchKind::Url
    );
    let shortcut_file = if needs_copy {
        Some(copy_managed_shortcut(data, source, &extension)?)
    } else {
        None
    };

    let record = AppRecord {
        id: Uuid::new_v4().to_string(),
        name,
        target,
        args,
        working_dir,
        launch_kind,
        shortcut_file: shortcut_file.clone(),
        original_path: Some(canonical_text.clone()),
        source: source_label,
        created_at: now_ms(),
    };
    let record_id = record.id.clone();
    let record_name = record.name.clone();

    let inserted = data.mutate(|state| {
        let duplicate = state.apps.iter().any(|app| {
            app.original_path
                .as_deref()
                .map(|value| value.eq_ignore_ascii_case(&canonical_text))
                .unwrap_or(false)
        });
        if duplicate {
            return Ok(false);
        }
        state.apps.push(record.clone());
        Ok(true)
    });

    match inserted {
        Ok(true) => Ok(ImportAppOutcome::Imported(record_id)),
        Ok(false) => {
            if let Some(file) = shortcut_file {
                if let Ok(path) = data.shortcuts_path(&file) {
                    let _ = fs::remove_file(path);
                }
            }
            Ok(ImportAppOutcome::Duplicate(record_name))
        }
        Err(error) => {
            if let Some(file) = shortcut_file {
                if let Ok(path) = data.shortcuts_path(&file) {
                    let _ = fs::remove_file(path);
                }
            }
            Err(error)
        }
    }
}

fn copy_managed_shortcut(
    data: &AppData,
    source: &Path,
    extension: &str,
) -> Result<String, String> {
    let extension = if extension.is_empty() {
        "shortcut".to_string()
    } else {
        extension.to_string()
    };
    let file_name = format!("{}.{}", Uuid::new_v4(), extension);
    let destination = data.shortcuts.join(&file_name);
    fs::copy(source, &destination)
        .map_err(|error| format!("保存快捷方式副本失败：{error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&destination, fs::Permissions::from_mode(0o755));
    }
    Ok(file_name)
}

fn read_shortcut_metadata(path: &Path, extension: &str) -> Option<ShortcutMetadata> {
    #[cfg(target_os = "windows")]
    {
        if extension == "lnk" {
            return read_windows_lnk(path);
        }
        if extension == "url" {
            return read_windows_url(path);
        }
    }
    #[cfg(target_os = "linux")]
    {
        if extension == "desktop" {
            return read_desktop_entry(path);
        }
    }
    let _ = (path, extension);
    None
}

#[cfg(target_os = "windows")]
fn read_windows_lnk(path: &Path) -> Option<ShortcutMetadata> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let escaped = path_string(path).replace('\'', "''");
    let script = format!(
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
         $ErrorActionPreference='Stop'; \
         $s=(New-Object -ComObject WScript.Shell).CreateShortcut('{escaped}'); \
         [pscustomobject]@{{TargetPath=$s.TargetPath;Arguments=$s.Arguments;WorkingDirectory=$s.WorkingDirectory}} \
         | ConvertTo-Json -Compress"
    );
    let output = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let value: serde_json::Value =
        serde_json::from_str(text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}'))
            .ok()?;
    let target = value
        .get("TargetPath")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let arguments = value
        .get("Arguments")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let working_dir = value
        .get("WorkingDirectory")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    Some(ShortcutMetadata {
        name: None,
        target,
        args: shell_words::split(arguments).unwrap_or_default(),
        working_dir,
        source: "Windows 快捷方式".to_string(),
        launch_kind: LaunchKind::Shortcut,
    })
}

#[cfg(target_os = "windows")]
fn read_windows_url(path: &Path) -> Option<ShortcutMetadata> {
    let content = fs::read_to_string(path).ok()?;
    let mut url = String::new();
    for line in content.lines() {
        if let Some(value) = line.strip_prefix("URL=") {
            url = value.trim().to_string();
            break;
        }
    }
    if url.is_empty() {
        return None;
    }
    Some(ShortcutMetadata {
        name: None,
        target: url,
        args: Vec::new(),
        working_dir: None,
        source: "网址快捷方式".to_string(),
        launch_kind: LaunchKind::Url,
    })
}

#[cfg(target_os = "linux")]
fn read_desktop_entry(path: &Path) -> Option<ShortcutMetadata> {
    let content = fs::read_to_string(path).ok()?;
    let entry = parse_desktop_entry(&content)?;
    let (target, args) = split_desktop_exec(&entry.exec);
    Some(ShortcutMetadata {
        name: entry.name,
        target,
        args,
        working_dir: entry.path,
        source: "Linux 桌面入口".to_string(),
        launch_kind: LaunchKind::DesktopEntry,
    })
}

#[cfg(target_os = "linux")]
struct DesktopEntry {
    name: Option<String>,
    exec: String,
    path: Option<String>,
}

#[cfg(target_os = "linux")]
fn parse_desktop_entry(content: &str) -> Option<DesktopEntry> {
    let mut in_entry = false;
    let mut name = None;
    let mut localized_name = None;
    let mut exec = String::new();
    let mut working_dir = None;
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match key {
            "Name" => name = Some(unescape_desktop_value(value)),
            "Name[zh_CN]" | "Name[zh]" => {
                localized_name = Some(unescape_desktop_value(value))
            }
            "Exec" => exec = unescape_desktop_value(value),
            "Path" => {
                let value = unescape_desktop_value(value);
                if !value.is_empty() {
                    working_dir = Some(value);
                }
            }
            _ => {}
        }
    }
    if exec.is_empty() {
        return None;
    }
    Some(DesktopEntry {
        name: localized_name.or(name),
        exec,
        path: working_dir,
    })
}

#[cfg(target_os = "linux")]
fn unescape_desktop_value(value: &str) -> String {
    let mut output = String::new();
    let mut chars = value.chars();
    while let Some(character) = chars.next() {
        if character != '\\' {
            output.push(character);
            continue;
        }
        match chars.next() {
            Some('s') => output.push(' '),
            Some('n') => output.push('\n'),
            Some('t') => output.push('\t'),
            Some('r') => output.push('\r'),
            Some('\\') => output.push('\\'),
            Some(other) => {
                output.push('\\');
                output.push(other);
            }
            None => output.push('\\'),
        }
    }
    output
}

#[cfg(target_os = "linux")]
fn split_desktop_exec(exec: &str) -> (String, Vec<String>) {
    let tokens = shell_words::split(exec).unwrap_or_else(|_| vec![exec.to_string()]);
    let filtered: Vec<String> = tokens
        .into_iter()
        .filter(|token| {
            !(token.starts_with('%') && token.len() == 2)
        })
        .collect();
    if filtered.is_empty() {
        return (exec.to_string(), Vec::new());
    }
    let target = filtered[0].clone();
    (target, filtered[1..].to_vec())
}

fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false);
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Category;
    use crate::util::now_ms;

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("desknest-{label}-{}", Uuid::new_v4()))
    }

    #[test]
    fn imports_a_document_into_the_unified_library() {
        let root = test_root("import");
        let source_dir = root.join("source");
        fs::create_dir_all(&source_dir).expect("source dir");
        let data = AppData::init(root.join("data")).expect("app data");
        let category_id = data
            .mutate(|state| {
                let category = Category {
                    id: "study".to_string(),
                    name: "学习".to_string(),
                    color: "#6c7fb4".to_string(),
                    created_at: now_ms(),
                };
                state.categories.push(category.clone());
                Ok(category.id)
            })
            .expect("category");

        let source = source_dir.join("报告.docx");
        fs::write(&source, b"document bytes").expect("write document");
        let result = import_paths(
            &data,
            vec![path_string(&source)],
            Some(category_id.clone()),
        )
        .expect("import");

        assert_eq!(result.errors.len(), 0);
        assert_eq!(result.imported.len(), 1);
        assert_eq!(result.imported[0].name, "报告.docx");
        assert_eq!(result.imported[0].categories, vec![category_id]);
        assert!(data.library.join("报告.docx").exists());
        assert!(source.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn maps_a_url_shortcut_as_an_application() {
        let root = test_root("url");
        let source_dir = root.join("source");
        fs::create_dir_all(&source_dir).expect("source dir");
        let data = AppData::init(root.join("data")).expect("app data");
        let source = source_dir.join("DeskNest 官网.url");
        fs::write(
            &source,
            "[InternetShortcut]\r\nURL=https://example.com/\r\n",
        )
        .expect("write url");

        let result =
            import_paths(&data, vec![path_string(&source)], None).expect("import");
        assert_eq!(result.imported.len(), 1);
        let state = data.snapshot().expect("state");
        assert_eq!(state.apps.len(), 1);
        assert_eq!(state.apps[0].launch_kind, LaunchKind::Url);
        assert_eq!(state.apps[0].target, "https://example.com/");
        assert!(state.apps[0].shortcut_file.is_some());
        let _ = fs::remove_dir_all(root);
    }
}
