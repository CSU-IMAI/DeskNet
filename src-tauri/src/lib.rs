mod autostart;
mod backup;
mod commands;
mod desktop;
mod importer;
mod icons;
mod launcher;
mod library;
mod models;
mod store;
mod util;
mod vault;
mod watcher;

use store::AppData;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::utils::config::Color;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

static QUITTING: AtomicBool = AtomicBool::new(false);

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn toggle_desktop_mode(app: &AppHandle) {
    if let Err(error) = desktop::toggle_zones_visibility(app) {
        eprintln!("DeskNest: 无法切换桌面模式：{error}");
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if QUITTING.load(Ordering::SeqCst) {
                    return;
                }
                api.prevent_close();
                desktop::save_all_layout(&window.app_handle());
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let root = std::env::var_os("DESKNEST_DATA_DIR")
                .filter(|value| !value.is_empty())
                .map(std::path::PathBuf::from)
                .map(Ok)
                .unwrap_or_else(|| {
                    app.path()
                        .app_data_dir()
                        .map_err(|error| std::io::Error::other(error.to_string()))
                })?;
            let data = AppData::init(root.clone()).map_err(std::io::Error::other)?;
            app.manage(data);

            let auto_start = app
                .state::<AppData>()
                .snapshot()
                .map(|state| state.settings.auto_start)
                .unwrap_or(false);
            if auto_start {
                if let Err(error) = autostart::set_enabled(true) {
                    eprintln!("DeskNest: 无法刷新开机自启动路径：{error}");
                }
            }

            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("DeskNest 桌面管家")
                .inner_size(1380.0, 880.0)
                .min_inner_size(1040.0, 660.0)
                .center()
                .background_color(Color(244, 240, 232, 255))
                .data_directory(root.join("webview2"))
                .build()?;

            desktop::create_initial_windows(app.handle())
                .map_err(std::io::Error::other)?;
            desktop::start_lock_watcher(app.handle().clone());
            desktop::start_zone_overlap_watcher(app.handle().clone());
            backup::start_backup_scheduler(app.handle().clone());
            watcher::start_library_watcher(app.handle().clone());

            let tray_result = (|| -> tauri::Result<()> {
                let show_item =
                    MenuItem::with_id(app, "show", "显示主界面", true, None::<&str>)?;
                let mode_item = MenuItem::with_id(
                    app,
                    "desktop-mode",
                    "显示 / 隐藏桌面模式",
                    true,
                    None::<&str>,
                )?;
                let quit_item =
                    MenuItem::with_id(app, "quit", "退出 DeskNest", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_item, &mode_item, &quit_item])?;
                let mut builder = TrayIconBuilder::with_id("desknest-tray")
                    .tooltip("DeskNest 桌面管家")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => show_main_window(app),
                        "desktop-mode" => toggle_desktop_mode(app),
                        "quit" => {
                            QUITTING.store(true, Ordering::SeqCst);
                            desktop::save_all_layout(app);
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            show_main_window(tray.app_handle());
                        }
                    });
                if let Some(icon) = app.default_window_icon().cloned() {
                    builder = builder.icon(icon);
                }
                let tray = builder.build(app)?;
                app.manage(tray);
                Ok(())
            })();
            if let Err(error) = tray_result {
                eprintln!("DeskNest: 无法创建系统托盘：{error}");
            }

            if std::env::args().any(|arg| arg == "--autostart") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            if let Err(error) = app.global_shortcut().on_shortcut(
                "CommandOrControl+Shift+Space",
                |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = desktop::toggle_quick_search(app);
                    }
                },
            ) {
                eprintln!("DeskNest: 无法注册快速搜索快捷键：{error}");
            }
            if let Err(error) = app.global_shortcut().on_shortcut(
                "CommandOrControl+Shift+D",
                |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = desktop::toggle_zones_visibility(app);
                    }
                },
            ) {
                eprintln!("DeskNest: 无法注册桌面分区快捷键：{error}");
            }
            if let Err(error) = app.global_shortcut().on_shortcut(
                "CommandOrControl+Shift+M",
                |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        show_main_window(app);
                    }
                },
            ) {
                eprintln!("DeskNest: 无法注册主界面快捷键：{error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::refresh_items,
            commands::classify_paths,
            commands::import_paths,
            commands::import_desktop_shortcuts,
            commands::open_item,
            commands::reveal_item,
            commands::open_folder,
            commands::delete_item,
            commands::rename_item,
            commands::toggle_favorite,
            commands::set_item_categories,
            commands::create_category,
            commands::update_category,
            commands::delete_category,
            commands::update_settings,
            commands::set_auto_start,
            commands::list_backups,
            commands::backup_manifest,
            commands::export_backup_package,
            commands::restore_backup_package,
            commands::create_backup,
            commands::restore_backup,
            commands::delete_backup,
            commands::run_auto_backup,
            commands::clear_recent,
            commands::storage_info,
            commands::change_storage_path,
            commands::show_quick_search,
            commands::hide_quick_search,
            commands::toggle_quick_search,
            commands::set_zones_visible,
            commands::toggle_zones_visibility,
            commands::save_desktop_settings,
            commands::update_zone_bounds,
            commands::update_search_position,
            commands::set_zone_opacity,
            commands::open_zones_manager,
            commands::get_vault_status,
            commands::configure_vault,
            commands::unlock_vault,
            commands::lock_vault,
            commands::encrypt_item,
            commands::decrypt_item,
        ])
        .build(tauri::generate_context!())
        .expect("DeskNest 主程序启动失败");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { api, .. }
            if !QUITTING.load(Ordering::SeqCst) =>
        {
            api.prevent_exit();
        }
        tauri::RunEvent::Exit => {
            desktop::save_all_layout(app_handle);
        }
        _ => {}
    });
}
