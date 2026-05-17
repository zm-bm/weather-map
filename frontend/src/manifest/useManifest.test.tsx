import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CycleManifest } from './schema'
import { createManifestFixture } from '../test/fixtures'
import { useManifest } from './useManifest'

const mocks = vi.hoisted(() => ({
  fetchCurrentManifest: vi.fn(),
}))

vi.mock('./fetch', () => ({
  fetchCurrentManifest: mocks.fetchCurrentManifest,
}))

describe('useManifest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces a single error state when no manifest is returned', async () => {
    mocks.fetchCurrentManifest.mockResolvedValue(null as unknown as CycleManifest)

    const { result } = renderHook(() => useManifest('manifests/gfs/latest.json'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
      expect(result.current.manifest).toBeNull()
      expect(result.current.error).toBeInstanceOf(Error)
      expect(result.current.error?.message).toBe('No forecast manifest was returned.')
    })
  })

  it('supports manual retry after failure', async () => {
    const failure = new Error('manifest load failed')
    const manifest = createManifestFixture({
      cycle: '2026041100',
      generatedAt: '2026-04-11T00:00:00Z',
      revision: 'abc123',
    })

    mocks.fetchCurrentManifest
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(manifest)

    const { result } = renderHook(() => useManifest('manifests/gfs/latest.json'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBe(failure)
      expect(result.current.manifest).toBeNull()
    })

    act(() => {
      result.current.retry()
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBeNull()
      expect(result.current.manifest).toEqual(manifest)
    })

    expect(mocks.fetchCurrentManifest).toHaveBeenCalledTimes(2)
    expect(mocks.fetchCurrentManifest).toHaveBeenLastCalledWith(expect.objectContaining({
      manifestPath: 'manifests/gfs/latest.json',
    }))
  })

  it('ignores aborted in-flight requests when retry starts a newer load', async () => {
    const abortError = new Error('Request aborted')
    abortError.name = 'AbortError'

    const manifest = createManifestFixture({
      cycle: '2026041200',
      generatedAt: '2026-04-12T00:00:00Z',
      revision: 'retry-success',
    })

    let firstSignal: AbortSignal | null = null

    mocks.fetchCurrentManifest
      .mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
        firstSignal = signal ?? null
        return new Promise<CycleManifest>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(abortError), { once: true })
        })
      })
      .mockResolvedValueOnce(manifest)

    const { result } = renderHook(() => useManifest('manifests/gfs/latest.json'))

    await waitFor(() => {
      expect(mocks.fetchCurrentManifest).toHaveBeenCalledTimes(1)
    })

    act(() => {
      result.current.retry()
    })

    await waitFor(() => {
      expect(firstSignal?.aborted).toBe(true)
      expect(mocks.fetchCurrentManifest).toHaveBeenCalledTimes(2)
      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBeNull()
      expect(result.current.manifest).toEqual(manifest)
    })
  })
})
