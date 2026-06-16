import { ENCODED_GRID_GLSL } from '../../encodedGrid'
import { assembleShader } from '../../gpu'
import {
  PRESSURE_CONTOUR_HALO_ALPHA,
  PRESSURE_CONTOUR_HALO_COLOR_RGB,
  PRESSURE_CONTOUR_HALO_HALF_WIDTH_PX,
  PRESSURE_CONTOUR_INTERVAL_HPA,
  PRESSURE_CONTOUR_MAIN_ALPHA,
  PRESSURE_CONTOUR_MAIN_COLOR_RGB,
  PRESSURE_CONTOUR_MAIN_HALF_WIDTH_PX,
  PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS,
} from './renderPaths/pressure'
import contourFragmentSource from './shaders/contour.frag.glsl?raw'
import pressureContourStyleSource from './shaders/pressure-contour-style.glsl?raw'
import pressureSmoothingSource from './shaders/pressure-smoothing.glsl?raw'
import rawContourFragmentSource from './shaders/raw-contour.frag.glsl?raw'
import smoothingFragmentSource from './shaders/smoothing.frag.glsl?raw'
import smoothingVertexSource from './shaders/smoothing.vert.glsl?raw'

const PASCALS_PER_HECTOPASCAL = 100.0

const PRESSURE_CONTOUR_CONSTANTS_GLSL = `
const float PASCALS_PER_HECTOPASCAL = ${PASCALS_PER_HECTOPASCAL.toFixed(1)};
const float CONTOUR_INTERVAL_HPA = ${PRESSURE_CONTOUR_INTERVAL_HPA.toFixed(1)};
const float MAIN_HALF_WIDTH_PX = ${PRESSURE_CONTOUR_MAIN_HALF_WIDTH_PX.toFixed(2)};
const float HALO_HALF_WIDTH_PX = ${PRESSURE_CONTOUR_HALO_HALF_WIDTH_PX.toFixed(2)};
const float MAIN_ALPHA = ${PRESSURE_CONTOUR_MAIN_ALPHA.toFixed(2)};
const float HALO_ALPHA = ${PRESSURE_CONTOUR_HALO_ALPHA.toFixed(2)};
const float SMOOTHING_CORNER_WEIGHT = ${PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS[0].toFixed(1)};
const float SMOOTHING_AXIS_WEIGHT = ${PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS[1].toFixed(1)};
const float SMOOTHING_CENTER_WEIGHT = ${PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS[4].toFixed(1)};
const vec3 MAIN_COLOR = vec3(${PRESSURE_CONTOUR_MAIN_COLOR_RGB.map((value) => value.toFixed(2)).join(', ')});
const vec3 HALO_COLOR = vec3(${PRESSURE_CONTOUR_HALO_COLOR_RGB.map((value) => value.toFixed(2)).join(', ')});
`

const PRESSURE_CONTOUR_STYLE_GLSL = pressureContourStyleSource
const PRESSURE_SMOOTHING_GLSL = pressureSmoothingSource

export const PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE = assembleShader(contourFragmentSource, {
  'encoded-grid': ENCODED_GRID_GLSL,
  'pressure-contour-constants': PRESSURE_CONTOUR_CONSTANTS_GLSL,
  'pressure-contour-style': PRESSURE_CONTOUR_STYLE_GLSL,
})

export const PRESSURE_CONTOUR_RAW_FRAGMENT_SHADER_SOURCE = assembleShader(
  rawContourFragmentSource,
  {
    'encoded-grid': ENCODED_GRID_GLSL,
    'pressure-contour-constants': PRESSURE_CONTOUR_CONSTANTS_GLSL,
    'pressure-contour-style': PRESSURE_CONTOUR_STYLE_GLSL,
    'pressure-smoothing': PRESSURE_SMOOTHING_GLSL,
  }
)

export const PRESSURE_SMOOTHING_VERTEX_SHADER_SOURCE = smoothingVertexSource

export const PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE = assembleShader(
  smoothingFragmentSource,
  {
    'encoded-grid': ENCODED_GRID_GLSL,
    'pressure-contour-constants': PRESSURE_CONTOUR_CONSTANTS_GLSL,
    'pressure-smoothing': PRESSURE_SMOOTHING_GLSL,
  }
)
