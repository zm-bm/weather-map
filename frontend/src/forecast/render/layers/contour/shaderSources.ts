import { ENCODED_GRID_GLSL, ENCODED_GRID_LOCATION_GLSL } from '../../encodedGrid'
import { assembleShader } from '../../gpu'
import {
  PRESSURE_CONTOUR_EDGE_EPSILON_HPA,
  PRESSURE_CONTOUR_HALO_ALPHA,
  PRESSURE_CONTOUR_HALO_COLOR_RGB,
  PRESSURE_CONTOUR_HALO_HALF_WIDTH_PX,
  PRESSURE_CONTOUR_INTERVAL_HPA,
  PRESSURE_CONTOUR_MAX_LEVELS_PER_CELL,
  PRESSURE_CONTOUR_MIN_COVERAGE,
  PRESSURE_CONTOUR_MAIN_ALPHA,
  PRESSURE_CONTOUR_MAIN_COLOR_RGB,
  PRESSURE_CONTOUR_MAIN_HALF_WIDTH_PX,
  PRESSURE_CONTOUR_SMOOTHING_KERNEL_TOTAL_WEIGHT,
  PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS,
} from './renderPaths/pressure'
import globeFragmentClipSource from '../../gpu/glsl/globe-fragment-clip.glsl?raw'
import contourLineSource from './shaders/contour-line.glsl?raw'
import contourFragmentSource from './shaders/contour.frag.glsl?raw'
import marchingSquaresSource from './shaders/marching-squares.glsl?raw'
import pressureFieldSource from './shaders/pressure-field.glsl?raw'
import smoothingFragmentSource from './shaders/smoothing.frag.glsl?raw'
import smoothingVertexSource from './shaders/smoothing.vert.glsl?raw'

const PASCALS_PER_HECTOPASCAL = 100.0

const CONTOUR_CONSTANTS_GLSL = `
const float CONTOUR_INTERVAL_HPA = ${PRESSURE_CONTOUR_INTERVAL_HPA.toFixed(1)};
const float MAIN_HALF_WIDTH_PX = ${PRESSURE_CONTOUR_MAIN_HALF_WIDTH_PX.toFixed(2)};
const float HALO_HALF_WIDTH_PX = ${PRESSURE_CONTOUR_HALO_HALF_WIDTH_PX.toFixed(2)};
const float MAIN_ALPHA = ${PRESSURE_CONTOUR_MAIN_ALPHA.toFixed(2)};
const float HALO_ALPHA = ${PRESSURE_CONTOUR_HALO_ALPHA.toFixed(2)};
const float MIN_CONTOUR_COVERAGE = ${PRESSURE_CONTOUR_MIN_COVERAGE.toFixed(3)};
const float CONTOUR_EDGE_EPSILON_HPA = ${PRESSURE_CONTOUR_EDGE_EPSILON_HPA.toFixed(4)};
const int MAX_CONTOUR_LEVELS_PER_CELL = ${PRESSURE_CONTOUR_MAX_LEVELS_PER_CELL};
const vec3 MAIN_COLOR = vec3(${PRESSURE_CONTOUR_MAIN_COLOR_RGB.map((value) => value.toFixed(2)).join(', ')});
const vec3 HALO_COLOR = vec3(${PRESSURE_CONTOUR_HALO_COLOR_RGB.map((value) => value.toFixed(2)).join(', ')});
`

const SMOOTHING_CONSTANTS_GLSL = `
const float PASCALS_PER_HECTOPASCAL = ${PASCALS_PER_HECTOPASCAL.toFixed(1)};
const float SMOOTHING_CORNER_WEIGHT = ${PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS[0].toFixed(1)};
const float SMOOTHING_AXIS_WEIGHT = ${PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS[1].toFixed(1)};
const float SMOOTHING_CENTER_WEIGHT = ${PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS[4].toFixed(1)};
const float SMOOTHING_FULL_WEIGHT = ${PRESSURE_CONTOUR_SMOOTHING_KERNEL_TOTAL_WEIGHT.toFixed(1)};
`

const CONTOUR_LINE_GLSL = contourLineSource
const MARCHING_SQUARES_GLSL = marchingSquaresSource
const PRESSURE_FIELD_GLSL = pressureFieldSource

export const PRESSURE_CONTOUR_FRAGMENT_SHADER_SOURCE = assembleShader(contourFragmentSource, {
  'encoded-grid': ENCODED_GRID_LOCATION_GLSL,
  'contour-line': CONTOUR_LINE_GLSL,
  'contour-constants': CONTOUR_CONSTANTS_GLSL,
  'globe-fragment-clip': globeFragmentClipSource,
  'marching-squares': MARCHING_SQUARES_GLSL,
  'pressure-field': PRESSURE_FIELD_GLSL,
})

export const PRESSURE_SMOOTHING_VERTEX_SHADER_SOURCE = smoothingVertexSource

export const PRESSURE_SMOOTHING_FRAGMENT_SHADER_SOURCE = assembleShader(
  smoothingFragmentSource,
  {
    'encoded-grid': ENCODED_GRID_GLSL,
    'smoothing-constants': SMOOTHING_CONSTANTS_GLSL,
  }
)
