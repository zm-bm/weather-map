import {
  ENCODED_GRID_X_WRAP_NONE,
  ENCODED_GRID_X_WRAP_REPEAT,
  ENCODED_GRID_Y_MODE_CLAMP,
  ENCODED_GRID_Y_MODE_NONE,
} from './frames'
import encodedDerivedSource from './glsl/derived.glsl?raw'
import encodedLocationSource from './glsl/location.glsl?raw'
import encodedSampleSource from './glsl/sample.glsl?raw'
import encodedTextureArraySource from './glsl/texture-array.glsl?raw'

const ENCODED_GRID_BOUNDARY_CONSTANTS_GLSL = [
  `const int ENCODED_GRID_X_WRAP_NONE = ${ENCODED_GRID_X_WRAP_NONE};`,
  `const int ENCODED_GRID_X_WRAP_REPEAT = ${ENCODED_GRID_X_WRAP_REPEAT};`,
  `const int ENCODED_GRID_Y_MODE_NONE = ${ENCODED_GRID_Y_MODE_NONE};`,
  `const int ENCODED_GRID_Y_MODE_CLAMP = ${ENCODED_GRID_Y_MODE_CLAMP};`,
].join('\n')

export const ENCODED_GRID_LOCATION_GLSL = [
  ENCODED_GRID_BOUNDARY_CONSTANTS_GLSL,
  encodedLocationSource,
].join('\n')
export const ENCODED_SAMPLE_GLSL = encodedSampleSource
export const ENCODED_TEXTURE_ARRAY_GLSL = encodedTextureArraySource
export const ENCODED_DERIVED_GLSL = encodedDerivedSource

export const ENCODED_GRID_GLSL = [
  ENCODED_GRID_LOCATION_GLSL,
  ENCODED_SAMPLE_GLSL,
  ENCODED_TEXTURE_ARRAY_GLSL,
  ENCODED_DERIVED_GLSL,
].join('\n')
