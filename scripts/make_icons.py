# Draws the app icon (dark tile, lime progress arc + dot) as PNGs with no dependencies.
import zlib, struct, math, sys, os

def png(path, size):
    bg = (14, 16, 19); lime = (196, 240, 74); dim = (40, 46, 54)
    cx = cy = size / 2; r = size * 0.30; w = size * 0.085
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            col = bg
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            d = math.hypot(dx, dy)
            ang = (math.degrees(math.atan2(dx, -dy)) + 360) % 360  # 0 at top, clockwise
            ring = abs(d - r)
            if ring < w / 2 + 1:
                a = max(0.0, min(1.0, w / 2 + 0.5 - ring))
                c = lime if ang <= 290 else dim
                col = tuple(round(bg[i] * (1 - a) + c[i] * a) for i in range(3))
            # rounded cap at the arc end + center dot
            for (px, py, pr, pc) in [(cx + r * math.sin(math.radians(290)), cy - r * math.cos(math.radians(290)), w / 2, lime),
                                     (cx, cy - r, w / 2, lime), (cx, cy, size * 0.075, lime)]:
                dd = math.hypot(x + 0.5 - px, y + 0.5 - py)
                if dd < pr + 0.5:
                    a = max(0.0, min(1.0, pr + 0.5 - dd))
                    col = tuple(round(col[i] * (1 - a) + pc[i] * a) for i in range(3))
            row += bytes(col)
        rows.append(bytes(row))
    raw = zlib.compress(b''.join(rows), 9)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', raw) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

out = sys.argv[1] if len(sys.argv) > 1 else 'public/icons'
os.makedirs(out, exist_ok=True)
for name, s in [('apple-touch-icon.png', 180), ('icon-192.png', 192), ('icon-512.png', 512)]:
    png(os.path.join(out, name), s)
print('icons written to', out)
