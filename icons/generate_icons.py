from PIL import Image, ImageDraw

SCALE = 4
BASE = 128
CANVAS = BASE * SCALE

def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)

def make_icon():
    img = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Background: rounded square, neutral indigo (no relation to YouTube's
    # own red/white branding, on purpose).
    bg_radius = int(CANVAS * 0.22)
    rounded_rect(d, [0, 0, CANVAS, CANVAS], bg_radius, (79, 70, 229, 255))

    # Inner content area
    margin = int(CANVAS * 0.16)
    inner_left = margin
    inner_top = margin
    inner_right = CANVAS - margin
    inner_bottom = CANVAS - margin
    inner_w = inner_right - inner_left
    inner_h = inner_bottom - inner_top

    gap = int(inner_w * 0.08)
    left_w = int(inner_w * 0.58)
    right_w = inner_w - left_w - gap

    panel_radius = int(CANVAS * 0.06)

    # Left panel (video column) — solid white
    left_box = [inner_left, inner_top, inner_left + left_w, inner_bottom]
    rounded_rect(d, left_box, panel_radius, (255, 255, 255, 255))

    # Right panel (side pane) — white, split into two stacked blocks to hint
    # at the stacked description/recommendations/comments sections
    right_x0 = inner_left + left_w + gap
    right_box = [right_x0, inner_top, inner_right, inner_bottom]
    rounded_rect(d, right_box, panel_radius, (255, 255, 255, 255))

    # Divider lines inside the right panel (two thin gaps, indigo-colored,
    # matching the background so they read as gaps/sections)
    stripe_h = max(int(CANVAS * 0.02), 2)
    section1_y = inner_top + int(inner_h * 0.30)
    section2_y = inner_top + int(inner_h * 0.62)
    d.rectangle([right_x0, section1_y, inner_right, section1_y + stripe_h], fill=(79, 70, 229, 255))
    d.rectangle([right_x0, section2_y, inner_right, section2_y + stripe_h], fill=(79, 70, 229, 255))

    return img

icon = make_icon()

for size in (16, 48, 128):
    resized = icon.resize((size, size), Image.LANCZOS)
    resized.save(f"icon{size}.png")
    print(f"wrote icon{size}.png")
