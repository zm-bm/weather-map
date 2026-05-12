import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'

const mocks = vi.hoisted(() => ({
  useManifest: vi.fn(),
  forecastShell: vi.fn(() => <div data-testid="forecast-screen">forecast</div>),
}))

vi.mock('./manifest/useManifest', () => ({
  useManifest: mocks.useManifest,
}))

vi.mock('./components/ForecastShell/ForecastShell', () => ({
  default: mocks.forecastShell,
}))

describe('App health route', () => {
  beforeEach(() => {
    window.history.pushState(null, '', '/')
    mocks.useManifest.mockReset()
    mocks.forecastShell.mockClear()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('renders /health without mounting the forecast shell', async () => {
    window.history.pushState(null, '', '/health')
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(createHealthPayload()))

    render(<App />)

    expect(await screen.findByText('Weather Map Health')).toBeInTheDocument()
    expect(screen.queryByTestId('forecast-screen')).not.toBeInTheDocument()
    expect(mocks.useManifest).not.toHaveBeenCalled()
  })

  it('keeps / on the forecast shell', () => {
    mocks.useManifest.mockReturnValue({
      manifest: null,
      loading: true,
      error: null,
      retry: vi.fn(),
    })

    render(<App />)

    expect(screen.getByTestId('forecast-screen')).toBeInTheDocument()
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
    status: 'degraded',
    models: [
      {
        id: 'gfs',
        label: 'GFS',
        status: 'building',
        reason: 'Expected cycle is still building with recent marker progress.',
        expectedCycle: '2026051118',
        expectedCycleDeadline: '2026-05-12T01:00:00Z',
        latestObservedCycle: '2026051118',
        latestPublishedCycle: '2026051112',
        latestPublishedGeneratedAt: '2026-05-11T18:42:00Z',
        progress: {
          cycle: '2026051118',
          published: false,
          expectedMarkers: 10,
          foundMarkers: 5,
          missingMarkers: 5,
          lastProgressAt: '2026-05-11T23:48:00Z',
          missingSample: ['tmp_surface/041'],
          invalidMarkerSample: [],
        },
        publishLag: {
          graceHours: 7,
          source: 'recent-history',
        },
      },
    ],
  }
}
