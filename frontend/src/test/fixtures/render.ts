import type { Map as MapLibreMap } from 'maplibre-gl'
import { vi } from 'vitest'

import {
  DEFAULT_RASTER_RENDER_SETTINGS,
  DEFAULT_PARTICLE_RENDER_SETTINGS,
  type ForecastRenderSettings,
} from '@/forecast/settings'

const FORECAST_LAYER_BEFORE_ID_FIXTURE = 'coastline'
const GL_ACTIVE_UNIFORMS = 35718
const GL_ACTIVE_ATTRIBUTES = 35721
const GL_FLOAT = 5126
const GL_INT = 5124
const GL_FLOAT_VEC2 = 35664
const GL_FLOAT_VEC3 = 35665
const GL_FLOAT_MAT4 = 35676
const GL_SAMPLER_2D = 35678
const GL_INT_SAMPLER_2D_ARRAY = 36303

const MOCK_ACTIVE_UNIFORMS = [
  { name: 'u_encoded_tex', type: GL_INT_SAMPLER_2D_ARRAY },
  { name: 'u_encoded_tex_lower', type: GL_INT_SAMPLER_2D_ARRAY },
  { name: 'u_encoded_tex_upper', type: GL_INT_SAMPLER_2D_ARRAY },
  { name: 'u_colormap_tex', type: GL_SAMPLER_2D },
  { name: 'u_pressure_tex_lower', type: GL_SAMPLER_2D },
  { name: 'u_pressure_tex_upper', type: GL_SAMPLER_2D },
  { name: 'u_grid_size', type: GL_FLOAT_VEC2 },
  { name: 'u_display_range', type: GL_FLOAT_VEC2 },
  { name: 'u_time_mix', type: GL_FLOAT },
  { name: 'u_source_mode', type: GL_INT },
  { name: 'u_source_sampling_mode', type: GL_INT },
  { name: 'u_has_nodata', type: GL_INT },
  { name: 'u_nodata', type: GL_INT },
  { name: 'u_scale', type: GL_FLOAT },
  { name: 'u_offset', type: GL_FLOAT },
  { name: 'u_matrix', type: GL_FLOAT_MAT4 },
  { name: 'u_world_offset_x', type: GL_FLOAT },
  { name: 'u_world_size', type: GL_FLOAT },
  { name: 'u_lon0', type: GL_FLOAT },
  { name: 'u_lat0', type: GL_FLOAT },
  { name: 'u_dx', type: GL_FLOAT },
  { name: 'u_dy', type: GL_FLOAT },
  { name: 'u_opacity', type: GL_FLOAT },
  { name: 'u_zoom', type: GL_FLOAT },
  { name: 'u_low_cloud_color', type: GL_FLOAT_VEC3 },
  { name: 'u_middle_cloud_color', type: GL_FLOAT_VEC3 },
  { name: 'u_high_cloud_color', type: GL_FLOAT_VEC3 },
  { name: 'u_pattern_opacity', type: GL_FLOAT },
].map((uniform) => ({ ...uniform, size: 1 }))

const MOCK_ACTIVE_ATTRIBUTES = [
  { name: 'a_mercator_pos', type: GL_FLOAT_VEC2, size: 1 },
]

type CustomLayerRuntime = {
  onAdd: (map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => void
  render: (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    input: unknown
  ) => void
  onRemove: (map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => void
}

export function createRenderSettingsFixture(
  overrides: Partial<ForecastRenderSettings> = {}
): ForecastRenderSettings {
  return {
    raster: DEFAULT_RASTER_RENDER_SETTINGS,
    particles: DEFAULT_PARTICLE_RENDER_SETTINGS,
    ...overrides,
  }
}

export function createMockWebGl2() {
  return {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    ACTIVE_UNIFORMS: GL_ACTIVE_UNIFORMS,
    ACTIVE_ATTRIBUTES: GL_ACTIVE_ATTRIBUTES,
    ARRAY_BUFFER: 34962,
    ELEMENT_ARRAY_BUFFER: 34963,
    BUFFER_SIZE: 34660,
    STATIC_DRAW: 35044,
    FLOAT: GL_FLOAT,
    FLOAT_VEC2: GL_FLOAT_VEC2,
    FLOAT_MAT4: GL_FLOAT_MAT4,
    INT: GL_INT,
    SAMPLER_2D: GL_SAMPLER_2D,
    INT_SAMPLER_2D_ARRAY: GL_INT_SAMPLER_2D_ARRAY,
    TEXTURE_2D: 3553,
    TEXTURE_2D_ARRAY: 35866,
    UNPACK_ALIGNMENT: 3317,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    NEAREST: 9728,
    LINEAR: 9729,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    REPEAT: 10497,
    CLAMP_TO_EDGE: 33071,
    R8I: 33329,
    R32F: 33326,
    RG8I: 33335,
    RED: 6403,
    RED_INTEGER: 36244,
    RG_INTEGER: 33320,
    BYTE: 5120,
    RGBA8: 32856,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    FRAMEBUFFER: 36160,
    COLOR_ATTACHMENT0: 36064,
    FRAMEBUFFER_COMPLETE: 36053,
    TEXTURE0: 33984,
    TEXTURE1: 33985,
    TEXTURE2: 33986,
    TEXTURE3: 33987,
    TEXTURE4: 33988,
    DEPTH_TEST: 2929,
    BLEND: 3042,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    TRIANGLES: 4,
    POINTS: 0,
    getExtension: vi.fn((): unknown => null),
    createVertexArray: vi.fn(() => ({})),
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn((_shader: unknown, pname: number) => pname === 35713),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    bindAttribLocation: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn((_program: unknown, pname: number) => {
      if (pname === 35714) return true
      if (pname === GL_ACTIVE_UNIFORMS) return MOCK_ACTIVE_UNIFORMS.length
      if (pname === GL_ACTIVE_ATTRIBUTES) return MOCK_ACTIVE_ATTRIBUTES.length
      return 0
    }),
    getProgramInfoLog: vi.fn(() => ''),
    deleteProgram: vi.fn(),
    getActiveUniform: vi.fn((_program: unknown, index: number) => MOCK_ACTIVE_UNIFORMS[index] ?? null),
    getActiveAttrib: vi.fn((_program: unknown, index: number) => MOCK_ACTIVE_ATTRIBUTES[index] ?? null),
    getAttribLocation: vi.fn((_program: unknown, name: string) => (name === 'a_mercator_pos' ? 0 : -1)),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    getBufferParameter: vi.fn(() => 12 * 4),
    deleteBuffer: vi.fn(),
    bindVertexArray: vi.fn(),
    deleteVertexArray: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    disableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    vertexAttrib4fv: vi.fn(),
    getUniformLocation: vi.fn((_program: unknown, name: string) => name),
    createTexture: vi.fn(() => ({})),
    bindTexture: vi.fn(),
    pixelStorei: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    texImage3D: vi.fn(),
    deleteTexture: vi.fn(),
    createFramebuffer: vi.fn(() => ({})),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    checkFramebufferStatus: vi.fn(() => 36053),
    deleteFramebuffer: vi.fn(),
    viewport: vi.fn(),
    clearBufferfv: vi.fn(),
    useProgram: vi.fn(),
    activeTexture: vi.fn(),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    uniform1iv: vi.fn(),
    uniform2fv: vi.fn(),
    uniform3fv: vi.fn(),
    uniformMatrix4fv: vi.fn(),
    disable: vi.fn(),
    enable: vi.fn(),
    blendFunc: vi.fn(),
    drawArrays: vi.fn(),
  }
}

type RenderLayerMapFixture = MapLibreMap & {
  addLayer: ReturnType<typeof vi.fn>
  getLayer: ReturnType<typeof vi.fn>
  removeLayer: ReturnType<typeof vi.fn>
}

export function createRenderLayerMapFixture(args: {
  layerIds?: readonly string[]
  includeAnchorLayer?: boolean
} = {}): RenderLayerMapFixture {
  const layers = new Set<string>(args.layerIds ?? [])
  if (args.includeAnchorLayer !== false) {
    layers.add(FORECAST_LAYER_BEFORE_ID_FIXTURE)
  }

  return {
    addLayer: vi.fn((layer: { id: string }) => {
      layers.add(layer.id)
      return undefined
    }),
    getLayer: vi.fn((layerId: string) => (
      layers.has(layerId) ? { id: layerId } : undefined
    )),
    removeLayer: vi.fn((layerId: string) => {
      layers.delete(layerId)
      return undefined
    }),
  } as unknown as RenderLayerMapFixture
}

export function createCustomLayerRuntimeFixture(
  overrides: Partial<CustomLayerRuntime> = {}
): CustomLayerRuntime {
  return {
    onAdd: vi.fn(),
    render: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  }
}

export function createRenderControllerFixture(args: {
  available?: boolean
  applyFrame?: (frame: unknown) => void
  setEnabled?: (enabled: boolean) => void
  applySettings?: (settings: unknown) => void
} = {}) {
  const applyFrame = args.applyFrame ?? (() => undefined)
  const setEnabled = args.setEnabled ?? (() => undefined)
  const applySettings = args.applySettings ?? (() => undefined)

  return {
    isAvailable: () => args.available ?? true,
    applyFrame(frame: unknown) {
      applyFrame(frame)
    },
    setEnabled(enabled: boolean) {
      setEnabled(enabled)
    },
    applySettings(settings: unknown) {
      applySettings(settings)
    },
  }
}
