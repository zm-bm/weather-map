import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createForecastSelectionContextValue,
  createForecastTimeContextValue,
  createManifestFixture,
} from '../test/fixtures'
import { useSyncTarget } from './useSyncTarget'

const mocks = vi.hoisted(() => ({
  useForecastSelectionContext: vi.fn(),
  useForecastTimeContext: vi.fn(),
}))

vi.mock('../forecast-selection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../forecast-selection')>()
  return {
    ...actual,
    useForecastSelectionContext: () => mocks.useForecastSelectionContext(),
  }
})

vi.mock('../forecast-time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../forecast-time')>()
  return {
    ...actual,
    useForecastTimeContext: () => mocks.useForecastTimeContext(),
  }
})

describe('useSyncTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['000', '003', '006'],
    })
    const selection = createForecastSelectionContextValue(manifest)
    const time = createForecastTimeContextValue(
      manifest,
      {
        state: {
          appliedTimeMs: Date.UTC(2026, 3, 9, 3, 30),
          targetTimeMs: Date.UTC(2026, 3, 9, 3, 30),
        },
      }
    )

    mocks.useForecastSelectionContext.mockReturnValue(selection)
    mocks.useForecastTimeContext.mockReturnValue(time)
  })

  it('returns null when manifest is unavailable', () => {
    mocks.useForecastSelectionContext.mockReturnValue(
      createForecastSelectionContextValue(null)
    )

    const { result } = renderHook(() => useSyncTarget(0))
    expect(result.current).toBeNull()
  })

  it('builds a target from the selected forecast hour', () => {
    const { result } = renderHook(() => useSyncTarget(0))

    expect(result.current).toEqual(expect.objectContaining({
      selectedParticleLayerId: 'wind',
      selectedParticleLayer: expect.objectContaining({ id: 'wind' }),
      selectedValidTimeMs: Date.UTC(2026, 3, 9, 3, 30),
      lowerHourToken: '003',
      upperHourToken: '006',
      mix: 0.16666666666666666,
      requestKey: expect.stringContaining(':003:006:30:0'),
    }))
  })

  it('builds a target without particles when no particle layer is available', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['000', '003', '006'],
      vectorArtifactIds: [],
    })
    mocks.useForecastSelectionContext.mockReturnValue(createForecastSelectionContextValue(manifest))
    mocks.useForecastTimeContext.mockReturnValue(createForecastTimeContextValue(
      manifest,
      {
        state: {
          appliedTimeMs: Date.UTC(2026, 3, 9, 3, 30),
          targetTimeMs: Date.UTC(2026, 3, 9, 3, 30),
        },
      }
    ))

    const { result } = renderHook(() => useSyncTarget(0))

    expect(result.current).toEqual(expect.objectContaining({
      selectedParticleLayerId: null,
      selectedParticleLayer: null,
      requestKey: expect.stringContaining(':particles:none:003:006:30:0'),
    }))
  })

  it('returns null when the selected layer is missing from the loaded manifest', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['000', '003', '006'],
      scalarArtifactIds: ['tmp_surface'],
      vectorArtifactIds: [],
    })
    mocks.useForecastSelectionContext.mockReturnValue(createForecastSelectionContextValue(
      manifest,
      { selectedLayerId: 'visibility' }
    ))
    mocks.useForecastTimeContext.mockReturnValue(createForecastTimeContextValue(
      manifest,
      {
        state: {
          appliedTimeMs: Date.UTC(2026, 3, 9, 3, 30),
          targetTimeMs: Date.UTC(2026, 3, 9, 3, 30),
        },
      }
    ))

    const { result } = renderHook(() => useSyncTarget(0))

    expect(result.current).toBeNull()
  })
})
