import { ENCODED_GRID_GLSL } from '../../encodedGrid'
import { assembleShader } from '../../gpu'
import {
  OVERLAY_LATTICE_VISIBILITY_MAX,
  OVERLAY_LATTICE_VISIBILITY_MIN,
  OVERLAY_MASK_MAX,
  OVERLAY_MASK_MIN,
  OVERLAY_MAX_PATTERN_TILE_PIXELS,
  OVERLAY_MAX_PATTERN_ZOOM,
  OVERLAY_MIN_PATTERN_TILE_PIXELS,
  OVERLAY_MIN_PATTERN_ZOOM,
  OVERLAY_MIX_ALPHA,
  OVERLAY_SNOW_ALPHA,
  OVERLAY_SYMBOL_COLOR_RGB,
} from './renderPaths/precipitationType'
import globeFragmentClipSource from '../../gpu/glsl/globe-fragment-clip.glsl?raw'
import precipitationTypeFragmentSource from './shaders/precipitation-type.frag.glsl?raw'

const PRECIPITATION_TYPE_CONSTANTS_GLSL = `
const float MIN_PATTERN_ZOOM = ${OVERLAY_MIN_PATTERN_ZOOM.toFixed(1)};
const float MAX_PATTERN_ZOOM = ${OVERLAY_MAX_PATTERN_ZOOM.toFixed(1)};
const float MIN_PATTERN_TILE_SIZE = ${OVERLAY_MIN_PATTERN_TILE_PIXELS.toFixed(1)};
const float MAX_PATTERN_TILE_SIZE = ${OVERLAY_MAX_PATTERN_TILE_PIXELS.toFixed(1)};
const float TYPE_MASK_MIN = ${OVERLAY_MASK_MIN.toFixed(2)};
const float TYPE_MASK_MAX = ${OVERLAY_MASK_MAX.toFixed(2)};
const float LATTICE_VISIBILITY_MIN = ${OVERLAY_LATTICE_VISIBILITY_MIN.toFixed(2)};
const float LATTICE_VISIBILITY_MAX = ${OVERLAY_LATTICE_VISIBILITY_MAX.toFixed(2)};
const float SNOW_ALPHA = ${OVERLAY_SNOW_ALPHA.toFixed(2)};
const float MIX_ALPHA = ${OVERLAY_MIX_ALPHA.toFixed(2)};
const vec3 SYMBOL_COLOR = vec3(${OVERLAY_SYMBOL_COLOR_RGB.map((value) => value.toFixed(2)).join(', ')});
`

export const OVERLAY_FRAGMENT_SHADER_SOURCE = assembleShader(
  precipitationTypeFragmentSource,
  {
    'encoded-grid': ENCODED_GRID_GLSL,
    'globe-fragment-clip': globeFragmentClipSource,
    'precipitation-type-constants': PRECIPITATION_TYPE_CONSTANTS_GLSL,
  }
)
