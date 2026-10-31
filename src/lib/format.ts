const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(bytes < 10 * KB ? 1 : 0)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}

export function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (timestamp >= startOfToday) return `今天 ${time}`;
  if (timestamp >= startOfToday - 86_400_000) return `昨天 ${time}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatRelative(timestamp: number | null | undefined): string {
  if (!timestamp) return "尚未备份";
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)} 天前`;
  return formatDate(timestamp);
}

export function shortPath(path: string, max = 52): string {
  if (path.length <= max) return path;
  const parts = path.replaceAll("\\", "/").split("/");
  if (parts.length < 3) return `…${path.slice(-max + 1)}`;
  const tail = parts.slice(-3).join("\\");
  return `…\\${tail.length > max ? tail.slice(-max + 1) : tail}`;
}

const FILE_TYPES: Record<string, { label: string; tone: string; badge: string }> = {
  doc: { label: "Word 文档", tone: "word", badge: "DOC" },
  docx: { label: "Word 文档", tone: "word", badge: "DOC" },
  dotx: { label: "Word 模板", tone: "word", badge: "DOC" },
  pdf: { label: "PDF 文档", tone: "pdf", badge: "PDF" },
  xls: { label: "电子表格", tone: "sheet", badge: "XLS" },
  xlsx: { label: "电子表格", tone: "sheet", badge: "XLS" },
  csv: { label: "表格数据", tone: "sheet", badge: "CSV" },
  ppt: { label: "演示文稿", tone: "slide", badge: "PPT" },
  pptx: { label: "演示文稿", tone: "slide", badge: "PPT" },
  png: { label: "图片", tone: "image", badge: "PNG" },
  jpg: { label: "图片", tone: "image", badge: "JPG" },
  jpeg: { label: "图片", tone: "image", badge: "JPG" },
  webp: { label: "图片", tone: "image", badge: "WEBP" },
  gif: { label: "动图", tone: "image", badge: "GIF" },
  svg: { label: "矢量图", tone: "image", badge: "SVG" },
  fig: { label: "设计稿", tone: "design", badge: "FIG" },
  sketch: { label: "设计稿", tone: "design", badge: "SKT" },
  psd: { label: "设计源文件", tone: "design", badge: "PSD" },
  ai: { label: "矢量设计稿", tone: "design", badge: "AI" },
  mp4: { label: "视频", tone: "video", badge: "MP4" },
  mov: { label: "视频", tone: "video", badge: "MOV" },
  mkv: { label: "视频", tone: "video", badge: "MKV" },
  mp3: { label: "音频", tone: "audio", badge: "MP3" },
  wav: { label: "音频", tone: "audio", badge: "WAV" },
  flac: { label: "音频", tone: "audio", badge: "FLAC" },
  zip: { label: "压缩包", tone: "archive", badge: "ZIP" },
  rar: { label: "压缩包", tone: "archive", badge: "RAR" },
  "7z": { label: "压缩包", tone: "archive", badge: "7Z" },
  md: { label: "Markdown", tone: "text", badge: "MD" },
  txt: { label: "文本", tone: "text", badge: "TXT" },
  json: { label: "JSON 数据", tone: "code", badge: "JSON" },
  js: { label: "脚本", tone: "code", badge: "JS" },
  ts: { label: "脚本", tone: "code", badge: "TS" },
  tsx: { label: "组件", tone: "code", badge: "TSX" },
  html: { label: "网页", tone: "code", badge: "HTML" },
  css: { label: "样式表", tone: "code", badge: "CSS" },
  exe: { label: "Windows 应用", tone: "app", badge: "EXE" },
  lnk: { label: "快捷方式", tone: "app", badge: "LNK" },
  desktop: { label: "桌面入口", tone: "app", badge: "APP" },
  appimage: { label: "Linux 应用", tone: "app", badge: "APP" },
  folder: { label: "文件夹", tone: "file", badge: "DIR" },
};

export function fileMeta(extension: string): { label: string; tone: string; badge: string } {
  const key = extension.toLowerCase().replace(/^\./, "");
  return (
    FILE_TYPES[key] ?? {
      label: key ? `${key.toUpperCase()} 文件` : "文件",
      tone: "file",
      badge: key ? key.slice(0, 4).toUpperCase() : "FILE",
    }
  );
}

export function typeLabel(item: { kind: string; extension: string; source: string | null }): string {
  if (item.kind === "app") return item.source || "软件";
  return fileMeta(item.extension).label;
}

export function initials(name: string): string {
  const cleaned = name.replace(/\.(exe|lnk|desktop|appimage)$/i, "").trim();
  if (!cleaned) return "?";
  const chars = Array.from(cleaned);
  const first = chars[0] ?? "?";
  if (/[\u3400-\u9fff]/.test(first)) {
    return chars.slice(0, 2).join("");
  }
  const words = cleaned.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return chars.slice(0, 2).join("").toUpperCase();
}

const APP_GRADIENTS = [
  "linear-gradient(135deg, #e37858, #b94c32)",
  "linear-gradient(135deg, #6f8e7b, #466655)",
  "linear-gradient(135deg, #7588b8, #4d6195)",
  "linear-gradient(135deg, #c9a45b, #9a7732)",
  "linear-gradient(135deg, #a4789c, #7a5372)",
  "linear-gradient(135deg, #5e93a1, #3f6c79)",
  "linear-gradient(135deg, #b26e61, #81463d)",
];

export function appGradient(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return APP_GRADIENTS[hash % APP_GRADIENTS.length];
}

export function formatBackupKind(kind: string): string {
  if (kind === "auto") return "自动备份";
  if (kind === "pre-restore") return "恢复前保护";
  return "手动备份";
}

export function withAlpha(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return `rgba(95, 127, 107, ${alpha})`;
  const value = match[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function categoryName(
  id: string,
  categories: { id: string; name: string }[],
): string {
  return categories.find((category) => category.id === id)?.name ?? "未分类";
}
