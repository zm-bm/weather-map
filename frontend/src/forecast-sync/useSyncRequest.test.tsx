import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createForecastSelectionContextValue,
  createForecastTimeContextValue,
  createManifestFixture,
} from '../test/fixtures'
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

    const { result } = renderHook(() => useSyncRequest(0))
    expect(result.current).toBeNull()
  })

  it('builds request from the selected forecast hour', () => {
    const { result } = renderHook(() => useSyncRequest(0))

    expect(result.current).toEqual(expect.objectContaining({
      selectedValidTimeMs: Date.UTC(2026, 3, 9, 3, 30),
      lowerHourToken: '003',
      upperHourToken: '006',
      mix: 0.16666666666666666,
      requestKey: expect.stringContaining(':003:006:30:0'),
    }))
  })
})
