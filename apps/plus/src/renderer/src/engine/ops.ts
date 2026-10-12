/**
 * Pixel operations: Canvas filter strings run by the 2D canvas, and tone
 * lookup tables (Levels, Curves) run by a tiny WebGL2 shader, with a CPU
 * fallback when WebGL2 is unavailable. Both work on whole canvases so tiles
 * never show seams.
 */
import { scaleFilter, type PixelOp } from '@core/adjustments'
import { applyLutToPixels } from '@core/lut'
import { ctx2d, pipelineFormat, pixelCanvas } from './format'
import { drawShaderOp } from './shaders'
import type { Ctx2D } from './tiles'

type Source = OffscreenCanvas | HTMLCanvasElement

interface Gl {
  canvas: OffscreenCanvas
  gl: WebGL2RenderingContext
  src: WebGLTexture
  lut: WebGLTexture
}

let gl: Gl | null | undefined

const VS = `#version 300 es
in vec2 p;
out vec2 uv;
void main() {
  uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`

// The source arrives un-premultiplied; output is premultiplied for compositing.
const FS = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform sampler2D lut;
in vec2 uv;
out vec4 o;
// Linear interpolation between table entries: exact for 8-bit input, smooth (no banding) for 16-bit.
float look(float v, int ch) {
  float x = clamp(v, 0.0, 1.0) * 255.0;
  int i0 = int(floor(x));
  int i1 = min(i0 + 1, 255);
  float t = x - float(i0);
  return mix(texelFetch(lut, ivec2(i0, 0), 0)[ch], texelFetch(lut, ivec2(i1, 0), 0)[ch], t);
}
void main() {
  vec4 c = texture(src, vec2(uv.x, 1.0 - uv.y));
  o = vec4(vec3(look(c.r, 0), look(c.g, 1), look(c.b, 2)) * c.a, c.a);
}`

function initGl(): Gl | null {
  try {
    const canvas = new OffscreenCanvas(1, 1)
    const g = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true })
    if (!g) return null
    // Half-float drawing buffers for 16-bit documents.
    g.getExtension('EXT_color_buffer_float')
    g.getExtension('EXT_color_buffer_half_float')
    const sh = (type: number, code: string) => {
      const s = g.createShader(type)!
      g.shaderSource(s, code)
      g.compileShader(s)
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) ?? 'shader')
      return s
    }
    const prog = g.createProgram()!
    g.attachShader(prog, sh(g.VERTEX_SHADER, VS))
    g.attachShader(prog, sh(g.FRAGMENT_SHADER, FS))
    g.linkProgram(prog)
    if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(prog) ?? 'link')
    g.useProgram(prog)
    const buf = g.createBuffer()
    g.bindBuffer(g.ARRAY_BUFFER, buf)
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW)
    const loc = g.getAttribLocation(prog, 'p')
    g.enableVertexAttribArray(loc)
    g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0)
    const tex = (unit: number) => {
      const t = g.createTexture()!
      g.activeTexture(g.TEXTURE0 + unit)
      g.bindTexture(g.TEXTURE_2D, t)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
      return t
    }
    const src = tex(0)
    const lut = tex(1)
    g.uniform1i(g.getUniformLocation(prog, 'src'), 0)
    g.uniform1i(g.getUniformLocation(prog, 'lut'), 1)
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL, g.NONE)
    return { canvas, gl: g, src, lut }
  } catch (e) {
    console.warn('WebGL2 LUT path unavailable; using the CPU fallback.', e)
    return null
  }
}

/** True when tone curves run on the GPU. */
export function gpuLutAvailable(): boolean {
  if (gl === undefined) gl = initGl()
  return !!gl
}

/** Draws `src` through the lookup table into `ctx` at the origin. */
export function drawThroughLut(ctx: Ctx2D, src: Source, lut: Uint8Array): void {
  const w = src.width
  const h = src.height
  if (gl === undefined) gl = initGl()
  if (gl) {
    const { gl: g, canvas } = gl
    const f = pipelineFormat()
    // Keep the document's colour space and precision through the GPU.
    const ext = g as WebGL2RenderingContext & { unpackColorSpace: PredefinedColorSpace; drawingBufferColorSpace: PredefinedColorSpace; drawingBufferStorage?: (fmt: number, w: number, h: number) => void }
    ext.unpackColorSpace = f.space
    ext.drawingBufferColorSpace = f.space
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const float = f.depth === 16 && typeof ext.drawingBufferStorage === 'function'
    if (float) ext.drawingBufferStorage!(g.RGBA16F, w, h)
    else if (typeof ext.drawingBufferStorage === 'function') ext.drawingBufferStorage(g.RGBA8, w, h)
    g.viewport(0, 0, w, h)
    g.activeTexture(g.TEXTURE0)
    g.bindTexture(g.TEXTURE_2D, gl.src)
    if (float) g.texImage2D(g.TEXTURE_2D, 0, g.RGBA16F, g.RGBA, g.HALF_FLOAT, src)
    else g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src)
    g.activeTexture(g.TEXTURE1)
    g.bindTexture(g.TEXTURE_2D, gl.lut)
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, 256, 1, 0, g.RGBA, g.UNSIGNED_BYTE, lut)
    g.clearColor(0, 0, 0, 0)
    g.clear(g.COLOR_BUFFER_BIT)
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
    ctx.drawImage(canvas, 0, 0)
    return
  }
  const tmp = new OffscreenCanvas(w, h)
  const tg = tmp.getContext('2d', { willReadFrequently: true })!
  tg.drawImage(src, 0, 0)
  const img = tg.getImageData(0, 0, w, h)
  applyLutToPixels(img.data, lut)
  tg.putImageData(img, 0, 0)
  ctx.drawImage(tmp, 0, 0)
}

/** How far (target pixels) an op reads from its neighbours; 0 for per-pixel ops. */
export function opReach(op: PixelOp, scale = 1): number {
  if (typeof op === 'string') {
    let r = 0
    for (const m of op.matchAll(/blur\(([\d.]+)px\)/g)) r = Math.max(r, Number(m[1]) * 3)
    return Math.ceil(r * scale)
  }
  if (op instanceof Uint8Array) return 0
  const p = op.params
  if (op.shader === 'unsharp' || op.shader === 'highPass') return Math.ceil((p.radius ?? 0) * 3 * scale)
  if (op.shader === 'motionBlur') return Math.ceil(((p.dist ?? 0) / 2 + 1) * scale)
  return 0
}

/**
 * A copy of `src` padded by `m` on every side, whose pixels beyond `r`
 * repeat the nearest pixel of `r`'s border (filters then see the image
 * continue past the canvas edge instead of fading to transparent, as in
 * Photoshop). Source pixel (x, y) lands at (x + m, y + m).
 */
export function extendEdges(src: Source, r0: { x: number; y: number; w: number; h: number }, m: number): OffscreenCanvas {
  const c = pixelCanvas(src.width + 2 * m, src.height + 2 * m)
  const g = ctx2d(c)
  g.drawImage(src, m, m)
  if (m <= 0 || r0.w <= 0 || r0.h <= 0) return c
  g.imageSmoothingEnabled = false
  const r = { x: r0.x + m, y: r0.y + m, w: r0.w, h: r0.h }
  src = c
  const { x, y, w, h } = r
  // Sides: stretch the outermost row/column outward.
  g.drawImage(src, x, y, w, 1, x, y - m, w, m)
  g.drawImage(src, x, y + h - 1, w, 1, x, y + h, w, m)
  g.drawImage(src, x, y, 1, h, x - m, y, m, h)
  g.drawImage(src, x + w - 1, y, 1, h, x + w, y, m, h)
  // Corners: the corner pixel.
  g.drawImage(src, x, y, 1, 1, x - m, y - m, m, m)
  g.drawImage(src, x + w - 1, y, 1, 1, x + w, y - m, m, m)
  g.drawImage(src, x, y + h - 1, 1, 1, x - m, y + h, m, m)
  g.drawImage(src, x + w - 1, y + h - 1, 1, 1, x + w, y + h, m, m)
  return c
}

/**
 * Draws `src` through a pixel op (filter or LUT) into `ctx`; `scale` adapts
 * blur radii to the target. With `edges` (the canvas area within `src`),
 * neighbourhood filters see edge pixels repeated beyond it.
 */
export function drawWithOp(ctx: Ctx2D, src: Source, op: PixelOp, scale = 1, edges?: { x: number; y: number; w: number; h: number }): void {
  const reach = edges ? opReach(op, scale) : 0
  if (reach > 0) {
    // Filter a padded, edge-extended copy, then place it back.
    const padded = extendEdges(src, edges!, reach)
    const out = pixelCanvas(padded.width, padded.height)
    drawWithOp(ctx2d(out), padded, op, scale)
    ctx.drawImage(out, -reach, -reach)
    return
  }
  if (typeof op === 'string') {
    ctx.save()
    ctx.filter = scaleFilter(op, scale)
    ctx.drawImage(src, 0, 0)
    ctx.restore()
  } else if (op instanceof Uint8Array) drawThroughLut(ctx, src, op)
  else drawShaderOp(ctx, src, op, scale)
}

// ---------------------------------------------------------------------------
// Soft proofing (display only)
// ---------------------------------------------------------------------------

export type ProofKind = 'srgb' | 'gray' | 'protanopia' | 'deuteranopia' | 'tritanopia'

const PROOF_FS = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform int mode;      // 0 none, 1 clip to sRGB, 2 grey, 3 matrix (colour-blindness)
uniform bool warn;     // gamut warning: colours outside sRGB turn grey
uniform bool p3;       // document is Display P3
uniform mat3 cb;       // colour-blindness matrix (linear sRGB)
in vec2 uv;
out vec4 o;
const mat3 P3_TO_SRGB = mat3(1.2249401, -0.0420569, -0.0196376, -0.2249404, 1.0420571, -0.0786361, 0.0, 0.0, 1.0982735);
const mat3 SRGB_TO_P3 = mat3(0.8224621, 0.0331941, 0.0170827, 0.1775380, 0.9668058, 0.0723974, 0.0, 0.0, 0.9105199);
vec3 dec(vec3 v) { return mix(v / 12.92, pow((v + 0.055) / 1.055, vec3(2.4)), step(0.04045, v)); }
vec3 enc(vec3 v) { v = max(v, 0.0); return mix(v * 12.92, 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, v)); }
void main() {
  vec4 c = texture(src, vec2(uv.x, 1.0 - uv.y));
  if (c.a <= 0.0) { o = vec4(0.0); return; }
  vec3 lin = dec(c.rgb);
  vec3 s = p3 ? P3_TO_SRGB * lin : lin;
  bool out_ = any(lessThan(s, vec3(-0.002))) || any(greaterThan(s, vec3(1.002)));
  if (mode == 1) s = clamp(s, 0.0, 1.0);
  else if (mode == 2) s = vec3(dot(clamp(s, 0.0, 1.0), vec3(0.2126, 0.7152, 0.0722)));
  else if (mode == 3) s = clamp(cb * clamp(s, 0.0, 1.0), 0.0, 1.0);
  vec3 r = enc(p3 ? SRGB_TO_P3 * s : s);
  if (warn && out_) r = vec3(0.5);
  o = vec4(r * c.a, c.a);
}`

// Machado, Oliveira & Fernandes (2009), severity 1.0, linear sRGB (column-major for GLSL)
const CB: Record<'protanopia' | 'deuteranopia' | 'tritanopia', number[]> = {
  protanopia: [0.152286, 0.114503, -0.003882, 1.052583, 0.786281, -0.048116, -0.204868, 0.099216, 1.051998],
  deuteranopia: [0.367322, 0.280085, -0.01182, 0.860646, 0.672501, 0.04294, -0.227968, 0.047413, 0.968881],
  tritanopia: [1.255528, -0.078411, 0.004733, -0.076749, 0.930809, 0.691367, -0.178779, 0.147602, 0.3039]
}

let proofGl: { canvas: OffscreenCanvas; gl: WebGL2RenderingContext; prog: WebGLProgram; tex: WebGLTexture } | null | undefined

function initProof() {
  try {
    const canvas = new OffscreenCanvas(1, 1)
    const g = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true })
    if (!g) return null
    const sh = (type: number, code: string) => {
      const s = g.createShader(type)!
      g.shaderSource(s, code)
      g.compileShader(s)
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) ?? 'shader')
      return s
    }
    const prog = g.createProgram()!
    g.attachShader(prog, sh(g.VERTEX_SHADER, VS))
    g.attachShader(prog, sh(g.FRAGMENT_SHADER, PROOF_FS))
    g.linkProgram(prog)
    if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(prog) ?? 'link')
    g.useProgram(prog)
    const buf = g.createBuffer()
    g.bindBuffer(g.ARRAY_BUFFER, buf)
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW)
    const loc = g.getAttribLocation(prog, 'p')
    g.enableVertexAttribArray(loc)
    g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0)
    const tex = g.createTexture()!
    g.bindTexture(g.TEXTURE_2D, tex)
    for (const [k, v] of [
      [g.TEXTURE_MIN_FILTER, g.NEAREST],
      [g.TEXTURE_MAG_FILTER, g.NEAREST],
      [g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE],
      [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE]
    ])
      g.texParameteri(g.TEXTURE_2D, k, v)
    g.uniform1i(g.getUniformLocation(prog, 'src'), 0)
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    return { canvas, gl: g, prog, tex }
  } catch (e) {
    console.warn('Soft proofing unavailable (WebGL2).', e)
    return null
  }
}

/**
 * Draws `src` (in the document's colour space) into `ctx` as it would look
 * in the proof space, optionally greying out colours outside sRGB.
 * Returns false when proofing isn't available.
 */
export function drawProofed(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, src: OffscreenCanvas, kind: ProofKind | null, warn: boolean, space: 'srgb' | 'display-p3'): boolean {
  if (proofGl === undefined) proofGl = initProof()
  if (!proofGl) return false
  const { gl: g, canvas, prog, tex } = proofGl
  const ext = g as WebGL2RenderingContext & { unpackColorSpace: PredefinedColorSpace; drawingBufferColorSpace: PredefinedColorSpace }
  ext.unpackColorSpace = space
  ext.drawingBufferColorSpace = space
  if (canvas.width !== src.width || canvas.height !== src.height) {
    canvas.width = src.width
    canvas.height = src.height
  }
  g.viewport(0, 0, src.width, src.height)
  g.bindTexture(g.TEXTURE_2D, tex)
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src)
  const mode = kind === null ? 0 : kind === 'srgb' ? 1 : kind === 'gray' ? 2 : 3
  g.uniform1i(g.getUniformLocation(prog, 'mode'), mode)
  g.uniform1i(g.getUniformLocation(prog, 'warn'), warn ? 1 : 0)
  g.uniform1i(g.getUniformLocation(prog, 'p3'), space === 'display-p3' ? 1 : 0)
  g.uniformMatrix3fv(g.getUniformLocation(prog, 'cb'), false, CB[kind as keyof typeof CB] ?? [1, 0, 0, 0, 1, 0, 0, 0, 1])
  g.clearColor(0, 0, 0, 0)
  g.clear(g.COLOR_BUFFER_BIT)
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
  ctx.drawImage(canvas, 0, 0)
  return true
}

export const PROOF_LABELS: Record<ProofKind, string> = {
  srgb: 'sRGB (web)',
  gray: 'Grayscale',
  protanopia: 'Colour blindness — protanopia',
  deuteranopia: 'Colour blindness — deuteranopia',
  tritanopia: 'Colour blindness — tritanopia'
}
