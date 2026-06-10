import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createMultiDatasetManifestFixture,
  createSingleTimeManifestFixture,
} from '@/test/fixtures'
import { useForecastManifest } from './useForecastManifest'

const mocks = vi.hoisted(() => ({
  fetchManifest: vi.fn(),
}))

vi.mock('./fetch', () => ({
  fetchManifest: mocks.fetchManifest,
}))

describe('useForecastManifest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports loading while the manifest index is loading', () => {
    mocks.fetchManifest.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useForecastManifest())

    expect(result.current).toMatchObject({
      phase: 'loading',
      data: null,
      error: null,
    })
  })

  it('reports manifest errors with retry', async () => {
    mocks.fetchManifest
      .mockRejectedValueOnce(new Error('manifest failed'))
      .mockReturnValueOnce(new Promise(() => {}))

    const { result } = renderHook(() => useForecastManifest())

    await waitFor(() => {
      expect(result.current.phase).toBe('error')
    })
    expect(result.current.error?.message).toBe('manifest failed')
    act(() => {
      result.current.retry()
    })
    await waitFor(() => {
      expect(mocks.fetchManifest).toHaveBeenCalledTimes(2)
    })
    expect(result.current.phase).toBe('loading')
  })

  it('reports empty and latest-less manifests as startup errors', async () => {
    mocks.fetchManifest.mockResolvedValueOnce({
      ...createMultiDatasetManifestFixture(),
      datasets: {},
    })
    const empty = renderHook(() => useForecastManifest())
    await waitFor(() => {
      expect(empty.result.current.phase).toBe('error')
    })
    expect(empty.result.current.error?.message).toBe('Manifest index did not list any datasets.')
    empty.unmount()

    mocks.fetchManifest.mockResolvedValueOnce(createMultiDatasetManifestFixture({
      gfsManifest: null,
      iconManifest: null,
    }))
    const noLatest = renderHook(() => useForecastManifest())
    await waitFor(() => {
      expect(noLatest.result.current.phase).toBe('error')
    })
    expect(noLatest.result.current.error?.message).toBe(
      'Manifest index did not include latest render data for any dataset.'
    )
  })

  it('returns ready forecast data from the manifest index', async () => {
    const manifest = createMultiDatasetManifestFixture({
      gfsManifest: createSingleTimeManifestFixture({
        dataset: { id: 'gfs', label: 'GFS' },
        cycle: '2026040900',
      }),
    })
    mocks.fetchManifest.mockResolvedValueOnce(manifest)

    const { result } = renderHook(() => useForecastManifest())

    await waitFor(() => {
      expect(result.current.phase).toBe('ready')
    })
    expect(result.current.data?.manifest).toBe(manifest)
    expect(result.current.data?.datasetOptions).toContainEqual({ id: 'gfs', label: 'GFS' })
  })

  it('keeps model selection outside of manifest loading', async () => {
    const manifest = createMultiDatasetManifestFixture({
      gfsManifest: createSingleTimeManifestFixture({
        dataset: { id: 'gfs', label: 'GFS' },
        cycle: '2026040900',
      }),
      iconManifest: createSingleTimeManifestFixture({
        dataset: { id: 'icon', label: 'ICON' },
        cycle: '2026040912',
      }),
    })
    mocks.fetchManifest.mockResolvedValueOnce(manifest)

    const { result } = renderHook(() => useForecastManifest())
    await waitFor(() => {
      expect(result.current.phase).toBe('ready')
    })

    expect(result.current.data?.manifest).toBe(manifest)
    expect(result.current.data?.datasetOptions).toEqual([
      { id: 'gfs', label: 'GFS' },
      { id: 'icon', label: 'ICON' },
    ])
    expect(mocks.fetchManifest).toHaveBeenCalledTimes(1)
  })
})
