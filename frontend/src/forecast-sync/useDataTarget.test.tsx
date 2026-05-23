import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createForecastSelectionContextValue,
  createForecastTimeContextValue,
  createManifestFixture,
} from '../test/fixtures'
import { useDataTarget } from './useDataTarget'

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

describe('useDataTarget', () => {
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

    const { result } = renderHook(() => useDataTarget())
    expect(result.current).toBeNull()
  })

  it('builds a target from the selected forecast hour', () => {
    const { result } = renderHook(() => useDataTarget())

    expect(result.current).toEqual(expect.objectContaining({
      windVectorDataSource: {
        id: 'wind',
        artifactId: 'wind10m_uv',
      },
      selectedValidTimeMs: Date.UTC(2026, 3, 9, 3, 30),
      lowerHourToken: '003',
      upperHourToken: '006',
      mix: 0.16666666666666666,
      minuteOffset: 30,
    }))
    expect(result.current).not.toHaveProperty('sync')
    expect(result.current).not.toHaveProperty('selectedParticleLayerId')
    expect(result.current).not.toHaveProperty('requestKey')
  })

  it('builds a target without wind vectors when no particle layer is available', () => {
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

    const { result } = renderHook(() => useDataTarget())

    expect(result.current).toEqual(expect.objectContaining({
      windVectorDataSource: null,
    }))
    expect(result.current).not.toHaveProperty('selectedParticleLayerId')
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

    const { result } = renderHook(() => useDataTarget())

    expect(result.current).toBeNull()
  })
})
