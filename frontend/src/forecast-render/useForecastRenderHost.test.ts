import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applyForecastRenderProfileData: vi.fn(),
  reconcileForecastRenderers: vi.fn(),
}))

vi.mock('./host', () => ({
  applyForecastRenderProfileData: (map: unknown, profile: unknown, data: unknown) => {
    mocks.applyForecastRenderProfileData(map, profile, data)
  },
  reconcileForecastRenderers: (map: unknown, profile: unknown) => {
    mocks.reconcileForecastRenderers(map, profile)
  },
}))

import { DEFAULT_FORECAST_RENDER_PROFILE, type ForecastRenderProfile } from './types'
import { useForecastRenderHost } from './useForecastRenderHost'

describe('useForecastRenderHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('waits for map readiness before installing renderers', () => {
    const map = {}
    const getMap = () => map as never
    const { result } = renderHook(() => useForecastRenderHost({
      getMap,
      mapReadyVersion: 0,
    }))

    expect(mocks.reconcileForecastRenderers).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('waits for a map instance before installing renderers', () => {
    const getMap = () => null
    const { result } = renderHook(() => useForecastRenderHost({
      getMap,
      mapReadyVersion: 1,
    }))

    expect(mocks.reconcileForecastRenderers).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('reconciles the default profile after map readiness and returns a render host', async () => {
    const map = {}
    const getMap = () => map as never
    const { result } = renderHook(() => useForecastRenderHost({
      getMap,
      mapReadyVersion: 1,
    }))

    await waitFor(() => {
      expect(mocks.reconcileForecastRenderers).toHaveBeenCalledWith(map, DEFAULT_FORECAST_RENDER_PROFILE)
      expect(result.current).toEqual({
        version: 1,
        apply: expect.any(Function),
      })
    })
  })

  it('applies render data through the reconciled profile', async () => {
    const map = {}
    const getMap = () => map as never
    const renderData = { field: { lower: { layerId: 'temperature' } } }
    const { result } = renderHook(() => useForecastRenderHost({
      getMap,
      mapReadyVersion: 1,
    }))

    await waitFor(() => {
      expect(result.current?.apply).toEqual(expect.any(Function))
    })

    result.current?.apply(renderData as never)

    expect(mocks.applyForecastRenderProfileData).toHaveBeenCalledWith(
      map,
      DEFAULT_FORECAST_RENDER_PROFILE,
      renderData,
    )
  })

  it('logs reconciliation errors and still returns a render host', async () => {
    const map = {}
    const getMap = () => map as never
    const error = new Error('webgl setup failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.reconcileForecastRenderers.mockImplementationOnce(() => {
      throw error
    })

    try {
      const { result } = renderHook(() => useForecastRenderHost({
        getMap,
        mapReadyVersion: 1,
      }))

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          '[forecast-render] renderer reconciliation failed',
          error,
        )
        expect(result.current).toEqual({
          version: 1,
          apply: expect.any(Function),
        })
      })
    } finally {
      consoleError.mockRestore()
    }
  })

  it('increments host version when map readiness advances', async () => {
    const map = {}
    const getMap = () => map as never
    const { result, rerender } = renderHook(
      ({ mapReadyVersion }) => useForecastRenderHost({
        getMap,
        mapReadyVersion,
      }),
      { initialProps: { mapReadyVersion: 1 } },
    )

    await waitFor(() => {
      expect(result.current).toEqual({
        version: 1,
        apply: expect.any(Function),
      })
    })

    rerender({ mapReadyVersion: 2 })

    await waitFor(() => {
      expect(mocks.reconcileForecastRenderers).toHaveBeenCalledTimes(2)
      expect(result.current).toEqual({
        version: 2,
        apply: expect.any(Function),
      })
    })
  })

  it('increments host version when the render profile changes', async () => {
    const map = {}
    const getMap = () => map as never
    const fieldOnlyProfile = {
      key: 'field-only',
      rendererIds: ['field'],
    } as const satisfies ForecastRenderProfile
    const { result, rerender } = renderHook(
      ({ profile }) => useForecastRenderHost({
        getMap,
        mapReadyVersion: 1,
        profile,
      }),
      { initialProps: { profile: DEFAULT_FORECAST_RENDER_PROFILE as ForecastRenderProfile } },
    )

    await waitFor(() => {
      expect(result.current?.version).toBe(1)
    })

    rerender({ profile: fieldOnlyProfile })

    await waitFor(() => {
      expect(mocks.reconcileForecastRenderers).toHaveBeenCalledTimes(2)
      expect(mocks.reconcileForecastRenderers).toHaveBeenLastCalledWith(map, fieldOnlyProfile)
      expect(result.current).toEqual({
        version: 2,
        apply: expect.any(Function),
      })
    })
  })

  it('increments host version when profile renderer ids change under the same key', async () => {
    const map = {}
    const getMap = () => map as never
    const defaultKeyProfile = {
      key: 'dynamic',
      rendererIds: ['field', 'particles'],
    } as const satisfies ForecastRenderProfile
    const fieldOnlyProfile = {
      key: 'dynamic',
      rendererIds: ['field'],
    } as const satisfies ForecastRenderProfile
    const { result, rerender } = renderHook(
      ({ profile }) => useForecastRenderHost({
        getMap,
        mapReadyVersion: 1,
        profile,
      }),
      { initialProps: { profile: defaultKeyProfile as ForecastRenderProfile } },
    )

    await waitFor(() => {
      expect(result.current?.version).toBe(1)
    })

    rerender({ profile: fieldOnlyProfile })

    await waitFor(() => {
      expect(mocks.reconcileForecastRenderers).toHaveBeenCalledTimes(2)
      expect(mocks.reconcileForecastRenderers).toHaveBeenLastCalledWith(map, fieldOnlyProfile)
      expect(result.current).toEqual({
        version: 2,
        apply: expect.any(Function),
      })
    })
  })
})
