import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ForecastDataTarget } from '@/forecast/data'
import {
  createForecastDataTargetFixture,
  createForecastSelectionContextValue,
  createForecastTimeContextValue,
  createManifestFixture,
} from '@/test/fixtures'
import { useDataTarget } from './useDataTarget'

const mocks = vi.hoisted(() => ({
  resolveDataTarget: vi.fn(),
  useForecastSelectionContext: vi.fn(),
  useForecastTimeContext: vi.fn(),
}))

vi.mock('./dataTarget', () => {
  return {
    resolveDataTarget: (args: unknown) => mocks.resolveDataTarget(args),
  }
})

vi.mock('@/forecast/selection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/forecast/selection')>()
  return {
    ...actual,
    useForecastSelectionContext: () => mocks.useForecastSelectionContext(),
  }
})

vi.mock('@/forecast/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/forecast/time')>()
  return {
    ...actual,
    useForecastTimeContext: () => mocks.useForecastTimeContext(),
  }
})

describe('useDataTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['000', '003', '006'],
    })
    mocks.useForecastSelectionContext.mockReturnValue(
      createForecastSelectionContextValue(manifest)
    )
    mocks.useForecastTimeContext.mockReturnValue(
      createForecastTimeContextValue(manifest, {
        state: {
          appliedTimeMs: Date.UTC(2026, 3, 9, 3, 30),
          targetTimeMs: Date.UTC(2026, 3, 9, 3, 30),
        },
      })
    )
  })

  it('delegates selection and target time to the data target resolver', () => {
    const target: ForecastDataTarget = createForecastDataTargetFixture()
    mocks.resolveDataTarget.mockReturnValue(target)

    const { result } = renderHook(() => useDataTarget())

    expect(result.current).toBe(target)
    expect(mocks.resolveDataTarget).toHaveBeenCalledWith(expect.objectContaining({
      activeRun: expect.any(Object),
      layers: expect.any(Object),
      selectedLayerId: 'temperature',
      selectedLayerIsRenderable: true,
      particleLayers: expect.any(Object),
      selectedParticleLayerId: 'wind',
      targetTimeMs: Date.UTC(2026, 3, 9, 3, 30),
    }))
  })

  it('returns resolver null results unchanged', () => {
    mocks.resolveDataTarget.mockReturnValue(null)

    const { result } = renderHook(() => useDataTarget())

    expect(result.current).toBeNull()
  })
})
