use crate::store::AppData;
use notify::{Event, EventKind, RecursiveMode, Watcher};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub fn start_library_watcher(app: AppHandle) {
    let library = app.state::<AppData>().library.clone();

    let (sender, receiver) = mpsc::channel();
    let mut watcher = match notify::recommended_watcher(move |result| {
        let _ = sender.send(result);
    }) {
        Ok(watcher) => watcher,
        Err(error) => {
            eprintln!("DeskNest: 无法创建资料库监听器：{error}");
            return;
        }
    };
    if let Err(error) = watcher.watch(&library, RecursiveMode::Recursive) {
        eprintln!("DeskNest: 无法监听资料库：{error}");
        return;
    }

    std::thread::spawn(move || {
        // Keep the watcher alive for the lifetime of the process.
        let _watcher = watcher;
        loop {
            let first = match receiver.recv() {
                Ok(Ok(event)) => event,
                Ok(Err(error)) => {
                    eprintln!("DeskNest: 资料库监听事件错误：{error}");
                    continue;
                }
                Err(_) => break,
            };
            if !is_relevant(&first) {
                continue;
            }

            // Coalesce bursts of file events so a large folder copy only
            // rebuilds the index once.
            loop {
                match receiver.recv_timeout(Duration::from_millis(450)) {
                    Ok(Ok(event)) => {
                        if !is_relevant(&event) {
                            continue;
                        }
                    }
                    Ok(Err(_)) => {}
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }

            let data = app.state::<AppData>();
            data.invalidate_items();
            match data.rebuild_items() {
                Ok(_) => {
                    let _ = app.emit("items-changed", ());
                }
                Err(error) => {
                    eprintln!("DeskNest: 资料库变化后重建索引失败：{error}");
                }
            }
        }
    });
}

fn is_relevant(event: &Event) -> bool {
    matches!(
        event.kind,
        EventKind::Create(_)
            | EventKind::Modify(_)
            | EventKind::Remove(_)
            | EventKind::Any
    )
}
