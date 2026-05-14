import { describe, expect, it } from 'vitest'

import { createFrameManifestFixture } from '../test/fixtures'
import type { ForecastFramePlan } from './plan'
import { createForecastFrameMemory } from './memory'
import type { ForecastFrameBundle } from './types'

function createPlan(fieldKey = 'field:tmp_surface', particleKey = 'particles:wind10m_uv'): ForecastFramePlan {
  return {
    manifest: createFrameManifestFixture(),
    selectedValidTimeMs: 0,
    lowerHourToken: '000',
    upperHourToken: '000',
    mix: 0,
    field: {
      key: fieldKey,
      load: async () => {
        throw new Error('test plan field loader should not run')
      },
    },
    particles: particleKey === 'particles:none'
      ? null
      : {
        key: particleKey,
        load: async () => {
          throw new Error('test plan particle loader should not run')
        },
      },
  }
}

describe('createForecastFrameMemory', () => {
  it('reuses committed windows only for matching field and particle keys', () => {
    const memory = createForecastFrameMemory()
    const plan = createPlan()
    const frames = {
      field: { lower: { layerId: 'tmp_surface' } },
      particles: { lower: { artifactId: 'wind10m_uv' } },
    } as ForecastFrameBundle

    expect(memory.reusableWindowsFor(plan)).toEqual({})
    expect(memory.shouldClearFieldProbe(plan)).toBe(false)

    memory.commit(plan, frames)
    expect(memory.reusableWindowsFor(plan)).toEqual({
      field: frames.field,
      particles: frames.particles,
    })

    const nextLayerPlan = createPlan('field:rh_surface', 'particles:wind10m_uv')
    expect(memory.shouldClearFieldProbe(nextLayerPlan)).toBe(true)
    expect(memory.reusableWindowsFor(nextLayerPlan)).toEqual({
      field: null,
      particles: frames.particles,
    })
  })

  it('resets committed frame windows', () => {
    const memory = createForecastFrameMemory()
    const plan = createPlan()
    const frames = {
      field: { lower: { layerId: 'tmp_surface' } },
      particles: null,
    } as ForecastFrameBundle

    memory.commit(plan, frames)
    memory.reset()

    expect(memory.reusableWindowsFor(plan)).toEqual({})
    expect(memory.shouldClearFieldProbe(plan)).toBe(false)
  })
})
