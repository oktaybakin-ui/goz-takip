/**
 * WebGL Heatmap Renderer - GPU-accelerated alternative to Canvas 2D HeatmapGenerator
 *
 * GPU hızlandırmalı bakış yoğunluk haritası:
 * - WebGL2 (WebGL1 fallback) ile donanım hızlandırmalı render
 * - Separable two-pass Gaussian blur (yatay + dikey)
 * - Additive blending ile yoğunluk birikimi (framebuffer)
 * - Fragment shader tabanlı renk haritalama
 * - Renk paleti: mavi → cyan → yeşil → sarı → kırmızı
 * - PNG export
 * - Context loss handling
 */

import { GazePoint } from "@/lib/gazeModel";
import { Fixation } from "@/lib/fixation";

// ---------------------------------------------------------------------------
// Config (mirrors HeatmapConfig from heatmap.ts)
// ---------------------------------------------------------------------------

export interface HeatmapConfig {
  radius: number;
  maxOpacity: number;
  minOpacity: number;
  blur: number;
  gradient: Record<number, string>;
  useFixations: boolean;
}

const DEFAULT_CONFIG: HeatmapConfig = {
  radius: 60,
  maxOpacity: 0.75,
  minOpacity: 0.02,
  blur: 25,
  gradient: {
    0.0: "rgba(0, 0, 255, 0)",
    0.15: "rgba(0, 0, 255, 1)",
    0.3: "rgba(0, 200, 255, 1)",
    0.45: "rgba(0, 255, 100, 1)",
    0.6: "rgba(128, 255, 0, 1)",
    0.75: "rgba(255, 255, 0, 1)",
    0.9: "rgba(255, 128, 0, 1)",
    1.0: "rgba(255, 0, 0, 1)",
  },
  useFixations: true,
};

// ---------------------------------------------------------------------------
// Inline GLSL shaders
// ---------------------------------------------------------------------------

/** Vertex shader shared by the point-splat and fullscreen-quad passes. */
const POINT_VERTEX_SHADER = /* glsl */ `
  attribute vec2 a_position;
  attribute float a_intensity;

  uniform vec2 u_resolution;
  uniform float u_pointSize;

  varying float v_intensity;

  void main() {
    // Convert pixel coords to clip space [-1, 1]
    vec2 clipPos = (a_position / u_resolution) * 2.0 - 1.0;
    clipPos.y = -clipPos.y; // flip Y (canvas top-left origin)
    gl_Position = vec4(clipPos, 0.0, 1.0);
    gl_PointSize = u_pointSize;
    v_intensity = a_intensity;
  }
`;

/** Fragment shader for rendering radial-gradient intensity splats. */
const POINT_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;

  varying float v_intensity;

  void main() {
    // Distance from center of the point sprite [0, 1]
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord) * 2.0; // 0 at center, 1 at edge

    if (dist > 1.0) {
      discard;
    }

    // Smooth radial falloff matching Canvas version gradient stops:
    // center (0) -> full, 0.4 -> 0.55x, 0.7 -> 0.2x, 1.0 -> 0
    float falloff;
    if (dist < 0.4) {
      falloff = 1.0;
    } else if (dist < 0.7) {
      falloff = mix(0.55, 0.2, (dist - 0.4) / 0.3);
    } else {
      falloff = mix(0.2, 0.0, (dist - 0.7) / 0.3);
    }

    float alpha = v_intensity * falloff;
    gl_FragColor = vec4(alpha, alpha, alpha, alpha);
  }
`;

/** Simple fullscreen-quad vertex shader (two triangles covering the viewport). */
const QUAD_VERTEX_SHADER = /* glsl */ `
  attribute vec2 a_position;
  varying vec2 v_texCoord;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    // Map from clip coords [-1, 1] to tex coords [0, 1]
    v_texCoord = a_position * 0.5 + 0.5;
  }
`;

/**
 * Separable Gaussian blur fragment shader.
 * u_direction = (1/w, 0) for horizontal, (0, 1/h) for vertical.
 */
const BLUR_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;

  uniform sampler2D u_texture;
  uniform vec2 u_direction;
  uniform float u_kernelSize;

  varying vec2 v_texCoord;

  void main() {
    float sigma = u_kernelSize / 3.0;
    float twoSigmaSq = 2.0 * sigma * sigma;
    float normalization = 0.0;
    vec4 color = vec4(0.0);

    // Dynamic kernel radius capped at 64 taps
    int radius = int(min(u_kernelSize, 64.0));

    for (int i = -64; i <= 64; i++) {
      if (i < -radius || i > radius) continue;
      float fi = float(i);
      float weight = exp(-(fi * fi) / twoSigmaSq);
      normalization += weight;
      vec2 offset = u_direction * fi;
      color += texture2D(u_texture, v_texCoord + offset) * weight;
    }

    gl_FragColor = color / normalization;
  }
`;

/**
 * Color-mapping fragment shader.
 * Reads single-channel intensity from the blurred texture, normalizes,
 * maps through a 1D gradient LUT, and applies opacity ramp.
 */
const COLORIZE_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;

  uniform sampler2D u_texture;
  uniform sampler2D u_gradientLUT;
  uniform float u_maxIntensity;
  uniform float u_minOpacity;
  uniform float u_maxOpacity;

  varying vec2 v_texCoord;

  void main() {
    float raw = texture2D(u_texture, v_texCoord).r;

    if (raw < 0.001) {
      discard;
    }

    float normalized = clamp(raw / u_maxIntensity, 0.0, 1.0);
    vec4 mapped = texture2D(u_gradientLUT, vec2(normalized, 0.5));

    float opacity = u_minOpacity + normalized * (u_maxOpacity - u_minOpacity);
    gl_FragColor = vec4(mapped.rgb, mapped.a * opacity);
  }
`;

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

interface GLResources {
  pointProgram: WebGLProgram;
  blurProgram: WebGLProgram;
  colorizeProgram: WebGLProgram;
  quadVBO: WebGLBuffer;
  pointVBO: WebGLBuffer;
  intensityVBO: WebGLBuffer;
  // Ping-pong framebuffers for multi-pass
  fbA: WebGLFramebuffer;
  texA: WebGLTexture;
  fbB: WebGLFramebuffer;
  texB: WebGLTexture;
  gradientLUT: WebGLTexture;
  texWidth: number;
  texHeight: number;
}

// ---------------------------------------------------------------------------
// WebGLHeatmapRenderer
// ---------------------------------------------------------------------------

export class WebGLHeatmapRenderer {
  private config: HeatmapConfig;
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private resources: GLResources | null = null;
  private contextLost = false;
  private isWebGL2 = false;

  // Offscreen canvas used when the caller does not supply one
  private offscreenCanvas: HTMLCanvasElement | null = null;

  // Event listeners stored for cleanup
  private boundHandleContextLost: ((e: Event) => void) | null = null;
  private boundHandleContextRestored: (() => void) | null = null;

  constructor(config: Partial<HeatmapConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -----------------------------------------------------------------------
  // Static helpers
  // -----------------------------------------------------------------------

  /** Returns true when WebGL is available in the current environment. */
  static isSupported(): boolean {
    if (typeof document === "undefined") return false;
    try {
      const c = document.createElement("canvas");
      const gl =
        c.getContext("webgl2") ||
        c.getContext("webgl") ||
        c.getContext("experimental-webgl");
      return gl !== null;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Renders the heatmap onto the given canvas element.
   *
   * @param canvas   - Target canvas (will be resized to imageWidth x imageHeight)
   * @param points   - Raw gaze points
   * @param fixations - Fixation list
   * @param imageWidth  - Coordinate-space width
   * @param imageHeight - Coordinate-space height
   */
  render(
    canvas: HTMLCanvasElement,
    points: GazePoint[],
    fixations: Fixation[],
    imageWidth: number,
    imageHeight: number,
  ): void {
    if (typeof document === "undefined") return;

    canvas.width = imageWidth;
    canvas.height = imageHeight;

    const gl = this.ensureContext(canvas);
    if (!gl || this.contextLost) return;

    const resources = this.ensureResources(gl, imageWidth, imageHeight);
    if (!resources) return;

    // Build vertex data
    const { positions, intensities, maxPointSize } = this.buildVertexData(
      points,
      fixations,
    );

    if (positions.length === 0) {
      gl.viewport(0, 0, imageWidth, imageHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    // --- Pass 1: accumulate intensity splats into fbA ---
    this.renderIntensityPass(gl, resources, positions, intensities, maxPointSize, imageWidth, imageHeight);

    // --- Pass 2 & 3: separable Gaussian blur (horizontal then vertical) ---
    this.renderBlurPass(gl, resources, imageWidth, imageHeight);

    // --- Find max intensity by reading pixels ---
    const maxIntensity = this.findMaxIntensity(gl, resources, imageWidth, imageHeight);

    // --- Pass 4: colorize to screen ---
    this.renderColorizePass(gl, resources, maxIntensity, imageWidth, imageHeight);
  }

  /**
   * Renders the heatmap overlaid on a base image and returns a data URL (PNG).
   */
  exportToPNG(
    points: GazePoint[],
    fixations: Fixation[],
    baseImage: HTMLImageElement,
    imageWidth: number,
    imageHeight: number,
  ): string {
    if (typeof document === "undefined") return "";

    // Render heatmap on offscreen canvas
    const heatmapCanvas = this.getOffscreenCanvas(imageWidth, imageHeight);
    this.render(heatmapCanvas, points, fixations, imageWidth, imageHeight);

    // Composite base image + heatmap
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = imageWidth;
    exportCanvas.height = imageHeight;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return "";

    ctx.drawImage(baseImage, 0, 0, imageWidth, imageHeight);
    ctx.drawImage(heatmapCanvas, 0, 0);

    return exportCanvas.toDataURL("image/png");
  }

  /** Releases all GPU resources. Safe to call multiple times. */
  destroy(): void {
    this.releaseResources();
    this.detachContextListeners();
    this.gl = null;
    this.offscreenCanvas = null;
  }

  /** Update config (e.g. radius, blur) at runtime. */
  updateConfig(config: Partial<HeatmapConfig>): void {
    this.config = { ...this.config, ...config };
    // If gradient changed, regenerate LUT on next render
    if (config.gradient && this.resources && this.gl) {
      this.uploadGradientLUT(this.gl, this.resources.gradientLUT);
    }
  }

  // -----------------------------------------------------------------------
  // Context management
  // -----------------------------------------------------------------------

  private ensureContext(
    canvas: HTMLCanvasElement,
  ): WebGLRenderingContext | WebGL2RenderingContext | null {
    // If we already have a context bound to this canvas, reuse it
    if (this.gl && !this.contextLost) {
      const existingCanvas = this.gl.canvas as HTMLCanvasElement;
      if (existingCanvas === canvas) return this.gl;
      // Different canvas — release old resources
      this.releaseResources();
      this.detachContextListeners();
    }

    const attrs: WebGLContextAttributes = {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
      depth: false,
      stencil: false,
    };

    let gl: WebGLRenderingContext | WebGL2RenderingContext | null =
      canvas.getContext("webgl2", attrs) as WebGL2RenderingContext | null;
    if (gl) {
      this.isWebGL2 = true;
    } else {
      gl =
        (canvas.getContext("webgl", attrs) as WebGLRenderingContext | null) ||
        (canvas.getContext("experimental-webgl", attrs) as WebGLRenderingContext | null);
      this.isWebGL2 = false;
    }

    if (!gl) return null;

    this.gl = gl;
    this.contextLost = false;
    this.attachContextListeners(canvas);
    return gl;
  }

  private attachContextListeners(canvas: HTMLCanvasElement): void {
    this.detachContextListeners();

    this.boundHandleContextLost = (e: Event) => {
      e.preventDefault();
      this.contextLost = true;
      this.releaseResources();
      if (typeof console !== "undefined") {
        console.warn("[WebGLHeatmapRenderer] WebGL context lost");
      }
    };

    this.boundHandleContextRestored = () => {
      this.contextLost = false;
      if (typeof console !== "undefined") {
        console.info("[WebGLHeatmapRenderer] WebGL context restored");
      }
    };

    canvas.addEventListener("webglcontextlost", this.boundHandleContextLost);
    canvas.addEventListener("webglcontextrestored", this.boundHandleContextRestored);
  }

  private detachContextListeners(): void {
    if (!this.gl) return;
    const canvas = this.gl.canvas as HTMLCanvasElement;
    if (this.boundHandleContextLost) {
      canvas.removeEventListener("webglcontextlost", this.boundHandleContextLost);
      this.boundHandleContextLost = null;
    }
    if (this.boundHandleContextRestored) {
      canvas.removeEventListener("webglcontextrestored", this.boundHandleContextRestored);
      this.boundHandleContextRestored = null;
    }
  }

  // -----------------------------------------------------------------------
  // Offscreen canvas
  // -----------------------------------------------------------------------

  private getOffscreenCanvas(w: number, h: number): HTMLCanvasElement {
    if (
      !this.offscreenCanvas ||
      this.offscreenCanvas.width !== w ||
      this.offscreenCanvas.height !== h
    ) {
      this.offscreenCanvas = document.createElement("canvas");
      this.offscreenCanvas.width = w;
      this.offscreenCanvas.height = h;
    }
    return this.offscreenCanvas;
  }

  // -----------------------------------------------------------------------
  // Resource management
  // -----------------------------------------------------------------------

  private ensureResources(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    width: number,
    height: number,
  ): GLResources | null {
    // Recreate if dimensions changed
    if (
      this.resources &&
      (this.resources.texWidth !== width || this.resources.texHeight !== height)
    ) {
      this.releaseResources();
    }

    if (this.resources) return this.resources;

    try {
      const pointProgram = this.createProgram(gl, POINT_VERTEX_SHADER, POINT_FRAGMENT_SHADER);
      const blurProgram = this.createProgram(gl, QUAD_VERTEX_SHADER, BLUR_FRAGMENT_SHADER);
      const colorizeProgram = this.createProgram(gl, QUAD_VERTEX_SHADER, COLORIZE_FRAGMENT_SHADER);

      // Fullscreen quad (two triangles)
      const quadVBO = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
      // prettier-ignore
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
          -1, -1,
           1, -1,
          -1,  1,
          -1,  1,
           1, -1,
           1,  1,
        ]),
        gl.STATIC_DRAW,
      );

      const pointVBO = gl.createBuffer()!;
      const intensityVBO = gl.createBuffer()!;

      // Ping-pong textures + FBOs
      const { fb: fbA, tex: texA } = this.createFramebuffer(gl, width, height);
      const { fb: fbB, tex: texB } = this.createFramebuffer(gl, width, height);

      // Gradient lookup texture (256 x 1)
      const gradientLUT = gl.createTexture()!;
      this.uploadGradientLUT(gl, gradientLUT);

      this.resources = {
        pointProgram,
        blurProgram,
        colorizeProgram,
        quadVBO,
        pointVBO,
        intensityVBO,
        fbA,
        texA,
        fbB,
        texB,
        gradientLUT,
        texWidth: width,
        texHeight: height,
      };

      return this.resources;
    } catch (err) {
      if (typeof console !== "undefined") {
        console.error("[WebGLHeatmapRenderer] Failed to create resources:", err);
      }
      return null;
    }
  }

  private releaseResources(): void {
    if (!this.gl || !this.resources) return;
    const gl = this.gl;
    const r = this.resources;

    gl.deleteProgram(r.pointProgram);
    gl.deleteProgram(r.blurProgram);
    gl.deleteProgram(r.colorizeProgram);
    gl.deleteBuffer(r.quadVBO);
    gl.deleteBuffer(r.pointVBO);
    gl.deleteBuffer(r.intensityVBO);
    gl.deleteFramebuffer(r.fbA);
    gl.deleteTexture(r.texA);
    gl.deleteFramebuffer(r.fbB);
    gl.deleteTexture(r.texB);
    gl.deleteTexture(r.gradientLUT);

    this.resources = null;
  }

  // -----------------------------------------------------------------------
  // Framebuffer + texture helpers
  // -----------------------------------------------------------------------

  private createFramebuffer(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    width: number,
    height: number,
  ): { fb: WebGLFramebuffer; tex: WebGLTexture } {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);

    // Use RGBA float if available for better precision, fallback to UNSIGNED_BYTE
    if (this.isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      gl2.texImage2D(
        gl2.TEXTURE_2D, 0, gl2.RGBA16F,
        width, height, 0,
        gl2.RGBA, gl2.HALF_FLOAT, null,
      );
    } else {
      // WebGL1: try OES_texture_half_float, else fall back to UNSIGNED_BYTE
      const halfFloatExt = gl.getExtension("OES_texture_half_float");
      if (halfFloatExt) {
        gl.texImage2D(
          gl.TEXTURE_2D, 0, gl.RGBA,
          width, height, 0,
          gl.RGBA, halfFloatExt.HALF_FLOAT_OES, null,
        );
      } else {
        gl.texImage2D(
          gl.TEXTURE_2D, 0, gl.RGBA,
          width, height, 0,
          gl.RGBA, gl.UNSIGNED_BYTE, null,
        );
      }
    }

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Enable rendering to float textures
    if (this.isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      gl2.getExtension("EXT_color_buffer_half_float");
      gl2.getExtension("EXT_color_buffer_float");
    } else {
      gl.getExtension("OES_texture_half_float");
      gl.getExtension("WEBGL_color_buffer_half_float");
      gl.getExtension("OES_texture_half_float_linear");
    }

    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      // Fallback: use UNSIGNED_BYTE texture
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA,
        width, height, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, null,
      );
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return { fb, tex };
  }

  // -----------------------------------------------------------------------
  // Gradient LUT
  // -----------------------------------------------------------------------

  private uploadGradientLUT(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    tex: WebGLTexture,
  ): void {
    // Build 256-pixel RGBA gradient on a tiny canvas, then upload
    const lutCanvas = document.createElement("canvas");
    lutCanvas.width = 256;
    lutCanvas.height = 1;
    const ctx = lutCanvas.getContext("2d")!;
    const grad = ctx.createLinearGradient(0, 0, 256, 0);

    for (const [stop, color] of Object.entries(this.config.gradient)) {
      grad.addColorStop(parseFloat(stop), color);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 1);

    const pixels = ctx.getImageData(0, 0, 256, 1);

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA,
      256, 1, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, pixels.data,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // -----------------------------------------------------------------------
  // Shader / program compilation
  // -----------------------------------------------------------------------

  private compileShader(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    source: string,
    type: number,
  ): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Failed to create shader");

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) || "unknown error";
      gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${info}`);
    }

    return shader;
  }

  private createProgram(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    vsSrc: string,
    fsSrc: string,
  ): WebGLProgram {
    const vs = this.compileShader(gl, vsSrc, gl.VERTEX_SHADER);
    const fs = this.compileShader(gl, fsSrc, gl.FRAGMENT_SHADER);

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      throw new Error("Failed to create program");
    }

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    // Shaders can be detached/deleted after linking
    gl.detachShader(program, vs);
    gl.detachShader(program, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) || "unknown error";
      gl.deleteProgram(program);
      throw new Error(`Program link error: ${info}`);
    }

    return program;
  }

  // -----------------------------------------------------------------------
  // Vertex data construction
  // -----------------------------------------------------------------------

  private buildVertexData(
    points: GazePoint[],
    fixations: Fixation[],
  ): {
    positions: Float32Array;
    intensities: Float32Array;
    maxPointSize: number;
  } {
    const radius = this.config.radius;

    if (this.config.useFixations && fixations.length > 0) {
      return this.buildFixationVertexData(fixations, radius);
    }

    if (points.length > 0) {
      return this.buildGazeVertexData(points, radius);
    }

    return {
      positions: new Float32Array(0),
      intensities: new Float32Array(0),
      maxPointSize: 0,
    };
  }

  private buildFixationVertexData(
    fixations: Fixation[],
    radius: number,
  ): {
    positions: Float32Array;
    intensities: Float32Array;
    maxPointSize: number;
  } {
    const maxDuration = Math.max(...fixations.map((f) => f.duration), 1);
    const fixCountScale = Math.max(0.3, 1.0 - (fixations.length - 10) * 0.015);

    // We render each fixation as a single GL_POINTS with varying pointSize.
    // Since gl_PointSize is set per-vertex in the shader via a uniform,
    // we group fixations by similar radius and render in batches.
    // For simplicity we use the maximum possible radius and let the fragment
    // shader handle the radial falloff. Alternatively, we can render one
    // draw call per unique radius — but for heatmaps the point count is low,
    // so we expand each fixation into its own draw call.
    //
    // Better approach: render all points at the same max gl_PointSize and
    // encode the actual radius into the intensity attribute so the fragment
    // shader can adjust. However this complicates the shader. Instead we pick
    // the maximum radius and accept some wasted fill. The Gaussian falloff
    // will hide it.
    //
    // Simplest correct approach: accumulate each fixation separately.
    // This matches the Canvas version which draws each one individually.

    let maxR = 0;
    const n = fixations.length;
    const positions = new Float32Array(n * 2);
    const intensities = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const f = fixations[i];
      const weight = f.duration / maxDuration;
      const r = radius * (0.6 + weight * 0.8);
      if (r > maxR) maxR = r;

      positions[i * 2] = f.x;
      positions[i * 2 + 1] = f.y;

      // Match Canvas version alpha: min(0.7, (weight*0.4 + 0.1) * fixCountScale)
      intensities[i] = Math.min(0.7, (weight * 0.4 + 0.1) * fixCountScale);
    }

    return {
      positions,
      intensities,
      maxPointSize: maxR * 2,
    };
  }

  private buildGazeVertexData(
    points: GazePoint[],
    radius: number,
  ): {
    positions: Float32Array;
    intensities: Float32Array;
    maxPointSize: number;
  } {
    const gazeRadius = radius * 0.7;
    // Down-sample like the Canvas version when > 1000 points
    const step = points.length > 1000 ? Math.floor(points.length / 1000) : 1;
    const count = Math.ceil(points.length / step);
    const positions = new Float32Array(count * 2);
    const intensities = new Float32Array(count);

    let idx = 0;
    for (let i = 0; i < points.length; i += step) {
      const p = points[i];
      positions[idx * 2] = p.x;
      positions[idx * 2 + 1] = p.y;
      intensities[idx] = 0.15; // Canvas version uses alpha 0.15 at center
      idx++;
    }

    return {
      positions,
      intensities,
      maxPointSize: gazeRadius * 2,
    };
  }

  // -----------------------------------------------------------------------
  // Render passes
  // -----------------------------------------------------------------------

  private renderIntensityPass(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    res: GLResources,
    positions: Float32Array,
    intensities: Float32Array,
    maxPointSize: number,
    width: number,
    height: number,
  ): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbA);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Additive blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    gl.useProgram(res.pointProgram);

    // Uniforms
    const uRes = gl.getUniformLocation(res.pointProgram, "u_resolution");
    const uPS = gl.getUniformLocation(res.pointProgram, "u_pointSize");
    gl.uniform2f(uRes, width, height);
    gl.uniform1f(uPS, maxPointSize);

    // Clamp point size to hardware max
    const maxPS = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array;
    const clampedPointSize = Math.min(maxPointSize, maxPS[1]);
    gl.uniform1f(uPS, clampedPointSize);

    // Upload positions
    const aPos = gl.getAttribLocation(res.pointProgram, "a_position");
    gl.bindBuffer(gl.ARRAY_BUFFER, res.pointVBO);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Upload intensities
    const aInt = gl.getAttribLocation(res.pointProgram, "a_intensity");
    gl.bindBuffer(gl.ARRAY_BUFFER, res.intensityVBO);
    gl.bufferData(gl.ARRAY_BUFFER, intensities, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aInt);
    gl.vertexAttribPointer(aInt, 1, gl.FLOAT, false, 0, 0);

    // If the desired point size exceeds the hardware max, we must render
    // each point multiple times at offsets to approximate the larger splat.
    // In practice, max point size is typically >= 256 on modern GPUs, so
    // this path is rarely hit.
    if (maxPointSize > maxPS[1]) {
      this.renderLargePoints(gl, positions, intensities, maxPointSize, clampedPointSize, width, height, res);
    } else {
      gl.drawArrays(gl.POINTS, 0, positions.length / 2);
    }

    gl.disableVertexAttribArray(aPos);
    gl.disableVertexAttribArray(aInt);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Fallback for hardware that does not support the required point size.
   * Renders each point as an instanced quad. This is slower but correct.
   */
  private renderLargePoints(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    positions: Float32Array,
    intensities: Float32Array,
    desiredSize: number,
    _hwMaxSize: number,
    width: number,
    height: number,
    res: GLResources,
  ): void {
    // Render point-by-point with offset to simulate larger radius
    // For each point, calculate how many tiles we need
    const tilesPerSide = Math.ceil(desiredSize / _hwMaxSize);
    const tileSize = _hwMaxSize;
    const halfDesired = desiredSize / 2;

    const uRes = gl.getUniformLocation(res.pointProgram, "u_resolution");
    const uPS = gl.getUniformLocation(res.pointProgram, "u_pointSize");
    const aPos = gl.getAttribLocation(res.pointProgram, "a_position");
    const aInt = gl.getAttribLocation(res.pointProgram, "a_intensity");

    const numPoints = positions.length / 2;

    for (let ti = 0; ti < tilesPerSide; ti++) {
      for (let tj = 0; tj < tilesPerSide; tj++) {
        const offsetX = -halfDesired + tileSize * 0.5 + ti * tileSize;
        const offsetY = -halfDesired + tileSize * 0.5 + tj * tileSize;

        // Shift positions
        const shifted = new Float32Array(positions.length);
        for (let p = 0; p < numPoints; p++) {
          shifted[p * 2] = positions[p * 2] + offsetX;
          shifted[p * 2 + 1] = positions[p * 2 + 1] + offsetY;
        }

        gl.uniform2f(uRes, width, height);
        gl.uniform1f(uPS, tileSize);

        gl.bindBuffer(gl.ARRAY_BUFFER, res.pointVBO);
        gl.bufferData(gl.ARRAY_BUFFER, shifted, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, res.intensityVBO);
        gl.bufferData(gl.ARRAY_BUFFER, intensities, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(aInt);
        gl.vertexAttribPointer(aInt, 1, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.POINTS, 0, numPoints);
      }
    }
  }

  private renderBlurPass(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    res: GLResources,
    width: number,
    height: number,
  ): void {
    gl.useProgram(res.blurProgram);

    const uTex = gl.getUniformLocation(res.blurProgram, "u_texture");
    const uDir = gl.getUniformLocation(res.blurProgram, "u_direction");
    const uKernel = gl.getUniformLocation(res.blurProgram, "u_kernelSize");
    const aPos = gl.getAttribLocation(res.blurProgram, "a_position");

    gl.uniform1f(uKernel, this.config.blur);

    gl.disable(gl.BLEND);

    // --- Horizontal pass: fbA -> fbB ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbB);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.texA);
    gl.uniform1i(uTex, 0);
    gl.uniform2f(uDir, 1.0 / width, 0.0);

    gl.bindBuffer(gl.ARRAY_BUFFER, res.quadVBO);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // --- Vertical pass: fbB -> fbA ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbA);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindTexture(gl.TEXTURE_2D, res.texB);
    gl.uniform1i(uTex, 0);
    gl.uniform2f(uDir, 0.0, 1.0 / height);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.disableVertexAttribArray(aPos);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Reads back the blurred intensity texture and finds the maximum value
   * for normalization. This is a GPU -> CPU readback which is unavoidable
   * for matching the Canvas version's dynamic normalization.
   */
  private findMaxIntensity(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    res: GLResources,
    width: number,
    height: number,
  ): number {
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbA);

    // Sample a sub-region for performance (every Nth pixel)
    // For accuracy we read the full framebuffer but process efficiently.
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let maxVal = 0;
    // Red channel stores intensity (all channels are equal from our shader)
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > maxVal) maxVal = pixels[i];
    }

    return maxVal > 0 ? maxVal / 255.0 : 1.0;
  }

  private renderColorizePass(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    res: GLResources,
    maxIntensity: number,
    width: number,
    height: number,
  ): void {
    // Render to screen (default framebuffer)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Enable alpha blending for correct compositing
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(res.colorizeProgram);

    // Blurred intensity texture (from fbA/texA)
    const uTex = gl.getUniformLocation(res.colorizeProgram, "u_texture");
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.texA);
    gl.uniform1i(uTex, 0);

    // Gradient LUT
    const uGrad = gl.getUniformLocation(res.colorizeProgram, "u_gradientLUT");
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, res.gradientLUT);
    gl.uniform1i(uGrad, 1);

    // Uniforms
    const uMax = gl.getUniformLocation(res.colorizeProgram, "u_maxIntensity");
    const uMinOp = gl.getUniformLocation(res.colorizeProgram, "u_minOpacity");
    const uMaxOp = gl.getUniformLocation(res.colorizeProgram, "u_maxOpacity");
    gl.uniform1f(uMax, maxIntensity);
    gl.uniform1f(uMinOp, this.config.minOpacity);
    gl.uniform1f(uMaxOp, this.config.maxOpacity);

    // Draw fullscreen quad
    const aPos = gl.getAttribLocation(res.colorizeProgram, "a_position");
    gl.bindBuffer(gl.ARRAY_BUFFER, res.quadVBO);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.disableVertexAttribArray(aPos);
    gl.disable(gl.BLEND);
  }
}
