import { ENCODED_GRID_GLSL } from '../../encodedGrid'
import { assembleShader } from '../../gpu'
import {
  COLORMAP_SOURCE_MODE_LINEAR,
  COLORMAP_SOURCE_MODE_TEMP_C,
  COLORMAP_SOURCE_MODE_WIND_SPEED,
} from './renderPaths/colormap'
import {
  RASTER_SOURCE_SAMPLING_MODE_BILINEAR,
  RASTER_SOURCE_SAMPLING_MODE_NEAREST,
} from './renderPaths/sampling'
import globeFragmentClipSource from '../../gpu/glsl/globe-fragment-clip.glsl?raw'
import cloudLayersFragmentSource from './shaders/cloud-layers.frag.glsl?raw'
import colormapFragmentSource from './shaders/colormap.frag.glsl?raw'

const COLORMAP_SOURCE_MODES_GLSL = `
const int SOURCE_MODE_LINEAR = ${COLORMAP_SOURCE_MODE_LINEAR};
const int SOURCE_MODE_TEMP_C = ${COLORMAP_SOURCE_MODE_TEMP_C};
const int SOURCE_MODE_WIND_SPEED = ${COLORMAP_SOURCE_MODE_WIND_SPEED};
`

const SOURCE_SAMPLING_MODES_GLSL = `
const int SOURCE_SAMPLING_MODE_BILINEAR = ${RASTER_SOURCE_SAMPLING_MODE_BILINEAR};
const int SOURCE_SAMPLING_MODE_NEAREST = ${RASTER_SOURCE_SAMPLING_MODE_NEAREST};
`

export const COLORMAP_FRAGMENT_SHADER_SOURCE = assembleShader(colormapFragmentSource, {
  'colormap-source-modes': COLORMAP_SOURCE_MODES_GLSL,
  'encoded-grid': ENCODED_GRID_GLSL,
  'globe-fragment-clip': globeFragmentClipSource,
  'source-sampling-modes': SOURCE_SAMPLING_MODES_GLSL,
})

export const CLOUD_LAYERS_FRAGMENT_SHADER_SOURCE = assembleShader(
  cloudLayersFragmentSource,
  {
    'encoded-grid': ENCODED_GRID_GLSL,
    'globe-fragment-clip': globeFragmentClipSource,
    'source-sampling-modes': SOURCE_SAMPLING_MODES_GLSL,
  }
)
