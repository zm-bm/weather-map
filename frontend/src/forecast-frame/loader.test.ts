import { describe, expect, it, vi } from 'vitest'

import { createConfigFixture, createFrameManifestFixture, createSignalFixture } from '../test/fixtures'
import { loadFramePayload, normalizeFrameHourToken } from './loader'

const BASE_MANIFEST = createFrameManifestFixture({ forecastHours: ['000'] })
const SCALAR_FRAME_REF = BASE_MANIFEST.frames['000']!.tmp_surface!
const VECTOR_FRAME_REF = BASE_MANIFEST.frames['000']!.wind10m_uv!
const GRID = BASE_MANIFEST.grids.g0!

function createFetchOk(payload: ArrayBuffer) {
  return vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => payload,
  }))
}

describe('normalizeFrameHourToken', () => {
  it('pads and trims hour tokens', () => {
    expect(normalizeFrameHourToken('3')).toBe('003')
    expect(normalizeFrameHourToken(' 12 ')).toBe('012')
  })
})

describe('loadFramePayload', () => {
  it('loads a payload and returns the normalized hour token', async () => {
    vi.stubGlobal('fetch', createFetchOk(new Int16Array([1, 2, 3, 4]).buffer))

    const loaded = await loadFramePayload({
      config: createConfigFixture(),
      frameRef: SCALAR_FRAME_REF,
      grid: GRID,
      hourToken: '0',
      variable: 'tmp_surface',
      domain: 'scalar',
      signal: createSignalFixture(),
      verifySha256: false,
    })

    expect(loaded.hourToken).toBe('000')
    expect(loaded.payload.byteLength).toBe(8)

    vi.unstubAllGlobals()
  })

  it('fails on fetch errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    })))

    await expect(
      loadFramePayload({
        config: createConfigFixture(),
        frameRef: SCALAR_FRAME_REF,
        grid: GRID,
        hourToken: '000',
        variable: 'tmp_surface',
        domain: 'scalar',
        signal: createSignalFixture(),
        verifySha256: false,
      })
    ).rejects.toThrow('Failed to fetch scalar payload: 404 Not Found')

    vi.unstubAllGlobals()
  })

  it('fails when payload byte length does not match the frame manifest', async () => {
    vi.stubGlobal('fetch', createFetchOk(new Int16Array([1, 2, 3, 4]).buffer))

    await expect(
      loadFramePayload({
        config: createConfigFixture(),
        frameRef: {
          ...SCALAR_FRAME_REF,
          byte_length: 6,
        },
        grid: GRID,
        hourToken: '000',
        variable: 'tmp_surface',
        domain: 'scalar',
        signal: createSignalFixture(),
        verifySha256: false,
      })
    ).rejects.toThrow('Unexpected scalar payload size')

    vi.unstubAllGlobals()
  })

  it('fails when payload byte length does not match the grid dimensions', async () => {
    vi.stubGlobal('fetch', createFetchOk(new Int16Array([1, 2, 3, 4]).buffer))

    await expect(
      loadFramePayload({
        config: createConfigFixture(),
        frameRef: SCALAR_FRAME_REF,
        grid: {
          ...GRID,
          nx: 3,
          ny: 3,
        },
        hourToken: '000',
        variable: 'tmp_surface',
        domain: 'scalar',
        signal: createSignalFixture(),
        verifySha256: false,
      })
    ).rejects.toThrow('scalar payload bytes do not match grid dimensions')

    vi.unstubAllGlobals()
  })

  it('fails scalar and vector sha verification when enabled', async () => {
    vi.stubGlobal('fetch', createFetchOk(new Int16Array([1, 2, 3, 4]).buffer))

    await expect(
      loadFramePayload({
        config: createConfigFixture(),
        frameRef: {
          ...SCALAR_FRAME_REF,
          sha256: 'deadbeef',
        },
        grid: GRID,
        hourToken: '000',
        variable: 'tmp_surface',
        domain: 'scalar',
        signal: createSignalFixture(),
        verifySha256: true,
      })
    ).rejects.toThrow('scalar SHA-256 mismatch')

    await expect(
      loadFramePayload({
        config: createConfigFixture(),
        frameRef: {
          ...VECTOR_FRAME_REF,
          sha256: 'cafebabe',
        },
        grid: GRID,
        hourToken: '000',
        variable: 'wind10m_uv',
        domain: 'vector',
        signal: createSignalFixture(),
        verifySha256: true,
      })
    ).rejects.toThrow('vector SHA-256 mismatch')

    vi.unstubAllGlobals()
  })
})
