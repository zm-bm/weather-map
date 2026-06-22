import { describe, expect, it } from 'vitest'

import PARTICLE_PASS_SOURCE from './renderPasses/particles.ts?raw'
import PASSES_INDEX_SOURCE from './renderPasses/index.ts?raw'
import TRAIL_PASS_SOURCE from './renderPasses/trails.ts?raw'
import UPDATE_PASS_SOURCE from './renderPasses/update.ts?raw'
import RUNTIME_SOURCE from './runtime.ts?raw'
import STATE_BUFFERS_SOURCE from './stateBuffers.ts?raw'
import VECTOR_TEXTURE_SOURCE from './vectorTexture.ts?raw'

const PASSES_SOURCE = [
  PASSES_INDEX_SOURCE,
  UPDATE_PASS_SOURCE,
  PARTICLE_PASS_SOURCE,
  TRAIL_PASS_SOURCE,
].join('\n')

describe('particle runtime source', () => {
  it('uses premultiplied alpha blending for particles and trail composite', () => {
    expect(PASSES_SOURCE).toContain('gl.blendFuncSeparate(')

    const premultipliedBlendCount = PASSES_SOURCE.match(/gl\.blendFuncSeparate\(/g)?.length ?? 0
    const premultipliedBlendArguments = PASSES_SOURCE.match(
      /gl\.blendFuncSeparate\(\s*gl\.ONE,\s*gl\.ONE_MINUS_SRC_ALPHA,\s*gl\.ONE,\s*gl\.ONE_MINUS_SRC_ALPHA,\s*\)/g
    )?.length ?? 0
    expect(premultipliedBlendCount).toBe(2)
    expect(premultipliedBlendArguments).toBe(2)
  })

  it('passes stagnation drain settings to update and draw shaders', () => {
    expect(PASSES_SOURCE).toContain('u_stagnation_respawn_start_mps: options.stagnationRespawnStartMps')
    expect(PASSES_SOURCE).toContain('u_stagnation_respawn_end_mps: options.stagnationRespawnEndMps')
    expect(PASSES_SOURCE).toContain('u_stagnation_respawn_per_sec: options.stagnationRespawnPerSec')
    expect(PASSES_SOURCE).toContain('u_stagnation_fade_start_mps: options.stagnationFadeStartMps')
    expect(PASSES_SOURCE).toContain('u_stagnation_fade_end_mps: options.stagnationFadeEndMps')
  })

  it('passes vector encoding metadata only to the update shader', () => {
    expect(UPDATE_PASS_SOURCE).toContain('...packedVectorFramePairUniforms(vectorFramePair)')

    const scaleUniformCount = VECTOR_TEXTURE_SOURCE.match(/u_vector_scale: encoding\.scale/g)?.length ?? 0
    const offsetUniformCount = VECTOR_TEXTURE_SOURCE.match(/u_vector_offset: encoding\.offset/g)?.length ?? 0
    expect(scaleUniformCount).toBe(1)
    expect(offsetUniformCount).toBe(1)
  })

  it('stores packed vector wind textures as a frame pair', () => {
    expect(VECTOR_TEXTURE_SOURCE).toContain('type PackedVectorFramePair')
    expect(PASSES_INDEX_SOURCE).toContain('vectorFramePair: PackedVectorFramePair | null')
    expect(RUNTIME_SOURCE).toContain('state.vectorFramePair = nextFramePair')
    expect(RUNTIME_SOURCE).toContain('deletePackedVectorFramePairTextures(gl, previousFramePair, nextFramePair)')
  })

  it('stores speed in a four-component particle state buffer', () => {
    expect(STATE_BUFFERS_SOURCE).toContain('const PARTICLE_STATE_COMPONENTS = 4')
    expect(STATE_BUFFERS_SOURCE).toContain('new Float32Array(count * PARTICLE_STATE_COMPONENTS)')
    expect(STATE_BUFFERS_SOURCE).toContain('numComponents: PARTICLE_STATE_COMPONENTS')
    expect(RUNTIME_SOURCE).toContain('transformFeedbackVaryings: [\'v_state\']')
  })

  it('uses the shared WebGL program helper with explicit particle attributes', () => {
    expect(RUNTIME_SOURCE).toContain("import { asWebGL2, createProgramInfo } from '../../gpu'")
    expect(RUNTIME_SOURCE).toContain("label: 'particles:update'")
    expect(RUNTIME_SOURCE).toContain('attribLocations: { a_state: 0 }')
    expect(RUNTIME_SOURCE).toContain('transformFeedbackMode: gl2.SEPARATE_ATTRIBS')
    expect(RUNTIME_SOURCE).toContain('attribLocations: { a_pos: 0 }')
  })

  it('keeps particle orchestration pointed at pass and shader indexes', () => {
    expect(RUNTIME_SOURCE).toContain("} from './renderPasses'")
    expect(RUNTIME_SOURCE).toContain("} from './shaders'")
  })

  it('uploads wind vectors as signed integer RG textures', () => {
    expect(VECTOR_TEXTURE_SOURCE).toContain('new Int8Array(componentBytes * 2)')
    expect(VECTOR_TEXTURE_SOURCE).toContain('gl.RG8I')
    expect(VECTOR_TEXTURE_SOURCE).toContain('gl.RG_INTEGER')
    expect(VECTOR_TEXTURE_SOURCE).toContain('gl.BYTE')
  })

  it('passes dot settings to draw shaders', () => {
    expect(PASSES_SOURCE).toContain('u_dot_min_px: options.dotMinPx')
    expect(PASSES_SOURCE).toContain('u_dot_max_px: options.dotMaxPx')
  })
})
