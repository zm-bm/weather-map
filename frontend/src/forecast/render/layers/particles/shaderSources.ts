import { ENCODED_GRID_LOCATION_GLSL } from '../../encodedGrid'
import { assembleShader } from '../../gpu'
import particleFragmentSource from './shaders/particles.frag.glsl?raw'
import particleVertexSource from './shaders/particles.vert.glsl?raw'
import trailFragmentSource from './shaders/trails.frag.glsl?raw'
import trailVertexSource from './shaders/trails.vert.glsl?raw'
import updateFragmentSource from './shaders/update.frag.glsl?raw'
import updateVertexSource from './shaders/update.vert.glsl?raw'
import viewportSource from './shaders/viewport.glsl?raw'

const PARTICLE_VIEWPORT_GLSL = viewportSource

export const VECTOR_UPDATE_VERTEX_SHADER_SOURCE = assembleShader(updateVertexSource, {
  'encoded-grid-location': ENCODED_GRID_LOCATION_GLSL,
  'particle-viewport': PARTICLE_VIEWPORT_GLSL,
})

export const VECTOR_UPDATE_FRAGMENT_SHADER_SOURCE = updateFragmentSource

export const VECTOR_PARTICLE_VERTEX_SHADER_SOURCE = assembleShader(particleVertexSource, {
  'particle-viewport': PARTICLE_VIEWPORT_GLSL,
})
export const VECTOR_PARTICLE_FRAGMENT_SHADER_SOURCE = particleFragmentSource

export const VECTOR_TRAIL_VERTEX_SHADER_SOURCE = trailVertexSource
export const VECTOR_TRAIL_FRAGMENT_SHADER_SOURCE = trailFragmentSource
