#!/usr/bin/env python3
# Generates icons/source.png (1024x1024) of the creature — no third-party libs,
# just stdlib. Then: `cargo tauri icon icons/source.png` fans out every size.
import zlib, struct, math, os

N = 1024
buf = bytearray(4 * N * N)

BODY = (0x2b, 0x2f, 0x3d, 255)
BODY2 = (0x20, 0x24, 0x2e, 255)
EYE = (0xf4, 0xef, 0xe6, 255)

def px(x, y, c):
    i = 4 * (y * N + x)
    buf[i:i+4] = bytes(c)

def rounded(x, y, cx, cy, hw, hh, r):
    dx = abs(x - cx); dy = abs(y - cy)
    if dx <= hw - r or dy <= hh - r:
        return dx <= hw and dy <= hh
    ex = dx - (hw - r); ey = dy - (hh - r)
    return ex * ex + ey * ey <= r * r

cx, cy = N // 2, int(N * 0.53)
hw, hh, r = int(N * 0.30), int(N * 0.34), int(N * 0.11)
ex, eyw, eyh = int(N * 0.075), int(N * 0.028), int(N * 0.036)
eye_y = int(cy - N * 0.03)

for y in range(N):
    ty = (y - (cy - hh)) / (2 * hh)  # 0..1 top->bottom for gradient
    ty = min(1.0, max(0.0, ty))
    br = (int(BODY[0] + (BODY2[0]-BODY[0]) * ty),
          int(BODY[1] + (BODY2[1]-BODY[1]) * ty),
          int(BODY[2] + (BODY2[2]-BODY[2]) * ty), 255)
    for x in range(N):
        if rounded(x, y, cx, cy, hw, hh, r):
            # eyes
            if (abs(x - (cx - ex)) <= eyw and abs(y - eye_y) <= eyh) or \
               (abs(x - (cx + ex)) <= eyw and abs(y - eye_y) <= eyh):
                px(x, y, EYE)
            else:
                px(x, y, br)

# encode PNG
def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data +
            struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))

raw = bytearray()
stride = 4 * N
for y in range(N):
    raw.append(0)
    raw += buf[y*stride:(y+1)*stride]

png = (b"\x89PNG\r\n\x1a\n" +
       chunk(b"IHDR", struct.pack(">IIBBBBB", N, N, 8, 6, 0, 0, 0)) +
       chunk(b"IDAT", zlib.compress(bytes(raw), 9)) +
       chunk(b"IEND", b""))

out = os.path.join(os.path.dirname(__file__), "source.png")
with open(out, "wb") as f:
    f.write(png)
print("wrote", out)
