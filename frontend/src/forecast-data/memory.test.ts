import { describe, expect, it } from 'vitest'

import { createSingleTimeManifestFixture, createActiveRunFixture } from '../test/fixtures'
import type { ForecastDataPlan } from './plan'
import { createForecastDataMemory } from './memory'
import type { ForecastRenderData } from './types'

function createPlan(
  fieldKey = 'field:temperature',
  particleKey = 'particles:wind:wind10m_uv',
  overlayKey: string | null = null,
  pressureContourKey: string | null = null
): ForecastDataPlan {
  return {
    activeRun: createActiveRunFixture(createSingleTimeManifestFixture()),
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
    precipTypeOverlay: overlayKey == null
      ? null
      : {
        key: overlayKey,
        load: async () => {
          throw new Error('test plan overlay loader should not run')
        },
      },
    pressureContours: pressureContourKey == null
      ? null
      : {
        key: pressureContourKey,
        load: async () => {
          throw new Error('test plan pressure contour loader should not run')
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

describe('createForecastDataMemory', () => {
  it('reuses committed windows only for matching field and particle keys', () => {
    const memory = createForecastDataMemory()
    const plan = createPlan()
    const frames = {
      field: { lower: { layerId: 'temperature' } },
      precipTypeOverlay: null,
      pressureContours: { lower: { artifactId: 'prmsl_msl' } },
      particles: { lower: { artifactId: 'wind10m_uv' } },
    } as ForecastRenderData

    expect(memory.reusableWindowsFor(plan)).toEqual({})
    expect(memory.shouldClearFieldProbe(plan)).toBe(false)

    memory.commit(plan, frames)
    expect(memory.reusableWindowsFor(plan)).toEqual({
      field: frames.field,
      precipTypeOverlay: null,
      pressureContours: null,
      particles: frames.particles,
    })

    const contourPlan = createPlan(
      'field:temperature',
      'particles:wind:wind10m_uv',
      null,
      'pressure-contours:prmsl_msl'
    )
    memory.commit(contourPlan, frames)
    expect(memory.reusableWindowsFor(contourPlan)).toEqual({
      field: frames.field,
      precipTypeOverlay: null,
      pressureContours: frames.pressureContours,
      particles: frames.particles,
    })

    const nextLayerPlan = createPlan('field:relative_humidity', 'particles:wind:wind10m_uv')
    expect(memory.shouldClearFieldProbe(nextLayerPlan)).toBe(true)
    expect(memory.reusableWindowsFor(nextLayerPlan)).toEqual({
      field: null,
      precipTypeOverlay: null,
      pressureContours: null,
      particles: frames.particles,
    })
  })

  it('resets committed interpolation windows', () => {
    const memory = createForecastDataMemory()
    const plan = createPlan()
    const frames = {
      field: { lower: { layerId: 'temperature' } },
      precipTypeOverlay: null,
      pressureContours: null,
      particles: null,
    } as ForecastRenderData

    memory.commit(plan, frames)
    memory.reset()

    expect(memory.reusableWindowsFor(plan)).toEqual({})
    expect(memory.shouldClearFieldProbe(plan)).toBe(false)
  })
})
