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
})
