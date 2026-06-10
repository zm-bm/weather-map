import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'

const mocks = vi.hoisted(() => ({
  useForecastManifest: vi.fn(),
  forecastShell: vi.fn(() => <div data-testid="forecast-screen">forecast</div>),
}))

vi.mock('@/forecast/manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/forecast/manifest')>()
  return {
    ...actual,
    useForecastManifest: mocks.useForecastManifest,
  }
})

vi.mock('@/forecast/ui/ForecastShell', () => ({
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
    expect(screen.getByText('Pending frames')).toBeInTheDocument()
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
    schema_version: 2,
    generated_at: '2026-05-11T18:00:00Z',
    status: 'degraded',
    datasets: [
      {
        dataset_id: 'gfs',
        label: 'GFS',
        status: 'building',
        reason: 'Expected cycle is still building.',
        expected_cycle: '2026051112',
        expected_cycle_deadline: '2026-05-11T15:00:00Z',
        latest_observed_cycle: '2026051112',
        latest_published_cycle: '2026051106',
        latest_published_generated_at: '2026-05-11T07:00:00Z',
        lifecycle_stage: 'pending_frames',
        lifecycle_cycle: '2026051112',
        lifecycle_run_id: '20260511T183000Z-abcdef12',
        progress: null,
        publish_lag: {
          grace_hours: 3.5,
          source: 'recent-history',
        },
      },
    ],
  }
}
