from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SCALE = 2
SIZE = 1024


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(
        tuple(int(value * SCALE) for value in box),
        radius=int(radius * SCALE),
        fill=fill,
    )


canvas = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
draw = ImageDraw.Draw(canvas)

# App tile
rounded(draw, (0, 0, 1024, 1024), 252, "#1B2B26")
# Folder tab and body
rounded(draw, (184, 230, 478, 392), 72, "#F4EFE3")
rounded(draw, (184, 300, 840, 768), 92, "#F4EFE3")
# Subtle fold line
draw.rounded_rectangle(
    (216 * SCALE, 462 * SCALE, 808 * SCALE, 473 * SCALE),
    radius=6 * SCALE,
    fill=(27, 43, 38, 34),
)
# Drawer handle
draw.rounded_rectangle(
    (326 * SCALE, 612 * SCALE, 500 * SCALE, 650 * SCALE),
    radius=19 * SCALE,
    fill="#1B2B26",
)
# Terracotta knob
draw.ellipse(
    (600 * SCALE, 560 * SCALE, 748 * SCALE, 708 * SCALE),
    fill="#D96343",
)
draw.ellipse(
    (640 * SCALE, 600 * SCALE, 708 * SCALE, 668 * SCALE),
    fill=(255, 255, 255, 34),
)

# Soft inner rim highlight
rounded(draw, (18, 18, 1006, 1006), 236, None)

icon = canvas.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
output = ROOT / "icon-source.png"
icon.save(output)
print(output)
