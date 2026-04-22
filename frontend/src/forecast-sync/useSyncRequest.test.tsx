import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createManifestFixture } from '../test/fixtures'
import { useSyncRequest } from './useSyncRequest'

const mocks = vi.hoisted(() => ({
  useForecastSelectionContext: vi.fn(),
  useForecastTimeContext: vi.fn(),
}))

vi.mock('../forecast-selection/ForecastSelectionContext', () => ({
  useForecastSelectionContext: () => mocks.useForecastSelectionContext(),
}))

vi.mock('../forecast-time/ForecastTimeContext', () => ({
  useForecastTimeContext: () => mocks.useForecastTimeContext(),
}))

describe('useSyncRequest', () => {
  let forecastTimeContextValue: ReturnType<typeof mocks.useForecastTimeContext>

  beforeEach(() => {
    vi.clearAllMocks()

    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['000', '003', '006'],
    })

    mocks.useForecastSelectionContext.mockReturnValue({
      manifest,
      cycle: manifest.cycle,
      scalarVariables: manifest.scalarVariables,
      vectorVariables: manifest.vectorVariables,
      variableMeta: manifest.variableMeta,
      activeScalar: manifest.scalarVariables[0],
      activeVector: manifest.vectorVariables[0],
      scalarUnitOptionIds: {},
      vectorUnitOptionIds: {},
      setActiveScalar: vi.fn(),
      setActiveVector: vi.fn(),
      getScalarUnitOptionId: vi.fn(),
      getVectorUnitOptionId: vi.fn(),
      setScalarUnitOptionId: vi.fn(),
      setVectorUnitOptionId: vi.fn(),
    })

    forecastTimeContextValue = {
      cycle: manifest.cycle,
      forecastHours: manifest.forecastHours,
      state: {
        appliedHourIndex: 1,
        targetHourIndex: 1,
        pendingHourIndex: null,
        isInFlight: false,
        isPlaying: false,
      },
      controls: {
        requestHour: vi.fn(),
        requestNext: vi.fn(),
        requestPrev: vi.fn(),
        togglePlay: vi.fn(),
      },
      sync: {
        onRequestStart: vi.fn(),
        onRequestApplied: vi.fn(),
        onRequestError: vi.fn(),
      },
    }

    mocks.useForecastTimeContext.mockReturnValue(forecastTimeContextValue)
  })

  it('returns null when manifest is unavailable', () => {
    mocks.useForecastSelectionContext.mockReturnValue({
      manifest: null,
      cycle: null,
      scalarVariables: [],
      vectorVariables: [],
      variableMeta: null,
      activeScalar: null,
      activeVector: null,
      scalarUnitOptionIds: {},
      vectorUnitOptionIds: {},
      setActiveScalar: vi.fn(),
      setActiveVector: vi.fn(),
      getScalarUnitOptionId: vi.fn(),
      getVectorUnitOptionId: vi.fn(),
      setScalarUnitOptionId: vi.fn(),
      setVectorUnitOptionId: vi.fn(),
    })

    const { result } = renderHook(() => useSyncRequest(0))
    expect(result.current).toBeNull()
  })

  it('builds request from the selected forecast hour', () => {
    const { result } = renderHook(() => useSyncRequest(0))

    expect(result.current).toEqual(expect.objectContaining({
      hourIndex: 1,
      hourToken: '003',
      requestKey: expect.stringContaining(':003:0'),
    }))
  })
})
