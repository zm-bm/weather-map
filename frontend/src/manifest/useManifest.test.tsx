import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CycleManifest } from './types'
import { createManifestFixture } from '../test/fixtures'
import { useManifest } from './useManifest'

const mocks = vi.hoisted(() => ({
  fetchCurrentManifest: vi.fn(),
}))

vi.mock('./client', () => ({
  fetchCurrentManifest: mocks.fetchCurrentManifest,
}))

describe('useManifest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces a single error state when no manifest is returned', async () => {
    mocks.fetchCurrentManifest.mockResolvedValue(null as unknown as CycleManifest)

    const { result } = renderHook(() => useManifest())

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

    const { result } = renderHook(() => useManifest())

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
    expect(mocks.fetchCurrentManifest).toHaveBeenCalledWith(expect.anything())
  })
})
