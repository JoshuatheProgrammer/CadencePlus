/**
 * GPU filters (WebGL2): Unsharp Mask, High Pass, Add Noise, Motion Blur and
 * the Dodge/Burn/Sponge kernels. Same conventions as the tone-curve shader
 * in ops.ts: sources arrive un-premultiplied, results are premultiplied, and
 * 16-bit documents run through half-float buffers in their colour space.
 */
import type { ShaderFilter, ShaderOp } from '@core/adjustments'
import { scaleShaderOp } from '@core/filters'
import { ctx2d, pipelineFormat } from './format'
import type { Ctx2D } from './tiles'

type Source = OffscreenCanvas | HTMLCanvasElement

const VS = `#version 300 es
in vec2 p;
out vec2 uv;
void main() {
  uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`

const HEAD = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform sampler2D aux;
uniform vec2 size;
in vec2 uv;
out vec4 o;
vec4 at(sampler2D t, vec2 xy) { return texture(t, xy); }
vec2 here() { return vec2(uv.x, 1.0 - uv.y); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec4 premul(vec3 c, float a) { return vec4(clamp(c, 0.0, 1.0) * a, a); }
`

const BODIES: Record<ShaderFilter, string> = {
  // aux = Gaussian-blurred source. Detail = src − blur, added `amount` times where it exceeds the threshold.
  unsharp: `uniform float amount; uniform float threshold;
void main() {
  vec4 c = at(src, here());
  vec4 b = at(aux, here());
  vec3 d = c.rgb - b.rgb;
  float m = max(max(abs(d.r), abs(d.g)), abs(d.b));
  o = premul(m < threshold ? c.rgb : c.rgb + amount * d, c.a);
}`,
  highPass: `void main() {
  vec4 c = at(src, here());
  vec4 b = at(aux, here());
  o = premul(vec3(0.5) + c.rgb - b.rgb, c.a);
}`,
  noise: `uniform float amount; uniform float gaussian; uniform float mono; uniform float seed;
float hash(vec2 p, float k) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973) + k * 0.6180339);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float n(vec2 p, float k) {
  float u1 = max(hash(p, k), 1e-6);
  float u2 = hash(p, k + 17.0);
  if (gaussian > 0.5) return sqrt(-2.0 * log(u1)) * cos(6.2831853 * u2) * 0.5;
  return u1 * 2.0 - 1.0;
}
void main() {
  vec4 c = at(src, here());
  vec2 p = floor(here() * size);
  vec3 v = mono > 0.5 ? vec3(n(p, seed)) : vec3(n(p, seed), n(p, seed + 101.0), n(p, seed + 211.0));
  o = premul(c.rgb + v * amount, c.a);
}`,
  // Averages premultiplied samples along a line through the pixel.
  motionBlur: `uniform float angle; uniform float dist;
void main() {
  float a = radians(angle);
  vec2 dir = vec2(cos(a), -sin(a));
  int taps = int(clamp(ceil(dist), 1.0, 160.0));
  vec4 sum = vec4(0.0);
  for (int i = 0; i <= 2 * 160; i++) {
    if (i > 2 * taps) break;
    float t = (float(i) / float(2 * taps) - 0.5) * dist;
    vec4 s = at(src, here() + dir * t / size);
    sum += vec4(s.rgb * s.a, s.a);
  }
  o = sum / float(2 * taps + 1);
}`,
  // Tonal-range weight from the pixel's luminance: shadows, midtones or highlights.
  dodge: `uniform float range; uniform float exposure;
float w(float l) { return range < 0.5 ? (1.0 - l) * (1.0 - l) : range < 1.5 ? 1.0 - (2.0 * l - 1.0) * (2.0 * l - 1.0) : l * l; }
void main() {
  vec4 c = at(src, here());
  float k = exposure * w(luma(c.rgb));
  o = premul(c.rgb + k * (1.0 - c.rgb), c.a);
}`,
  burn: `uniform float range; uniform float exposure;
float w(float l) { return range < 0.5 ? (1.0 - l) * (1.0 - l) : range < 1.5 ? 1.0 - (2.0 * l - 1.0) * (2.0 * l - 1.0) : l * l; }
void main() {
  vec4 c = at(src, here());
  float k = exposure * w(luma(c.rgb));
  o = premul(c.rgb - k * c.rgb, c.a);
}`,
  // White with alpha = smoothstep(lo, hi, source alpha): grows shapes from a blurred alpha (layer-style strokes).
  alphaThreshold: `uniform float lo; uniform float hi;
void main() {
  float a = smoothstep(lo, hi, at(src, here()).a);
  o = vec4(a, a, a, a);
}`,
  sponge: `uniform float amount;
void main() {
  vec4 c = at(src, here());
  float l = luma(c.rgb);
  o = premul(mix(vec3(l), c.rgb, 1.0 + amount), c.a);
}`
}

/** Filters whose shader reads a blurred copy of the source (`aux`). */
const NEEDS_BLUR: Partial<Record<ShaderFilter, true>> = { unsharp: true, highPass: true }

interface Gpu {
  canvas: OffscreenCanvas
  gl: WebGL2RenderingContext
  progs: Map<ShaderFilter, WebGLProgram>
  src: WebGLTexture
  aux: WebGLTexture
  sh(type: number, code: string): WebGLShader
}

let gpu: Gpu | null | undefined

function init(): Gpu | null {
  try {
    const canvas = new OffscreenCanvas(1, 1)
    const g = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true })
    if (!g) return null
    g.getExtension('EXT_color_buffer_float')
    g.getExtension('EXT_color_buffer_half_float')
    const sh = (type: number, code: string) => {
      const s = g.createShader(type)!
      g.shaderSource(s, code)
      g.compileShader(s)
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) ?? 'shader')
      return s
    }
    const buf = g.createBuffer()
    g.bindBuffer(g.ARRAY_BUFFER, buf)
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW)
    const tex = (unit: number) => {
      const t = g.createTexture()!
      g.activeTexture(g.TEXTURE0 + unit)
      g.bindTexture(g.TEXTURE_2D, t)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
      return t
    }
    const src = tex(0)
    const aux = tex(1)
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL, g.NONE)
    return { canvas, gl: g, progs: new Map(), src, aux, sh }
  } catch (e) {
    console.warn('GPU filters unavailable (WebGL2).', e)
    return null
  }
}

function program(G: Gpu, f: ShaderFilter): WebGLProgram {
  let p = G.progs.get(f)
  if (p) return p
  const g = G.gl
  p = g.createProgram()!
  g.attachShader(p, G.sh(g.VERTEX_SHADER, VS))
  g.attachShader(p, G.sh(g.FRAGMENT_SHADER, HEAD + BODIES[f]))
  g.linkProgram(p)
  if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p) ?? 'link')
  G.progs.set(f, p)
  return p
}

/** True when GPU filters can run. */
export function gpuFiltersAvailable(): boolean {
  if (gpu === undefined) gpu = init()
  return !!gpu
}

/** Gaussian blur of `src` in the pipeline format (aux input for Unsharp Mask / High Pass). */
function blurred(src: Source, radius: number): OffscreenCanvas {
  const c = new OffscreenCanvas(src.width, src.height)
  const g = ctx2d(c)
  g.filter = `blur(${Math.max(0.1, radius)}px)`
  g.drawImage(src, 0, 0)
  return c
}

/**
 * Draws `src` through a GPU filter into `ctx` at the origin. `scale` adapts
 * lengths (radius, distance) when previewing at a zoom level. Without WebGL2
 * the source is drawn unchanged.
 */
export function drawShaderOp(ctx: Ctx2D, src: Source, op0: ShaderOp, scale = 1): void {
  const op = scaleShaderOp(op0, scale)
  const w = src.width
  const h = src.height
  if (gpu === undefined) gpu = init()
  if (!gpu || w === 0 || h === 0) {
    ctx.drawImage(src, 0, 0)
    return
  }
  const G = gpu
  const g = G.gl
  const prog = program(G, op.shader)
  g.useProgram(prog)
  const loc = g.getAttribLocation(prog, 'p')
  g.enableVertexAttribArray(loc)
  g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0)
  const f = pipelineFormat()
  const ext = g as WebGL2RenderingContext & { unpackColorSpace: PredefinedColorSpace; drawingBufferColorSpace: PredefinedColorSpace; drawingBufferStorage?: (fmt: number, w: number, h: number) => void }
  ext.unpackColorSpace = f.space
  ext.drawingBufferColorSpace = f.space
  if (G.canvas.width !== w || G.canvas.height !== h) {
    G.canvas.width = w
    G.canvas.height = h
  }
  const float = f.depth === 16 && typeof ext.drawingBufferStorage === 'function'
  if (float) ext.drawingBufferStorage!(g.RGBA16F, w, h)
  else if (typeof ext.drawingBufferStorage === 'function') ext.drawingBufferStorage(g.RGBA8, w, h)
  g.viewport(0, 0, w, h)
  const upload = (unit: number, t: WebGLTexture, img: Source, linear: boolean) => {
    g.activeTexture(g.TEXTURE0 + unit)
    g.bindTexture(g.TEXTURE_2D, t)
    const filt = linear ? g.LINEAR : g.NEAREST
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, filt)
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, filt)
    if (float) g.texImage2D(g.TEXTURE_2D, 0, g.RGBA16F, g.RGBA, g.HALF_FLOAT, img)
    else g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img)
  }
  upload(0, G.src, src, op.shader === 'motionBlur')
  if (NEEDS_BLUR[op.shader]) upload(1, G.aux, blurred(src, op.params.radius ?? 1), false)
  g.uniform1i(g.getUniformLocation(prog, 'src'), 0)
  g.uniform1i(g.getUniformLocation(prog, 'aux'), 1)
  g.uniform2f(g.getUniformLocation(prog, 'size'), w, h)
  for (const [k, v] of Object.entries(op.params)) {
    const u = g.getUniformLocation(prog, k)
    if (u) g.uniform1f(u, v)
  }
  g.clearColor(0, 0, 0, 0)
  g.clear(g.COLOR_BUFFER_BIT)
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
  ctx.drawImage(G.canvas, 0, 0)
}
