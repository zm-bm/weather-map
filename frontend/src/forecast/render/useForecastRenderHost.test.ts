import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applyWindows: vi.fn(),
  configureProfile: vi.fn(),
  reconcileProfile: vi.fn(),
}))

vi.mock('./registry', () => ({
  applyWindows: (map: unknown, profile: unknown, windows: unknown) => {
    mocks.applyWindows(map, profile, windows)
  },
  configureProfile: (map: unknown, profile: unknown, renderSettings: unknown) => {
    mocks.configureProfile(map, profile, renderSettings)
  },
  reconcileProfile: (map: unknown, profile: unknown, renderSettings: unknown) => {
    mocks.reconcileProfile(map, profile, renderSettings)
  },
}))

import {
  DEFAULT_PARTICLE_RENDER_SETTINGS,
  type ForecastRenderSettings,
} from '@/forecast/settings/settings'
import {
  createForecastWindowsFixture,
  createRenderLayerMapFixture,
  createRenderSettingsFixture,
} from '@/test/fixtures'
import type { ForecastRenderProfile } from './profile'
import { useForecastRenderHost } from './useForecastRenderHost'

const DEFAULT_RENDER_SETTINGS: ForecastRenderSettings = createRenderSettingsFixture()
const DEFAULT_RENDER_PROFILE = {
  layerIds: ['raster', 'overlay', 'particles'],
} as const satisfies ForecastRenderProfile

function createRenderHostMapFixture() {
  return createRenderLayerMapFixture()
}

type RenderHostHookArgs = Parameters<typeof useForecastRenderHost>[0]

function renderHostHook(overrides: Partial<RenderHostHookArgs> = {}) {
  const args: RenderHostHookArgs = {
    map: createRenderHostMapFixture(),
    profile: DEFAULT_RENDER_PROFILE,
    renderSettings: DEFAULT_RENDER_SETTINGS,
    ...overrides,
  }

  return {
    ...renderHook((nextArgs: Partial<RenderHostHookArgs> = {}) => (
      useForecastRenderHost({ ...args, ...nextArgs })
    )),
    map: args.map,
  }
}

describe('useForecastRenderHost', () => {
  beforeEach(() => {
    mocks.applyWindows.mockReset()
    mocks.configureProfile.mockReset()
    mocks.reconcileProfile.mockReset()
  })

  it('waits for a map instance before installing renderers', () => {
    const { result } = renderHostHook({
      map: null,
    })

    expect(mocks.reconcileProfile).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('reconciles the requested profile after map readiness and returns a render host', async () => {
    const { map, result } = renderHostHook()

    await waitFor(() => {
      expect(mocks.reconcileProfile).toHaveBeenCalledWith(
        map,
        DEFAULT_RENDER_PROFILE,
        DEFAULT_RENDER_SETTINGS,
      )
      expect(mocks.configureProfile).toHaveBeenCalledWith(
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

  it('applies forecast windows through the reconciled profile', async () => {
    const windows = createForecastWindowsFixture()
    const { map, result } = renderHostHook()

    await waitFor(() => {
      expect(result.current?.apply).toEqual(expect.any(Function))
    })

    result.current?.apply(windows)

    expect(mocks.applyWindows).toHaveBeenCalledWith(
      map,
      DEFAULT_RENDER_PROFILE,
      windows,
    )
  })

  it('logs reconciliation errors and leaves the host unavailable', async () => {
    const error = new Error('webgl setup failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.reconcileProfile.mockImplementationOnce(() => {
      throw error
    })

    try {
      const { result } = renderHostHook()

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          '[forecast-render] renderer update failed',
          error,
        )
        expect(result.current).toBeNull()
      })
    } finally {
      consoleError.mockRestore()
    }
  })

  it('retries profile reconciliation after an install failure', async () => {
    const error = new Error('webgl setup failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.reconcileProfile.mockImplementationOnce(() => {
      throw error
    })

    try {
      const { result, rerender } = renderHostHook()

      await waitFor(() => {
        expect(result.current).toBeNull()
      })

      rerender({ map: createRenderHostMapFixture() })

      await waitFor(() => {
        expect(mocks.reconcileProfile).toHaveBeenCalledTimes(2)
        expect(result.current).toEqual({
          version: 1,
          apply: expect.any(Function),
        })
      })
    } finally {
      consoleError.mockRestore()
    }
  })

  it('increments host version when the map instance changes', async () => {
    const { result, rerender } = renderHostHook()

    await waitFor(() => {
      expect(result.current).toEqual({
        version: 1,
        apply: expect.any(Function),
      })
    })

    rerender({ map: createRenderHostMapFixture() })

    await waitFor(() => {
      expect(mocks.reconcileProfile).toHaveBeenCalledTimes(2)
      expect(result.current).toEqual({
        version: 2,
        apply: expect.any(Function),
      })
    })
  })

  it('increments host version when the render profile changes', async () => {
    const rasterOnlyProfile = {
      layerIds: ['raster', 'overlay', 'contour'],
    } as const satisfies ForecastRenderProfile
    const { map, result, rerender } = renderHostHook()

    await waitFor(() => {
      expect(result.current?.version).toBe(1)
    })

    rerender({ profile: rasterOnlyProfile })

    await waitFor(() => {
      expect(mocks.reconcileProfile).toHaveBeenCalledTimes(2)
      expect(mocks.reconcileProfile).toHaveBeenLastCalledWith(
        map,
        rasterOnlyProfile,
        DEFAULT_RENDER_SETTINGS,
      )
      expect(result.current).toEqual({
        version: 2,
        apply: expect.any(Function),
      })
    })
  })

  it('preserves the previous host when a later profile reconciliation fails', async () => {
    const nextProfile = {
      layerIds: ['raster', 'overlay', 'contour'],
    } as const satisfies ForecastRenderProfile
    const error = new Error('layer install failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { result, rerender } = renderHostHook()

    await waitFor(() => {
      expect(result.current?.version).toBe(1)
    })
    const previousHost = result.current
    mocks.reconcileProfile.mockImplementationOnce(() => {
      throw error
    })

    try {
      rerender({ profile: nextProfile })

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          '[forecast-render] renderer update failed',
          error,
        )
      })
      expect(result.current).toBe(previousHost)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('applies render settings changes without reconciling renderers or incrementing host version', async () => {
    const nextRenderSettings: ForecastRenderSettings = {
      raster: { gridSamplingMode: 'nearest', colorSamplingMode: 'banded', opacity: 0.75 },
      particles: {
        ...DEFAULT_PARTICLE_RENDER_SETTINGS,
        clearTrailsOnViewChange: false,
      },
    }
    const { map, result, rerender } = renderHostHook()

    await waitFor(() => {
      expect(result.current?.version).toBe(1)
    })

    rerender({ renderSettings: nextRenderSettings })

    await waitFor(() => {
      expect(mocks.configureProfile).toHaveBeenLastCalledWith(
        map,
        DEFAULT_RENDER_PROFILE,
        nextRenderSettings,
      )
    })
    expect(mocks.reconcileProfile).toHaveBeenCalledTimes(1)
    expect(result.current).toEqual({
      version: 1,
      apply: expect.any(Function),
    })
  })

  it('logs settings configuration errors without reconciling renderers or incrementing host version', async () => {
    const error = new Error('settings update failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const nextRenderSettings: ForecastRenderSettings = {
      raster: { gridSamplingMode: 'nearest', colorSamplingMode: 'banded', opacity: 0.75 },
      particles: DEFAULT_PARTICLE_RENDER_SETTINGS,
    }
    const { result, rerender } = renderHostHook()

    await waitFor(() => {
      expect(result.current?.version).toBe(1)
    })
    mocks.configureProfile.mockImplementationOnce(() => {
      throw error
    })

    try {
      rerender({ renderSettings: nextRenderSettings })

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          '[forecast-render] renderer update failed',
          error,
        )
      })
      expect(mocks.reconcileProfile).toHaveBeenCalledTimes(1)
      expect(result.current).toEqual({
        version: 1,
        apply: expect.any(Function),
      })
    } finally {
      consoleError.mockRestore()
    }
  })
})
