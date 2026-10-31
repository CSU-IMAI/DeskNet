use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

pub fn metadata_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

pub fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

pub fn extension_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// A stable, slash-separated key relative to the library root.
pub fn relative_key(path: &Path, root: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let parts: Vec<String> = rel
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().to_string()),
            _ => None,
        })
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

/// Prevent a crafted IPC id from escaping the managed library directory.
pub fn safe_relative(key: &str) -> Result<PathBuf, String> {
    if key.trim().is_empty() {
        return Err("项目路径为空".to_string());
    }
    let mut output = PathBuf::new();
    for component in Path::new(key).components() {
        match component {
            Component::Normal(part) => output.push(part),
            Component::CurDir => {}
            _ => return Err("项目路径不合法".to_string()),
        }
    }
    if output.as_os_str().is_empty() {
        return Err("项目路径为空".to_string());
    }
    Ok(output)
}

pub fn unique_destination(dir: &Path, file_name: &std::ffi::OsStr) -> PathBuf {
    let direct = dir.join(file_name);
    if !direct.exists() {
        return direct;
    }

    let source = Path::new(file_name);
    let stem = source
        .file_stem()
        .map(|value| value.to_os_string())
        .unwrap_or_else(|| file_name.to_os_string());
    let extension = source.extension().map(|value| value.to_os_string());

    for index in 2..10_000 {
        let mut name = stem.clone();
        name.push(format!(" ({index})"));
        if let Some(extension) = &extension {
            name.push(".");
            name.push(extension);
        }
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }

    let mut fallback = stem;
    fallback.push(format!("-{}", now_ms()));
    if let Some(extension) = extension {
        fallback.push(".");
        fallback.push(extension);
    }
    dir.join(fallback)
}

pub fn validate_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("名称不能为空".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("名称不合法".to_string());
    }
    if trimmed.chars().count() > 180 {
        return Err("名称过长（最多 180 个字符）".to_string());
    }
    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        return Err("名称不能以点或空格结尾".to_string());
    }
    if trimmed
        .chars()
        .any(|c| c.is_control() || matches!(c, '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*'))
    {
        return Err("名称不能包含 / \\ : * ? \" < > | 等字符".to_string());
    }

    let stem = Path::new(trimmed)
        .file_stem()
        .map(|value| value.to_string_lossy().to_uppercase())
        .unwrap_or_default();
    let reserved = matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL"
            | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9"
            | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9"
    );
    if reserved {
        return Err("该名称是系统保留名称".to_string());
    }

    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_parent_traversal() {
        assert!(safe_relative("../secret.txt").is_err());
        assert!(safe_relative("a/../../secret.txt").is_err());
        assert!(safe_relative("/etc/passwd").is_err());
        assert_eq!(
            safe_relative("docs/文件.docx").unwrap(),
            PathBuf::from("docs").join("文件.docx")
        );
    }

    #[test]
    fn validates_names() {
        assert!(validate_file_name("报告.docx").is_ok());
        assert!(validate_file_name("a/b.docx").is_err());
        assert!(validate_file_name("CON.txt").is_err());
        assert!(validate_file_name("").is_err());
    }
}
