/**
 * Pixel operations: Canvas filter strings run by the 2D canvas, and tone
 * lookup tables (Levels, Curves) run by a tiny WebGL2 shader, with a CPU
 * fallback when WebGL2 is unavailable. Both work on whole canvases so tiles
 * never show seams.
 */
import { scaleFilter, type PixelOp } from '@core/adjustments'
import { applyLutToPixels } from '@core/lut'
import { pipelineFormat } from './format'
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

/** Draws `src` through a pixel op (filter or LUT) into `ctx`; `scale` adapts blur radii to the target. */
export function drawWithOp(ctx: Ctx2D, src: Source, op: PixelOp, scale = 1): void {
  if (typeof op === 'string') {
    ctx.save()
    ctx.filter = scaleFilter(op, scale)
    ctx.drawImage(src, 0, 0)
    ctx.restore()
  } else drawThroughLut(ctx, src, op)
}
