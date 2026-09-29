#!/usr/bin/env python3
"""
make-ico.py -- assembles a multi-size Windows .ico from rendered bitmaps.

Python standard library only (struct/zlib/array), so it adds no project dependency.
Entries <=128px are classic 32bpp BI_RGB DIBs (BITMAPINFOHEADER + BGRA XOR data +
1bpp AND mask) which every shell context can read; the 256px entry is a PNG payload,
which is legal for Vista+ and keeps the file small.

Inputs come from build-icons.ps1 (System.Drawing): ico-<size>.bmp / ico-<size>.png
The script re-parses what it wrote and asserts the entry count and dimensions.
"""
from __future__ import annotations

import argparse
import struct
import sys
import zlib
from pathlib import Path


# ---------------------------------------------------------------- PNG handling
def png_size(data: bytes) -> tuple[int, int, int, int]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    assert data[12:16] == b"IHDR", "missing IHDR"
    w, h, depth, ctype, comp, filt, interlace = struct.unpack(">IIBBBBB", data[16:29])
    assert interlace == 0, "interlaced PNG unsupported"
    return w, h, depth, ctype


def read_png_rgba(path: Path) -> tuple[int, int, bytearray]:
    """Minimal PNG decoder for the non-interlaced 8-bit RGB/RGBA files we produce."""
    data = path.read_bytes()
    w, h, depth, ctype = png_size(data)
    assert depth == 8, f"only 8-bit PNG supported, got {depth}"
    channels = {2: 3, 6: 4}[ctype]
    pos, idat = 8, b""
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        if kind == b"IDAT":
            idat += data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * channels
    out = bytearray(w * h * 4)
    prev = bytearray(stride)
    i = 0
    for y in range(h):
        ftype = raw[i]; i += 1
        line = bytearray(raw[i:i + stride]); i += stride
        if ftype == 1:            # Sub
            for x in range(channels, stride):
                line[x] = (line[x] + line[x - channels]) & 0xFF
        elif ftype == 2:          # Up
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 0xFF
        elif ftype == 3:          # Average
            for x in range(stride):
                a = line[x - channels] if x >= channels else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 0xFF
        elif ftype == 4:          # Paeth
            for x in range(stride):
                a = line[x - channels] if x >= channels else 0
                b = prev[x]
                c = prev[x - channels] if x >= channels else 0
                p = a + b - 2 * c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 0xFF
        else:
            assert ftype == 0, f"unknown filter {ftype}"
        o = y * w * 4
        for x in range(w):
            s = x * channels
            out[o + x * 4 + 0] = line[s + 2]      # B
            out[o + x * 4 + 1] = line[s + 1]      # G
            out[o + x * 4 + 2] = line[s + 0]      # R
            out[o + x * 4 + 3] = line[s + 3] if channels == 4 else 255
        prev = line
    return w, h, out


def read_bmp_bgra(path: Path) -> tuple[int, int, bytearray]:
    """Read a 32bpp BI_RGB bottom-up BMP written by GDI+ -> top-down BGRA buffer."""
    data = path.read_bytes()
    assert data[:2] == b"BM", "not a BMP"
    off = struct.unpack("<I", data[10:14])[0]
    hdr = struct.unpack("<IiiHHIIiiII", data[14:54])
    size, w, h, planes, bpp = hdr[0], hdr[1], hdr[2], hdr[3], hdr[4]
    comp = hdr[5]
    assert size >= 40 and bpp == 32 and comp == 0, f"unsupported BMP: bpp={bpp} comp={comp}"
    top_down = h < 0
    h = abs(h)
    stride = w * 4
    rows = []
    for y in range(h):
        rows.append(bytearray(data[off + y * stride: off + (y + 1) * stride]))
    if top_down:
        return w, h, bytearray(b"".join(rows))
    rows.reverse()
    return w, h, bytearray(b"".join(rows))


# ---------------------------------------------------------------- ICO entries
def build_dib_entry(w: int, h: int, rgba_top_down: bytearray) -> bytes:
    """BITMAPINFOHEADER (height doubled) + bottom-up BGRA XOR data + 1bpp AND mask."""
    xor = bytearray()
    for y in range(h - 1, -1, -1):
        xor += rgba_top_down[y * w * 4:(y + 1) * w * 4]
    mask_row_bytes = ((w + 31) // 32) * 4
    and_mask = b"\x00" * (mask_row_bytes * h)   # 32bpp+alpha -> fully transparent mask
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, len(xor) + len(and_mask), 0, 0, 0, 0)
    return header + bytes(xor) + and_mask


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, help="dir holding ico-<size>.bmp / .png")
    ap.add_argument("--out", required=True, help="path of the .ico to write")
    ap.add_argument("--sizes", default="16,24,32,48,64,128,256")
    args = ap.parse_args()

    work, out = Path(args.work), Path(args.out)
    sizes = [int(s) for s in args.sizes.split(",") if s.strip()]
    entries = []
    for size in sizes:
        png = work / f"ico-{size}.png"
        bmp = work / f"ico-{size}.bmp"
        if size >= 256 and png.exists():
            payload = png.read_bytes()
            w, h, _depth, _ct = png_size(payload)
            assert (w, h) == (size, size), f"{png.name}: {w}x{h} != {size}"
            entries.append((size, payload, "png"))
        elif bmp.exists():
            w, h, bgra = read_bmp_bgra(bmp)
            assert (w, h) == (size, size), f"{bmp.name}: {w}x{h} != {size}"
            entries.append((size, build_dib_entry(w, h, bgra), "dib"))
        elif png.exists():
            w, h, rgba = read_png_rgba(png)
            assert (w, h) == (size, size)
            entries.append((size, build_dib_entry(w, h, rgba), "dib"))
        else:
            raise SystemExit(f"missing rendered bitmap for {size}px in {work}")

    count = len(entries)
    header_size = 6 + 16 * count
    offset = header_size
    dir_block = bytearray()
    body = bytearray()
    for size, payload, _kind in entries:
        dim = 0 if size >= 256 else size          # 0 means 256 per the ICO spec
        dir_block += struct.pack(
            "<BBBBHHII", dim, dim, 0, 0, 1, 32, len(payload), offset
        )
        body += payload
        offset += len(payload)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(struct.pack("<HHH", 0, 1, count) + bytes(dir_block) + bytes(body))
    print(f"wrote {out} ({out.stat().st_size} bytes, {count} entries)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
