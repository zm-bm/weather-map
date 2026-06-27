import { describe, expect, it } from 'vitest'

import PARTICLE_PASS_SOURCE from './renderPasses/particles.ts?raw'
import PASSES_INDEX_SOURCE from './renderPasses/index.ts?raw'
import TRAIL_PASS_SOURCE from './renderPasses/trails.ts?raw'
import UPDATE_PASS_SOURCE from './renderPasses/update.ts?raw'
import RUNTIME_SOURCE from './runtime.ts?raw'
import STATE_BUFFERS_SOURCE from './stateBuffers.ts?raw'
import VECTOR_FRAME_PAIR_SOURCE from './vectorFramePair.ts?raw'

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
    expect(UPDATE_PASS_SOURCE).toContain('options.stagnationRespawnStartMps')
    expect(UPDATE_PASS_SOURCE).toContain('options.stagnationRespawnEndMps')
    expect(UPDATE_PASS_SOURCE).toContain('options.stagnationRespawnPerSec')
    expect(PASSES_SOURCE).toContain('u_stagnation_fade_start_mps: options.stagnationFadeStartMps')
    expect(PASSES_SOURCE).toContain('u_stagnation_fade_end_mps: options.stagnationFadeEndMps')
  })

  it('uses vector encoding metadata in CPU update paths', () => {
    expect(UPDATE_PASS_SOURCE).toContain('const encoding = raster.encoding as VectorRasterEncoding')
    expect(UPDATE_PASS_SOURCE).toContain('const scale = encoding.scale ?? 1')
    expect(UPDATE_PASS_SOURCE).toContain('const offset = encoding.offset ?? 0')
  })

  it('stores vector wind frames as a CPU-sampled frame pair', () => {
    expect(VECTOR_FRAME_PAIR_SOURCE).toContain('type VectorFramePair')
    expect(PASSES_INDEX_SOURCE).toContain('vectorFramePair: VectorFramePair | null')
    expect(VECTOR_FRAME_PAIR_SOURCE).toContain('validateVectorFrame')
  })

  it('stores speed in reusable CPU-owned four-component particle state', () => {
    expect(STATE_BUFFERS_SOURCE).toContain('const PARTICLE_STATE_COMPONENTS = 4')
    expect(STATE_BUFFERS_SOURCE).toContain('new Float32Array(count * PARTICLE_STATE_COMPONENTS)')
    expect(STATE_BUFFERS_SOURCE).toContain('new Float32Array(initial)')
    expect(STATE_BUFFERS_SOURCE).toContain('numComponents: PARTICLE_STATE_COMPONENTS')
    expect(UPDATE_PASS_SOURCE).toContain('target[base + 3] = speedMps')
    expect(UPDATE_PASS_SOURCE).toContain('uploadParticleStateArray(gl, targetBufferInfo, target)')
  })

  it('does not read particle state back from the GPU during updates', () => {
    expect(UPDATE_PASS_SOURCE).not.toContain(['getBuffer', 'SubData'].join(''))
    expect(RUNTIME_SOURCE).not.toContain(['transform', 'Feedback'].join(''))
  })

  it('validates wind vector bands before CPU sampling', () => {
    expect(VECTOR_FRAME_PAIR_SOURCE).toContain('encodedRasterBandIdMismatch')
    expect(VECTOR_FRAME_PAIR_SOURCE).toContain('sourceBandIds(frame.source.source)')
    expect(VECTOR_FRAME_PAIR_SOURCE).toContain('u.length !== componentBytes || v.length !== componentBytes')
  })

  it('passes dot settings to draw shaders', () => {
    expect(PARTICLE_PASS_SOURCE).toContain('const pixelRatio = particleRenderPixelRatio(gl)')
    expect(PARTICLE_PASS_SOURCE).toContain('const dotMinPx = options.dotMinPx * pixelRatio')
    expect(PARTICLE_PASS_SOURCE).toContain('const dotMaxPx = options.dotMaxPx * pixelRatio')
    expect(PARTICLE_PASS_SOURCE).toContain('u_dot_min_px: dotMinPx')
    expect(PARTICLE_PASS_SOURCE).toContain('u_dot_max_px: dotMaxPx')
    expect(PARTICLE_PASS_SOURCE).not.toContain(['u_dot_min_px: options', 'dotMinPx'].join('.'))
    expect(PARTICLE_PASS_SOURCE).not.toContain(['u_dot_max_px: options', 'dotMaxPx'].join('.'))
  })

  it('passes MapLibre projection uniforms to particle drawing', () => {
    expect(RUNTIME_SOURCE).toContain('matrix: input.modelViewProjectionMatrix')
    expect(RUNTIME_SOURCE).toContain('worldSize: worldSizeAtZoom(state.map.getZoom())')
    expect(PASSES_INDEX_SOURCE).toContain('type ParticleProjectionUniforms')
    expect(TRAIL_PASS_SOURCE).toContain('drawParticleGeometryPass(state, options, projection)')
    expect(PARTICLE_PASS_SOURCE).toContain('u_matrix: projection.matrix')
    expect(PARTICLE_PASS_SOURCE).toContain('u_world_size: projection.worldSize')
    expect(PARTICLE_PASS_SOURCE).not.toContain('u_mercator_bounds')
  })
})
