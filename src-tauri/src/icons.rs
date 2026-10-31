use crate::models::AppRecord;
use crate::store::AppData;
use std::path::Path;

#[cfg(target_os = "windows")]
pub fn data_url(data: &AppData, app: &AppRecord, primary: &Path) -> Option<String> {
    use base64::Engine;
    use std::fs;
    use std::io::BufWriter;

    let cache_dir = data.root.join("icons");
    let cache_path = cache_dir.join(format!("{}.png", app.id));
    if !cache_path.exists() {
        fs::create_dir_all(&cache_dir).ok()?;
        let target = Path::new(&app.target);
        let source = if target.exists() { target } else { primary };
        let icon = file_icon_provider::get_file_icon(source, 64).ok()?;
        if icon.width == 0 || icon.height == 0 || icon.pixels.len() < 4 {
            return None;
        }
        let file = fs::File::create(&cache_path).ok()?;
        let mut encoder = png::Encoder::new(
            BufWriter::new(file),
            icon.width,
            icon.height,
        );
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(&icon.pixels).ok()?;
    }
    let bytes = fs::read(&cache_path).ok()?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(not(target_os = "windows"))]
pub fn data_url(_data: &AppData, _app: &AppRecord, _primary: &Path) -> Option<String> {
    None
}
