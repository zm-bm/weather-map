import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ForecastBootstrapData,
  ForecastBootstrapState,
} from './forecast-bootstrap'
import ForecastApp from './ForecastApp'

const mocks = vi.hoisted(() => ({
  bootstrapState: null as ForecastBootstrapState | null,
  shellForecast: undefined as ForecastBootstrapData | null | undefined,
  startupState: null as ForecastBootstrapState | null,
}))

vi.mock('./forecast-bootstrap', () => ({
  useForecastBootstrap: () => mocks.bootstrapState,
  AppStartupStatus: ({ state }: { state: ForecastBootstrapState }) => {
    mocks.startupState = state
    return null
  },
}))

vi.mock('./components/ForecastShell/ForecastShell', () => ({
  default: ({ forecast }: { forecast: ForecastBootstrapData | null }) => {
    mocks.shellForecast = forecast
    return null
  },
}))

describe('ForecastApp', () => {
  beforeEach(() => {
    mocks.bootstrapState = {
      phase: 'loading',
      data: null,
      error: null,
      retry: vi.fn(),
    }
    mocks.shellForecast = undefined
    mocks.startupState = null
  })

  it('passes bootstrap data to the shell and startup state to status projection', () => {
    const data = { marker: 'forecast' } as unknown as ForecastBootstrapData
    mocks.bootstrapState = {
      phase: 'ready',
      data,
      error: null,
      retry: vi.fn(),
    }

    render(<ForecastApp />)

    expect(mocks.shellForecast).toBe(data)
    expect(mocks.startupState).toBe(mocks.bootstrapState)
  })

  it('passes null forecast data while startup is still blocked', () => {
    render(<ForecastApp />)

    expect(mocks.shellForecast).toBeNull()
    expect(mocks.startupState).toBe(mocks.bootstrapState)
  })
})
