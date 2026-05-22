import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applyForecastRenderProfileData: vi.fn(),
  configureForecastRenderers: vi.fn(),
  reconcileForecastRenderers: vi.fn(),
}))

vi.mock('./host', () => ({
  applyForecastRenderProfileData: (map: unknown, profile: unknown, data: unknown) => {
    mocks.applyForecastRenderProfileData(map, profile, data)
  },
  configureForecastRenderers: (map: unknown, profile: unknown, renderSettings: unknown) => {
    mocks.configureForecastRenderers(map, profile, renderSettings)
  },
  reconcileForecastRenderers: (map: unknown, profile: unknown, renderSettings: unknown) => {
    mocks.reconcileForecastRenderers(map, profile, renderSettings)
  },
}))

import {
  DEFAULT_FIELD_RENDER_SETTINGS,
  DEFAULT_PARTICLE_RENDER_SETTINGS,
  type ForecastRenderSettings,
} from '../forecast-settings/settings'
import type { ForecastRenderProfile } from './types'
import { useForecastRenderHost } from './useForecastRenderHost'

const DEFAULT_RENDER_SETTINGS: ForecastRenderSettings = {
  field: DEFAULT_FIELD_RENDER_SETTINGS,
  particles: DEFAULT_PARTICLE_RENDER_SETTINGS,
}
const DEFAULT_RENDER_PROFILE = {
  rendererIds: ['field', 'cloud-layers', 'field-overlay', 'particles'],
} as const satisfies ForecastRenderProfile

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
      profile: DEFAULT_RENDER_PROFILE,
      renderSettings: DEFAULT_RENDER_SETTINGS,
    }))

    expect(mocks.reconcileForecastRenderers).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('waits for a map instance before installing renderers', () => {
    const getMap = () => null
    const { result } = renderHook(() => useForecastRenderHost({
      getMap,
      mapReadyVersion: 1,
      profile: DEFAULT_RENDER_PROFILE,
      renderSettings: DEFAULT_RENDER_SETTINGS,
    }))

    expect(mocks.reconcileForecastRenderers).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('reconciles the requested profile after map readiness and returns a render host', async () => {
    const map = {}
    const getMap = () => map as never
    const { result } = renderHook(() => useForecastRenderHost({
      getMap,
      mapReadyVersion: 1,
      profile: DEFAULT_RENDER_PROFILE,
      renderSettings: DEFAULT_RENDER_SETTINGS,
    }))

    await waitFor(() => {
      expect(mocks.reconcileForecastRenderers).toHaveBeenCalledWith(
        map,
        DEFAULT_RENDER_PROFILE,
        DEFAULT_RENDER_SETTINGS,
      )
      expect(mocks.configureForecastRenderers).toHaveBeenCalledWith(
        map,
        DEFAULT_RENDER_PROFILE,
        DEFAULT_RENDER_SETTINGS,
      )
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
      profile: DEFAULT_RENDER_PROFILE,
      renderSettings: DEFAULT_RENDER_SETTINGS,
    }))

    await waitFor(() => {
      expect(result.current?.apply).toEqual(expect.any(Function))
    })

    result.current?.apply(renderData as never)

    expect(mocks.applyForecastRenderProfileData).toHaveBeenCalledWith(
      map,
      DEFAULT_RENDER_PROFILE,
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
        profile: DEFAULT_RENDER_PROFILE,
        renderSettings: DEFAULT_RENDER_SETTINGS,
      }))

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          '[forecast-render] renderer update failed',
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
        profile: DEFAULT_RENDER_PROFILE,
        renderSettings: DEFAULT_RENDER_SETTINGS,
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
      rendererIds: ['field', 'field-overlay', 'contour-overlay'],
    } as const satisfies ForecastRenderProfile
    const { result, rerender } = renderHook(
      ({ profile }) => useForecastRenderHost({
        getMap,
        mapReadyVersion: 1,
        profile,
        renderSettings: DEFAULT_RENDER_SETTINGS,
      }),
      { initialProps: { profile: DEFAULT_RENDER_PROFILE as ForecastRenderProfile } },
    )

    await waitFor(() => {
      expect(result.current?.version).toBe(1)
    })

    rerender({ profile: fieldOnlyProfile })

    await waitFor(() => {
      expect(mocks.reconcileForecastRenderers).toHaveBeenCalledTimes(2)
      expect(mocks.reconcileForecastRenderers).toHaveBeenLastCalledWith(
        map,
        fieldOnlyProfile,
        DEFAULT_RENDER_SETTINGS,
      )
      expect(result.current).toEqual({
        version: 2,
        apply: expect.any(Function),
      })
    })
  })

  it('applies render settings changes without reconciling renderers or incrementing host version', async () => {
    const map = {}
    const getMap = () => map as never
    const nextRenderSettings: ForecastRenderSettings = {
      field: { colorSamplingMode: 'interpolated' },
      particles: {
        ...DEFAULT_PARTICLE_RENDER_SETTINGS,
        clearTrailsOnViewChange: false,
      },
    }
    const { result, rerender } = renderHook(
      ({ renderSettings }) => useForecastRenderHost({
        getMap,
        mapReadyVersion: 1,
        profile: DEFAULT_RENDER_PROFILE,
        renderSettings,
      }),
      { initialProps: { renderSettings: DEFAULT_RENDER_SETTINGS } },
    )

    await waitFor(() => {
      expect(result.current?.version).toBe(1)
    })

    rerender({ renderSettings: nextRenderSettings })

    await waitFor(() => {
      expect(mocks.configureForecastRenderers).toHaveBeenLastCalledWith(
        map,
        DEFAULT_RENDER_PROFILE,
        nextRenderSettings,
      )
    })
    expect(mocks.reconcileForecastRenderers).toHaveBeenCalledTimes(1)
    expect(result.current).toEqual({
      version: 1,
      apply: expect.any(Function),
    })
  })
})
