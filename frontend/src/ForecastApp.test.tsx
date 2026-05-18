import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ForecastManifestData,
  ForecastManifestState,
} from './forecast-manifest'
import ForecastApp from './ForecastApp'

const mocks = vi.hoisted(() => ({
  manifestState: null as ForecastManifestState | null,
  shellForecast: undefined as ForecastManifestData | null | undefined,
  startupState: null as ForecastManifestState | null,
}))

vi.mock('./forecast-manifest', () => ({
  useForecastManifest: () => mocks.manifestState,
  AppStartupStatus: ({ state }: { state: ForecastManifestState }) => {
    mocks.startupState = state
    return null
  },
}))

vi.mock('./components/ForecastShell/ForecastShell', () => ({
  default: ({ forecast }: { forecast: ForecastManifestData | null }) => {
    mocks.shellForecast = forecast
    return null
  },
}))

describe('ForecastApp', () => {
  beforeEach(() => {
    mocks.manifestState = {
      phase: 'loading',
      data: null,
      error: null,
      retry: vi.fn(),
    }
    mocks.shellForecast = undefined
    mocks.startupState = null
  })

  it('passes forecast manifest data to the shell and startup state to status projection', () => {
    const data = { marker: 'forecast' } as unknown as ForecastManifestData
    mocks.manifestState = {
      phase: 'ready',
      data,
      error: null,
      retry: vi.fn(),
    }

    render(<ForecastApp />)

    expect(mocks.shellForecast).toBe(data)
    expect(mocks.startupState).toBe(mocks.manifestState)
  })

  it('passes null forecast data while startup is still blocked', () => {
    render(<ForecastApp />)

    expect(mocks.shellForecast).toBeNull()
    expect(mocks.startupState).toBe(mocks.manifestState)
  })
})
