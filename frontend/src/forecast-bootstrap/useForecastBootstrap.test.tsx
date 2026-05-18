import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAvailabilityIndexFixture,
  createFrameManifestFixture,
} from '../test/fixtures'
import { useForecastBootstrap } from './useForecastBootstrap'

const mocks = vi.hoisted(() => ({
  fetchAvailabilityIndex: vi.fn(),
}))

vi.mock('../forecast-availability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../forecast-availability')>()
  return {
    ...actual,
    fetchAvailabilityIndex: mocks.fetchAvailabilityIndex,
  }
})

describe('useForecastBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports loading while availability is loading', () => {
    mocks.fetchAvailabilityIndex.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useForecastBootstrap())

    expect(result.current).toMatchObject({
      phase: 'loading',
      data: null,
      error: null,
    })
  })

  it('reports availability errors with retry', async () => {
    mocks.fetchAvailabilityIndex
      .mockRejectedValueOnce(new Error('availability failed'))
      .mockReturnValueOnce(new Promise(() => {}))

    const { result } = renderHook(() => useForecastBootstrap())

    await waitFor(() => {
      expect(result.current.phase).toBe('error')
    })
    expect(result.current.error?.message).toBe('availability failed')
    act(() => {
      result.current.retry()
    })
    await waitFor(() => {
      expect(mocks.fetchAvailabilityIndex).toHaveBeenCalledTimes(2)
    })
    expect(result.current.phase).toBe('loading')
  })

  it('reports empty and latest-less availability indexes as startup errors', async () => {
    mocks.fetchAvailabilityIndex.mockResolvedValueOnce({
      ...createAvailabilityIndexFixture(),
      models: {},
    })
    const empty = renderHook(() => useForecastBootstrap())
    await waitFor(() => {
      expect(empty.result.current.phase).toBe('error')
    })
    expect(empty.result.current.error?.message).toBe('Forecast availability did not list any models.')
    empty.unmount()

    mocks.fetchAvailabilityIndex.mockResolvedValueOnce(createAvailabilityIndexFixture({
      gfsManifest: null,
      iconManifest: null,
    }))
    const noLatest = renderHook(() => useForecastBootstrap())
    await waitFor(() => {
      expect(noLatest.result.current.phase).toBe('error')
    })
    expect(noLatest.result.current.error?.message).toBe(
      'Forecast availability did not include latest render data for any model.'
    )
  })

  it('returns ready forecast data converted from the availability index', async () => {
    const availabilityIndex = createAvailabilityIndexFixture({
      gfsManifest: createFrameManifestFixture({
        model: { id: 'gfs', label: 'GFS' },
        cycle: '2026040900',
      }),
    })
    mocks.fetchAvailabilityIndex.mockResolvedValueOnce(availabilityIndex)

    const { result } = renderHook(() => useForecastBootstrap())

    await waitFor(() => {
      expect(result.current.phase).toBe('ready')
    })
    expect(result.current.data?.activeModelId).toBe('gfs')
    expect(result.current.data?.manifest.model).toEqual({ id: 'gfs', label: 'GFS' })
    expect(result.current.data?.manifest.artifacts.tmp_surface.frames['000']?.path)
      .toBe('fields/gfs/2026040900/000/tmp_surface.field.i16.bin')
  })

  it('switches models synchronously without fetching a model manifest', async () => {
    const availabilityIndex = createAvailabilityIndexFixture({
      gfsManifest: createFrameManifestFixture({
        model: { id: 'gfs', label: 'GFS' },
        cycle: '2026040900',
      }),
      iconManifest: createFrameManifestFixture({
        model: { id: 'icon', label: 'ICON' },
        cycle: '2026040912',
      }),
    })
    mocks.fetchAvailabilityIndex.mockResolvedValueOnce(availabilityIndex)

    const { result } = renderHook(() => useForecastBootstrap())
    await waitFor(() => {
      expect(result.current.data?.manifest.model.id).toBe('gfs')
    })

    act(() => {
      result.current.data?.setActiveModel('icon')
    })

    expect(result.current.phase).toBe('ready')
    expect(result.current.data?.activeModelId).toBe('icon')
    expect(result.current.data?.manifest.model).toEqual({ id: 'icon', label: 'ICON' })
    expect(result.current.data?.manifest.run.cycle).toBe('2026040912')
  })
})
