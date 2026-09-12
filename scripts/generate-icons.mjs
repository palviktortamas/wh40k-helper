// Generates the PWA icon PNGs from pure geometry — no image toolchain needed.
// Run with: node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const BG = [0x0c, 0x0f, 0x0d]
const FG = [0x6a, 0xbf, 0x3f]

/** Signed distance to a rounded rectangle centred on the canvas. */
const roundedRect = (x, y, cx, cy, halfW, halfH, r) => {
  const dx = Math.abs(x - cx) - (halfW - r)
  const dy = Math.abs(y - cy) - (halfH - r)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - r
}

/**
 * Draws the mark: a green disc with a dark visor slit and jaw band. `inset` is
 * the fraction of the canvas kept clear around the glyph — maskable icons need
 * a wide safe zone because launchers crop to a circle.
 */
function render(size, { maskable }) {
  const px = Buffer.alloc(size * size * 3)
  const c = size / 2
  const glyphR = size * (maskable ? 0.30 : 0.38)
  const plateR = size * 0.5 - (maskable ? 0 : size * 0.03)
  const plateCorner = size * 0.22

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sample at pixel centres so the edges land where the maths says.
      const sx = x + 0.5
      const sy = y + 0.5
      let colour = BG

      const onPlate = maskable || roundedRect(sx, sy, c, c, plateR, plateR, plateCorner) <= 0
      if (onPlate) {
        const d = Math.hypot(sx - c, sy - c)
        if (d <= glyphR) colour = FG

        // Visor slit and jaw band cut back to the background colour.
        const visorTop = c - glyphR * 0.34
        const visorBottom = c - glyphR * 0.04
        const jawTop = c + glyphR * 0.30
        const jawBottom = c + glyphR * 0.52
        const halfSpan = glyphR * 0.62
        const withinSpan = Math.abs(sx - c) <= halfSpan
        if (colour === FG && withinSpan && sy >= visorTop && sy <= visorBottom) colour = BG
        if (colour === FG && withinSpan && sy >= jawTop && sy <= jawBottom) colour = BG
        // Two tusks interrupt the jaw band so the mark reads as a face.
        const tuskOffset = glyphR * 0.30
        const nearTusk = Math.abs(Math.abs(sx - c) - tuskOffset) <= glyphR * 0.09
        if (nearTusk && sy >= jawTop && sy <= jawBottom && Math.hypot(sx - c, sy - c) <= glyphR) {
          colour = FG
        }
      }

      const i = (y * size + x) * 3
      px[i] = colour[0]
      px[i + 1] = colour[1]
      px[i + 2] = colour[2]
    }
  }
  return px
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour RGB
  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0
    pixels.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT, { recursive: true })
for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  writeFileSync(resolve(OUT, name), png(size, render(size, { maskable })))
  console.log('wrote', name)
}
