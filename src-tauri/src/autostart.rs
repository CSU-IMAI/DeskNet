use std::path::PathBuf;

const RUN_VALUE_NAME: &str = "DeskNest";
const AUTOSTART_ARG: &str = "--autostart";

pub fn set_enabled(enabled: bool) -> Result<(), String> {
    let exe = std::env::current_exe()
        .map_err(|error| format!("无法定位 DeskNest 可执行文件：{error}"))?;

    #[cfg(target_os = "windows")]
    {
        set_windows(enabled, &exe)
    }
    #[cfg(target_os = "linux")]
    {
        set_linux(enabled, &exe)
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = exe;
        if enabled {
            Err("当前系统暂不支持开机自启动".to_string())
        } else {
            Ok(())
        }
    }
}

#[cfg(target_os = "windows")]
fn set_windows(enabled: bool, exe: &PathBuf) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

    let mut command = Command::new("reg.exe");
    if enabled {
        let command_line = format!("\"{}\" {AUTOSTART_ARG}", exe.display());
        command.args([
            "add",
            RUN_KEY,
            "/v",
            RUN_VALUE_NAME,
            "/t",
            "REG_SZ",
            "/d",
            &command_line,
            "/f",
        ]);
    } else {
        command.args([
            "delete",
            RUN_KEY,
            "/v",
            RUN_VALUE_NAME,
            "/f",
        ]);
    }
    let output = command
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("无法更新开机自启动设置：{error}"))?;
    if enabled && !output.status.success() {
        return Err(format!(
            "无法开启开机自启动：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn set_linux(enabled: bool, exe: &PathBuf) -> Result<(), String> {
    use std::fs;

    let config = dirs::config_dir()
        .ok_or_else(|| "无法定位用户配置目录".to_string())?;
    let autostart_dir = config.join("autostart");
    let entry = autostart_dir.join("desknest.desktop");

    if !enabled {
        if entry.exists() {
            fs::remove_file(&entry)
                .map_err(|error| format!("无法关闭开机自启动：{error}"))?;
        }
        return Ok(());
    }

    fs::create_dir_all(&autostart_dir)
        .map_err(|error| format!("无法创建自启动目录：{error}"))?;
    let exec = format!(
        "\"{}\" {AUTOSTART_ARG}",
        exe.to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
    );
    let content = format!(
        "[Desktop Entry]\nType=Application\nName=DeskNest\nComment=DeskNest 桌面管家\nExec={exec}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"
    );
    fs::write(&entry, content)
        .map_err(|error| format!("无法写入自启动文件：{error}"))
}
