import {
  GripVertical,
  Loader2,
  PanelsTopLeft,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { Category, DesktopSettings, DesktopZone, Item, ZoneFilter } from "../types";
import { ModalShell } from "./ModalShell";

interface ZonesModalProps {
  desktop: DesktopSettings;
  categories: Category[];
  items: Item[];
  onClose: () => void;
  onSave: (zones: DesktopZone[], visible: boolean) => Promise<void>;
}

const COLORS = ["#5f7f6b", "#d96343", "#6c7fb4", "#c79a4b", "#5e93a1", "#a4789c"];

export function ZonesModal({
  desktop,
  categories,
  items,
  onClose,
  onSave,
}: ZonesModalProps) {
  const [zones, setZones] = useState<DesktopZone[]>(() =>
    structuredClone(desktop.zones),
  );
  const [visible, setVisible] = useState(desktop.zonesVisible);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const zone of zones) {
      const count = items.filter((item) => {
        if (zone.categoryId && !item.categories.includes(zone.categoryId)) {
          return false;
        }
        if (zone.filter === "apps") return item.kind === "app";
        if (zone.filter === "files") {
          return item.kind === "file" || item.kind === "folder";
        }
        if (zone.filter === "encrypted") return item.encrypted;
        return true;
      }).length;
      map.set(zone.id, count);
    }
    return map;
  }, [items, zones]);

  const update = (id: string, patch: Partial<DesktopZone>) => {
    setZones((current) =>
      current.map((zone) => (zone.id === id ? { ...zone, ...patch } : zone)),
    );
  };

  const addZone = () => {
    const index = zones.length;
    setZones((current) => [
      ...current,
      {
        id: `zone-${crypto.randomUUID()}`,
        name: `分区 ${current.length + 1}`,
        color: COLORS[current.length % COLORS.length],
        filter: "all",
        categoryId: null,
        x: 0.06 + (index % 3) * 0.3,
        y: 0.58,
        width: 0.27,
        height: 0.28,
        createdAt: Date.now(),
      },
    ]);
  };

  const save = async () => {
    setBusy(true);
    setError("");
    const conflict = zones.find((zone, index) =>
      zones.slice(index + 1).some(
        (other) =>
          zone.x < other.x + other.width - 0.0005 &&
          zone.x + zone.width > other.x + 0.0005 &&
          zone.y < other.y + other.height - 0.0005 &&
          zone.y + zone.height > other.y + 0.0005,
      ),
    );
    if (conflict) {
      setError(`「${conflict.name}」和其他分区边界重叠，请先调整位置`);
      setBusy(false);
      return;
    }
    try {
      await onSave(zones, visible);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="桌面分区"
      eyebrow="桌面 HUD · 可点击直接打开"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="modal-footnote">
            显示分区后，可直接点击分区里的项目打开；拖动标题移动分区。
          </span>
          <button type="button" className="button button-quiet" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => void save()}
            disabled={busy}
          >
            {busy && <Loader2 size={14} className="spin" />}
            保存并应用
          </button>
        </>
      }
    >
      <div className="zones-intro">
        <span className="zones-intro-icon">
          <PanelsTopLeft size={23} />
        </span>
        <div>
          <strong>把桌面分成可点击的透明区域</strong>
          <p>
            每个分区是一个独立的置顶透明小窗。默认有「程序区」「文件区」和
            「加密区」；加密区在锁屏、重启或手动锁定后必须重新输入保险箱密码，
            才会显示加密文件。
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={visible}
          className={`switch ${visible ? "on" : ""}`}
          onClick={() => setVisible((current) => !current)}
          title={visible ? "隐藏桌面分区" : "显示桌面分区"}
        >
          <span />
        </button>
      </div>

      <div className="zone-editor-list">
        {zones.map((zone) => (
          <div className="zone-editor" key={zone.id}>
            <span className="zone-editor-grip">
              <GripVertical size={14} />
            </span>
            <div className="zone-editor-main">
              <div className="zone-editor-line">
                <input
                  value={zone.name}
                  onChange={(event) =>
                    update(zone.id, { name: event.target.value })
                  }
                  maxLength={24}
                  aria-label="分区名称"
                />
                <span className="zone-editor-count">
                  {counts.get(zone.id) ?? 0} 个项目
                </span>
                <button
                  type="button"
                  className="icon-button icon-button-sm"
                  onClick={() =>
                    setZones((current) =>
                      current.filter((entry) => entry.id !== zone.id),
                    )
                  }
                  aria-label={`删除分区 ${zone.name}`}
                  title="删除分区"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="zone-editor-line controls">
                <label>
                  显示
                  <select
                    value={zone.filter}
                    onChange={(event) =>
                      update(zone.id, {
                        filter: event.target.value as ZoneFilter,
                      })
                    }
                  >
                    <option value="all">全部项目</option>
                    <option value="apps">只看软件</option>
                    <option value="files">只看文件</option>
                    <option value="encrypted">只看加密文件</option>
                  </select>
                </label>
                <label>
                  分类
                  <select
                    value={zone.categoryId ?? ""}
                    onChange={(event) =>
                      update(zone.id, {
                        categoryId: event.target.value || null,
                      })
                    }
                  >
                    <option value="">全部分类</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="zone-editor-colors">
                  {COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`zone-color ${
                        zone.color === color ? "selected" : ""
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => update(zone.id, { color })}
                      aria-label={`设置颜色 ${color}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="zone-add" onClick={addZone}>
        <Plus size={15} /> 新建分区
      </button>

      <div className="zones-tip">
        <strong>使用方式</strong>
        <span>
          在桌面上按住分区标题拖动位置；拖动右下角调整大小。分区里的文件或软件
          单击即可打开，也可以把系统文件直接拖进分区导入。
        </span>
      </div>

      {error && <p className="form-error">{error}</p>}
    </ModalShell>
  );
}
