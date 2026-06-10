import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchHealth } from './fetchHealth'

describe('fetchHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('surfaces a clear error when /api/health returns the SPA HTML fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html><html></html>', {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
      },
    })))

    await expect(fetchHealth()).rejects.toThrow(
      'Health API returned HTML. Restart the dev server and make sure the backend /api proxy is running.'
    )
  })

  it('accepts health schema version 2', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      schema: 'weather-map.health',
      schema_version: 2,
      generated_at: '2026-05-11T18:00:00Z',
      status: 'healthy',
      datasets: [],
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })))

    await expect(fetchHealth()).resolves.toMatchObject({
      schema: 'weather-map.health',
      schema_version: 2,
    })
  })
})
