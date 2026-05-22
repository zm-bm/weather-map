import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'

const mocks = vi.hoisted(() => ({
  useForecastManifest: vi.fn(),
  forecastShell: vi.fn(() => <div data-testid="forecast-screen">forecast</div>),
}))

vi.mock('./forecast-manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./forecast-manifest')>()
  return {
    ...actual,
    useForecastManifest: mocks.useForecastManifest,
  }
})

vi.mock('./components/ForecastShell/ForecastShell', () => ({
  default: mocks.forecastShell,
}))

describe('App health route', () => {
  beforeEach(() => {
    window.history.pushState(null, '', '/')
    mocks.useForecastManifest.mockReset()
    mocks.useForecastManifest.mockReturnValue({
      phase: 'loading',
      data: null,
      error: null,
      retry: vi.fn(),
    })
    mocks.forecastShell.mockClear()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('renders /health without mounting the forecast shell', async () => {
    window.history.pushState(null, '', '/health')
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(createHealthPayload()))

    render(<App />)

    expect(await screen.findByText('Weather Map Health')).toBeInTheDocument()
    expect(screen.queryByTestId('forecast-screen')).not.toBeInTheDocument()
    expect(mocks.useForecastManifest).not.toHaveBeenCalled()
  })

  it('renders backend unavailable when the health request fails', async () => {
    window.history.pushState(null, '', '/health')
    vi.mocked(fetch).mockRejectedValueOnce(new Error('api offline'))

    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByText('api offline').length).toBeGreaterThan(0)
    })
  })
})

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createHealthPayload() {
  return {
    schema: 'weather-map.health',
    schemaVersion: 1,
    generatedAt: '2026-05-11T18:00:00Z',
    status: 'healthy',
    models: [],
  }
}
