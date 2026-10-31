import { appGradient, fileMeta, initials } from "../lib/format";
import type { Item } from "../types";

export function ItemGlyph({
  item,
  size = "md",
}: {
  item: Item;
  size?: "sm" | "md" | "lg";
}) {
  if (item.kind === "app") {
    if (item.icon) {
      return (
        <div className={`glyph app-glyph native glyph-${size}`} aria-hidden="true">
          <img src={item.icon} alt="" />
          <i />
        </div>
      );
    }
    return (
      <div
        className={`glyph app-glyph glyph-${size}`}
        style={{ background: appGradient(item.name) }}
        aria-hidden="true"
      >
        <span>{initials(item.name)}</span>
        <i />
      </div>
    );
  }
  const meta = fileMeta(item.extension);
  return (
    <div
      className={`glyph file-glyph tone-${meta.tone} glyph-${size}`}
      aria-hidden="true"
    >
      <span className="glyph-fold" />
      <span className="glyph-badge">{meta.badge}</span>
    </div>
  );
}
