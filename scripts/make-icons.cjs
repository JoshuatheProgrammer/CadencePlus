/**
 * Renders an SVG logo into Windows icons with Electron's own Chromium
 * (no extra tools): <out>/icon.ico (16–256 px), <out>/icon.png (512 px) and
 * <out>/installer-sidebar.bmp / installer-header.bmp for the NSIS installer.
 *
 *   npx electron scripts/make-icons.cjs <logo.svg> <outDir> "<Product name>"
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { resolve, join } = require('node:path')

const [svgPath, outDir, product = 'Cadence'] = process.argv.slice(-3)
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

/** ICO with PNG-compressed entries (supported since Windows Vista). */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(pngs.length, 4)
  let off = head.length
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16
    head[e] = size >= 256 ? 0 : size
    head[e + 1] = size >= 256 ? 0 : size
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(data.length, e + 8)
    head.writeUInt32LE(off, e + 12)
    off += data.length
  })
  return Buffer.concat([head, ...pngs.map((p) => p.data)])
}

/** 24-bit bottom-up BMP from RGBA (NSIS wants BMPs for its side and header images). */
function bmp(w, h, rgba) {
  const row = Math.ceil((w * 3) / 4) * 4
  const buf = Buffer.alloc(54 + row * h)
  buf.write('BM', 0)
  buf.writeUInt32LE(buf.length, 2)
  buf.writeUInt32LE(54, 10)
  buf.writeUInt32LE(40, 14)
  buf.writeInt32LE(w, 18)
  buf.writeInt32LE(h, 22)
  buf.writeUInt16LE(1, 26)
  buf.writeUInt16LE(24, 28)
  buf.writeUInt32LE(row * h, 34)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4
      const d = 54 + (h - 1 - y) * row + x * 3
      buf[d] = rgba[s + 2]
      buf[d + 1] = rgba[s + 1]
      buf[d + 2] = rgba[s]
    }
  return buf
}

app.whenReady().then(async () => {
  const svg = readFileSync(resolve(svgPath), 'utf8')
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,<html><body></body></html>')
  const result = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))}
    await img.decode()
    const png = async (size) => {
      const c = new OffscreenCanvas(size, size)
      const g = c.getContext('2d')
      g.imageSmoothingQuality = 'high'
      g.drawImage(img, 0, 0, size, size)
      const b = await c.convertToBlob({ type: 'image/png' })
      return Array.from(new Uint8Array(await b.arrayBuffer()))
    }
    // Installer artwork: graphite panel with the logo and product name.
    const art = (w, h, logo, x, y, text, tx, ty, fs) => {
      const c = new OffscreenCanvas(w, h)
      const g = c.getContext('2d')
      g.fillStyle = '#101114'
      g.fillRect(0, 0, w, h)
      g.drawImage(img, x, y, logo, logo)
      if (text) {
        g.fillStyle = '#e8ecf2'
        g.font = '600 ' + fs + 'px "Segoe UI", sans-serif'
        g.fillText(text, tx, ty)
      }
      return Array.from(g.getImageData(0, 0, w, h).data)
    }
    const sizes = ${JSON.stringify(SIZES)}
    const icons = []
    for (const s of sizes) icons.push({ size: s, data: await png(s) })
    return {
      icons,
      big: await png(512),
      sidebar: art(164, 314, 96, 34, 70, ${JSON.stringify(product)}, 18, 220, 20),
      header: art(150, 57, 40, 104, 8, '', 0, 0, 0)
    }
  })()`)
  mkdirSync(resolve(outDir), { recursive: true })
  writeFileSync(join(outDir, 'icon.ico'), ico(result.icons.map((i) => ({ size: i.size, data: Buffer.from(i.data) }))))
  writeFileSync(join(outDir, 'icon.png'), Buffer.from(result.big))
  writeFileSync(join(outDir, 'installer-sidebar.bmp'), bmp(164, 314, result.sidebar))
  writeFileSync(join(outDir, 'installer-header.bmp'), bmp(150, 57, result.header))
  console.log(`icons → ${resolve(outDir)}`)
  app.quit()
})
