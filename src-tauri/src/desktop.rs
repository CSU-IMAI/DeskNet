use crate::models::{DesktopSettings, DesktopZone};
use crate::store::AppData;
use crate::util::now_ms;
use tauri::{
    AppHandle, Emitter, Manager, Monitor, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use uuid::Uuid;

const SEARCH_LABEL: &str = "quick-search";
const SEARCH_WIDTH: f64 = 720.0;
const SEARCH_HEIGHT: f64 = 74.0;
const DESKTOP_SEARCH_LABEL: &str = "desktop-search";
const DESKTOP_SEARCH_WIDTH: f64 = 430.0;
const DESKTOP_SEARCH_HEIGHT: f64 = 58.0;
const MIN_ZONE_WIDTH: f64 = 0.12;
const MIN_ZONE_HEIGHT: f64 = 0.14;

#[cfg(target_os = "windows")]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Keep desktop widgets above Explorer's icon host but below normal apps.
/// `set_always_on_bottom` places them below the icon host, where drag/drop and
/// clicks are swallowed by the desktop list view.
#[cfg(target_os = "windows")]
fn desktop_icon_host() -> windows_sys::Win32::Foundation::HWND {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowExW, FindWindowW, GetShellWindow,
    };
    unsafe {
        let class_icon = wide("SHELLDLL_DefView");
        let shell = GetShellWindow();
        if !shell.is_null()
            && !FindWindowExW(
                shell,
                std::ptr::null_mut(),
                class_icon.as_ptr(),
                std::ptr::null(),
            )
            .is_null()
        {
            return shell;
        }
        let class_worker = wide("WorkerW");
        let mut worker = FindWindowExW(
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            class_worker.as_ptr(),
            std::ptr::null(),
        );
        while !worker.is_null() {
            if !FindWindowExW(
                worker,
                std::ptr::null_mut(),
                class_icon.as_ptr(),
                std::ptr::null(),
            )
            .is_null()
            {
                return worker;
            }
            worker = FindWindowExW(
                std::ptr::null_mut(),
                worker,
                class_worker.as_ptr(),
                std::ptr::null(),
            );
        }
        FindWindowW(class_worker.as_ptr(), std::ptr::null())
    }
}

#[cfg(target_os = "windows")]
fn place_window_above_desktop_icons(window: &WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindow, SetWindowPos, GW_HWNDPREV, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOOWNERZORDER, SWP_NOSIZE,
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let host = desktop_icon_host();
    if host.is_null() {
        return;
    }
    unsafe {
        let above = GetWindow(host, GW_HWNDPREV);
        if above.is_null() {
            return;
        }
        SetWindowPos(
            hwnd.0,
            above,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn place_window_above_desktop_icons(_window: &WebviewWindow) {}

pub fn start_lock_watcher(app: AppHandle) {
    #[cfg(target_os = "windows")]
    std::thread::spawn(move || {
        let mut was_locked = false;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let locked = crate::desktop::windows_session_locked();
            if locked && !was_locked {
                let data = app.state::<AppData>();
                data.clear_vault();
                let _ = app.emit("vault-locked", ());
            }
            was_locked = locked;
        }
    });
    #[cfg(not(target_os = "windows"))]
    let _ = app;
}

#[cfg(target_os = "windows")]
fn windows_session_locked() -> bool {
    use windows_sys::Win32::System::RemoteDesktop::{
        WTSFreeMemory, WTSQuerySessionInformationW, WTSINFOEXW, WTSSessionInfoEx,
        WTS_CURRENT_SERVER_HANDLE, WTS_CURRENT_SESSION, WTS_SESSIONSTATE_LOCK,
    };
    unsafe {
        let mut buffer: *mut u16 = std::ptr::null_mut();
        let mut bytes: u32 = 0;
        let ok = WTSQuerySessionInformationW(
            WTS_CURRENT_SERVER_HANDLE,
            WTS_CURRENT_SESSION,
            WTSSessionInfoEx,
            &mut buffer,
            &mut bytes,
        );
        if ok == 0 || buffer.is_null() {
            return false;
        }
        let result = if bytes as usize >= std::mem::size_of::<WTSINFOEXW>() {
            let info = &*(buffer as *const WTSINFOEXW);
            if info.Level == 1 {
                let level = &info.Data.WTSInfoExLevel1;
                level.SessionFlags as u32 == WTS_SESSIONSTATE_LOCK
            } else {
                false
            }
        } else {
            false
        };
        WTSFreeMemory(buffer as *mut std::ffi::c_void);
        result
    }
}

fn zone_label(id: &str) -> String {
    format!("zone-{id}")
}

fn primary_monitor(app: &AppHandle) -> Result<Monitor, String> {
    app.primary_monitor()
        .map_err(|error| format!("无法读取显示器信息：{error}"))?
        .ok_or_else(|| "没有可用的显示器".to_string())
}

fn monitor_logical_size(monitor: &Monitor) -> (f64, f64, f64, f64) {
    let scale = monitor.scale_factor();
    (
        monitor.position().x as f64 / scale,
        monitor.position().y as f64 / scale,
        monitor.size().width as f64 / scale,
        monitor.size().height as f64 / scale,
    )
}

fn webview_data_dir(app: &AppHandle) -> std::path::PathBuf {
    app.state::<AppData>().root.join("webview2")
}

pub fn start_zone_overlap_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        use tauri::{PhysicalPosition, PhysicalSize};
        loop {
            std::thread::sleep(std::time::Duration::from_millis(450));
            for label in [DESKTOP_SEARCH_LABEL] {
                if let Some(window) = app.get_webview_window(label) {
                    place_window_above_desktop_icons(&window);
                }
            }
            let data = app.state::<AppData>();
            let state = match data.snapshot() {
                Ok(state) => state,
                Err(_) => continue,
            };
            for zone in &state.desktop.zones {
                let Some(window) = app.get_webview_window(&zone_label(&zone.id)) else {
                    continue;
                };
                place_window_above_desktop_icons(&window);
                let (Ok(position), Ok(size), Ok(Some(monitor))) = (
                    window.outer_position(),
                    window.outer_size(),
                    window.current_monitor(),
                ) else {
                    continue;
                };
                let monitor_width = monitor.size().width as f64;
                let monitor_height = monitor.size().height as f64;
                if monitor_width <= 0.0 || monitor_height <= 0.0 {
                    continue;
                }
                let x = (position.x - monitor.position().x) as f64 / monitor_width;
                let y = (position.y - monitor.position().y) as f64 / monitor_height;
                let width = size.width as f64 / monitor_width;
                let height = size.height as f64 / monitor_height;
                let overlaps = state
                    .desktop
                    .zones
                    .iter()
                    .any(|other| other.id != zone.id
                        && bounds_overlap(x, y, width, height, other));
                if !overlaps {
                    continue;
                }
                let target_x = monitor.position().x as f64 + zone.x * monitor_width;
                let target_y = monitor.position().y as f64 + zone.y * monitor_height;
                let _ = window.set_size(PhysicalSize::new(
                    (zone.width * monitor_width).round() as u32,
                    (zone.height * monitor_height).round() as u32,
                ));
                let _ = window.set_position(PhysicalPosition::new(
                    target_x.round() as i32,
                    target_y.round() as i32,
                ));
            }
        }
    });
}

pub fn create_quick_search_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(SEARCH_LABEL) {
        return Ok(window);
    }
    let monitor = primary_monitor(app)?;
    let (left, top, width, height) = monitor_logical_size(&monitor);
    let settings = app.state::<AppData>().snapshot()?.desktop;
    let use_custom = settings.search_custom
        && settings.search_x >= 0.0
        && settings.search_y >= 0.0;
    let x = if use_custom {
        left + settings.search_x.clamp(0.0, 1.0) * width
    } else {
        left + ((width - SEARCH_WIDTH) / 2.0).max(0.0)
    };
    let y = if use_custom {
        top + settings.search_y.clamp(0.0, 1.0) * height
    } else {
        top + 24.0
    };
    WebviewWindowBuilder::new(
        app,
        SEARCH_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("DeskNest 快速搜索")
    .inner_size(SEARCH_WIDTH, SEARCH_HEIGHT)
    .position(
        x.min(left + width - SEARCH_WIDTH).max(left),
        y.min(top + height - SEARCH_HEIGHT).max(top),
    )
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .shadow(false)
    .visible(false)
    .focused(false)
    .data_directory(webview_data_dir(app))
    .build()
    .map_err(|error| format!("无法创建快速搜索窗口：{error}"))
}

pub fn create_desktop_search_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(DESKTOP_SEARCH_LABEL) {
        return Ok(window);
    }
    let monitor = primary_monitor(app)?;
    let (left, top, width, _) = monitor_logical_size(&monitor);
    let x = left + ((width - DESKTOP_SEARCH_WIDTH) / 2.0).max(0.0);
    WebviewWindowBuilder::new(
        app,
        DESKTOP_SEARCH_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("DeskNest 桌面搜索")
    .inner_size(DESKTOP_SEARCH_WIDTH, DESKTOP_SEARCH_HEIGHT)
    .position(x, top + 24.0)
    .transparent(true)
    .decorations(false)
    .always_on_top(false)
    .skip_taskbar(true)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .shadow(false)
    .visible(false)
    .focused(false)
    .data_directory(webview_data_dir(app))
    .build()
    .map_err(|error| format!("无法创建桌面搜索胶囊：{error}"))
}

pub fn create_zone_window(app: &AppHandle, zone: &DesktopZone) -> Result<WebviewWindow, String> {
    let label = zone_label(&zone.id);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.set_title(&zone.name);
        return Ok(window);
    }
    let monitor = primary_monitor(app)?;
    let (left, top, width, height) = monitor_logical_size(&monitor);
    let zone_width = (zone.width.clamp(MIN_ZONE_WIDTH, 0.92) * width).max(250.0);
    let zone_height = (zone.height.clamp(MIN_ZONE_HEIGHT, 0.92) * height).max(160.0);
    let zone_x = left + zone.x.clamp(0.0, 1.0) * width;
    let zone_y = top + zone.y.clamp(0.0, 1.0) * height;

    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(&zone.name)
        .inner_size(zone_width, zone_height)
        .position(
            zone_x.min(left + width - zone_width).max(left),
            zone_y.min(top + height - zone_height).max(top),
        )
        .transparent(true)
        .decorations(false)
        .always_on_top(false)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .shadow(false)
        .visible(false)
        .focused(false);
    #[cfg(target_os = "windows")]
    let builder = builder.drag_and_drop(true);
    builder
        .data_directory(webview_data_dir(app))
        .build()
        .map_err(|error| format!("无法创建桌面分区窗口：{error}"))
}

pub fn sync_zone_windows(
    app: &AppHandle,
    zones: &[DesktopZone],
    visible: bool,
) -> Result<(), String> {
    let expected: Vec<String> = zones.iter().map(|zone| zone_label(&zone.id)).collect();
    let existing: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|label| label.starts_with("zone-"))
        .cloned()
        .collect();
    for label in existing {
        if !expected.contains(&label) {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.close();
            }
        }
    }

    for zone in zones {
        let window = create_zone_window(app, zone)?;
        let _ = window.set_title(&zone.name);
        if visible {
            let _ = window.show();
        } else {
            let _ = window.hide();
        }
    }
    Ok(())
}

pub fn create_initial_windows(app: &AppHandle) -> Result<(), String> {
    create_quick_search_window(app)?;
    create_desktop_search_window(app)?;
    let data = app.state::<AppData>();
    let state = data.snapshot()?;
    sync_zone_windows(app, &state.desktop.zones, state.desktop.zones_visible)?;
    apply_zones_visibility(app, state.desktop.zones_visible);
    Ok(())
}

pub fn show_quick_search(app: &AppHandle) -> Result<(), String> {
    if let Some(capsule) = app.get_webview_window(DESKTOP_SEARCH_LABEL) {
        let _ = capsule.hide();
    }
    let window = create_quick_search_window(app)?;
    window.show().map_err(|error| format!("无法显示快速搜索：{error}"))?;
    let _ = window.set_focus();
    let _ = window.emit("quick-search-show", ());
    Ok(())
}

pub fn hide_quick_search(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SEARCH_LABEL) {
        window
            .hide()
            .map_err(|error| format!("无法隐藏快速搜索：{error}"))?;
    }
    let data = app.state::<AppData>();
    if data
        .snapshot()
        .map(|state| state.desktop.zones_visible)
        .unwrap_or(false)
    {
        if let Some(capsule) = app.get_webview_window(DESKTOP_SEARCH_LABEL) {
            let _ = capsule.show();
        }
    }
    Ok(())
}

pub fn toggle_quick_search(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SEARCH_LABEL) {
        if window.is_visible().unwrap_or(false) {
            return hide_quick_search(app);
        }
    }
    show_quick_search(app)
}

pub fn apply_zones_visibility(app: &AppHandle, visible: bool) {
    if visible {
        let _ = create_desktop_search_window(app);
    }
    if let Some(window) = app.get_webview_window(DESKTOP_SEARCH_LABEL) {
        let quick_visible = app
            .get_webview_window(SEARCH_LABEL)
            .and_then(|quick| quick.is_visible().ok())
            .unwrap_or(false);
        if visible && !quick_visible {
            let _ = window.show();
        } else {
            let _ = window.hide();
        }
    }
    for (label, window) in app.webview_windows() {
        if label.starts_with("zone-") {
            if visible {
                let _ = window.show();
                let _ = window.emit("zone-refresh", ());
            } else {
                let _ = window.hide();
            }
        }
    }
}

pub fn toggle_zones_visibility(app: &AppHandle) -> Result<bool, String> {
    let data = app.state::<AppData>();
    let current = data.snapshot()?.desktop.zones_visible;
    let next = !current;
    let settings = data.mutate(|state| {
        state.desktop.zones_visible = next;
        Ok(state.desktop.clone())
    })?;
    apply_zones_visibility(app, next);
    let _ = app.emit("desktop-settings-changed", &settings);
    Ok(next)
}

fn bounds_overlap(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    other: &DesktopZone,
) -> bool {
    const GAP: f64 = 0.0005;
    x < other.x + other.width - GAP
        && x + width > other.x + GAP
        && y < other.y + other.height - GAP
        && y + height > other.y + GAP
}

pub fn validate_zones(
    data: &AppData,
    zones: Vec<DesktopZone>,
) -> Result<Vec<DesktopZone>, String> {
    let state = data.snapshot()?;
    let mut output = Vec::new();
    let mut ids = std::collections::HashSet::new();
    for zone in zones.into_iter().take(20) {
        let name = zone.name.trim();
        if name.is_empty() {
            continue;
        }
        let name = name.chars().take(24).collect::<String>();
        let color = if zone.color.len() == 7
            && zone.color.starts_with('#')
            && zone.color[1..].chars().all(|character| character.is_ascii_hexdigit())
        {
            zone.color.to_lowercase()
        } else {
            "#5f7f6b".to_string()
        };
        let filter = match zone.filter.as_str() {
            "apps" | "files" | "encrypted" => zone.filter,
            _ => "all".to_string(),
        };
        let category_id = zone.category_id.filter(|id| {
            state.categories.iter().any(|category| &category.id == id)
        });
        let mut id = zone.id.trim().to_string();
        if id.is_empty() || ids.contains(&id) {
            id = Uuid::new_v4().to_string();
        }
        ids.insert(id.clone());
        let width = zone.width.clamp(MIN_ZONE_WIDTH, 0.92);
        let height = zone.height.clamp(MIN_ZONE_HEIGHT, 0.92);
        let x = zone.x.clamp(0.0, (1.0 - width).max(0.0));
        let y = zone.y.clamp(0.0, (1.0 - height).max(0.0));
        output.push(DesktopZone {
            id,
            name,
            color,
            filter,
            category_id,
            x,
            y,
            width,
            height,
            created_at: if zone.created_at == 0 { now_ms() } else { zone.created_at },
        });
    }
    for (index, zone) in output.iter().enumerate() {
        for other in output.iter().skip(index + 1) {
            if bounds_overlap(zone.x, zone.y, zone.width, zone.height, other) {
                return Err(format!(
                    "「{}」和「{}」的边界重叠了，请先调整其中一个分区",
                    zone.name, other.name
                ));
            }
        }
    }
    Ok(output)
}

pub fn save_desktop_settings(
    app: &AppHandle,
    zones: Vec<DesktopZone>,
    zones_visible: bool,
) -> Result<DesktopSettings, String> {
    let data = app.state::<AppData>();
    let zones = validate_zones(&data, zones)?;
    let settings = data.mutate(|state| {
        let (search_x, search_y, search_custom) = (
            state.desktop.search_x,
            state.desktop.search_y,
            state.desktop.search_custom,
        );
        state.desktop = DesktopSettings {
            zones,
            zones_visible,
            search_x,
            search_y,
            search_custom,
        };
        Ok(state.desktop.clone())
    })?;
    sync_zone_windows(app, &settings.zones, settings.zones_visible)?;
    apply_zones_visibility(app, settings.zones_visible);
    let _ = app.emit("desktop-settings-changed", &settings);
    Ok(settings)
}

pub fn update_search_position(app: &AppHandle, x: f64, y: f64) -> Result<(), String> {
    let data = app.state::<AppData>();
    data.mutate(|state| {
        state.desktop.search_x = x.clamp(0.0, 1.0);
        state.desktop.search_y = y.clamp(0.0, 1.0);
        state.desktop.search_custom = true;
        Ok(())
    })
}

/// Persist the actual OS-level bounds before exit, so layout never resets
/// even if the final move event arrived after the frontend debounce timer.
pub fn save_all_layout(app: &AppHandle) {
    let data = app.state::<AppData>();
    let mut zones: Vec<(String, f64, f64, f64, f64)> = Vec::new();
    let mut search: Option<(f64, f64)> = None;

    for (label, window) in app.webview_windows() {
        if label == SEARCH_LABEL {
            if let (Ok(position), Ok(_size), Ok(Some(monitor))) = (
                window.outer_position(),
                window.outer_size(),
                window.current_monitor(),
            ) {
                let width = monitor.size().width as f64;
                let height = monitor.size().height as f64;
                if width > 0.0 && height > 0.0 {
                    search = Some((
                        (position.x - monitor.position().x) as f64 / width,
                        (position.y - monitor.position().y) as f64 / height,
                    ));
                }
            }
            continue;
        }
        if !label.starts_with("zone-") {
            continue;
        }
        if let (Ok(position), Ok(size), Ok(Some(monitor))) = (
            window.outer_position(),
            window.outer_size(),
            window.current_monitor(),
        ) {
            let width = monitor.size().width as f64;
            let height = monitor.size().height as f64;
            if width > 0.0 && height > 0.0 {
                let id = label.trim_start_matches("zone-").to_string();
                zones.push((
                    id,
                    (position.x - monitor.position().x) as f64 / width,
                    (position.y - monitor.position().y) as f64 / height,
                    size.width as f64 / width,
                    size.height as f64 / height,
                ));
            }
        }
    }

    let _ = data.mutate(|state| {
        for (id, x, y, width, height) in zones {
            let Some(index) = state
                .desktop
                .zones
                .iter()
                .position(|zone| zone.id == id)
            else {
                continue;
            };
            let next_width = width.clamp(MIN_ZONE_WIDTH, 0.92);
            let next_height = height.clamp(MIN_ZONE_HEIGHT, 0.92);
            let next_x = x.clamp(0.0, (1.0 - next_width).max(0.0));
            let next_y = y.clamp(0.0, (1.0 - next_height).max(0.0));
            let overlaps = state.desktop.zones.iter().enumerate().any(|(other_index, other)| {
                other_index != index
                    && bounds_overlap(next_x, next_y, next_width, next_height, other)
            });
            if overlaps {
                continue;
            }
            let zone = &mut state.desktop.zones[index];
            zone.width = next_width;
            zone.height = next_height;
            zone.x = next_x;
            zone.y = next_y;
        }
        if let Some((x, y)) = search {
            if state.desktop.search_custom {
                state.desktop.search_x = x.clamp(0.0, 1.0);
                state.desktop.search_y = y.clamp(0.0, 1.0);
            }
        }
        Ok(())
    });
}

pub fn update_zone_bounds(
    app: &AppHandle,
    id: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let data = app.state::<AppData>();
    data.mutate(|state| {
        let next_width = width.clamp(MIN_ZONE_WIDTH, 0.92);
        let next_height = height.clamp(MIN_ZONE_HEIGHT, 0.92);
        let next_x = x.clamp(0.0, (1.0 - next_width).max(0.0));
        let next_y = y.clamp(0.0, (1.0 - next_height).max(0.0));
        let index = state
            .desktop
            .zones
            .iter()
            .position(|zone| zone.id == id)
            .ok_or_else(|| "桌面分区不存在".to_string())?;
        for (other_index, other) in state.desktop.zones.iter().enumerate() {
            if other_index != index
                && bounds_overlap(next_x, next_y, next_width, next_height, other)
            {
                return Err("分区边界不能重叠".to_string());
            }
        }
        let zone = &mut state.desktop.zones[index];
        zone.width = next_width;
        zone.height = next_height;
        zone.x = next_x;
        zone.y = next_y;
        Ok(())
    })
}

pub fn focus_zones_manager(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.emit("open-zones-manager", ());
    }
}
