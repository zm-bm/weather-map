import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import config from '@/core/config'
import {
  DEFAULT_FORECAST_SETTINGS,
  ForecastSettingsProvider,
} from '@/forecast/settings'
import type { UseForecastSyncArgs, ForecastSyncInitialStatus } from '@/forecast/sync'
import {
  createMapFixture,
  createRasterWindowFixture,
} from '@/test/fixtures'
import {
  useForecastMapRuntime,
  type UseForecastMapRuntimeArgs,
} from './useForecastMapRuntime'

const RASTER_ONLY_RENDER_PROFILE = {
  layerIds: ['raster', 'overlay'],
}

const PARTICLES_ONLY_RENDER_PROFILE = {
  layerIds: ['raster', 'overlay', 'particles'],
}

const FULL_RENDER_PROFILE = {
  layerIds: ['raster', 'overlay', 'contour', 'particles'],
}
const FORECAST_SETTINGS_STORAGE_KEY = 'weather-map:forecast-settings:v1'

const DEFAULT_RENDER_SETTINGS = {
  raster: DEFAULT_FORECAST_SETTINGS.raster,
  particles: expect.objectContaining({
    particleCount: DEFAULT_FORECAST_SETTINGS.particles.particleCount,
  }),
}

const mocks = vi.hoisted(() => ({
  useMapLibre: vi.fn(),
  useForecastRenderHost: vi.fn(),
  useForecastSelectionContext: vi.fn(),
  useForecastSync: vi.fn(),
  useForecastBasemapTheme: vi.fn(),
}))

vi.mock('@/map/view/useMapLibre', () => ({
  useMapLibre: (args: unknown) => mocks.useMapLibre(args),
}))

vi.mock('@/forecast/render', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/forecast/render')>()
  return {
    ...actual,
    useForecastRenderHost: (args: unknown) => mocks.useForecastRenderHost(args),
  }
})

vi.mock('@/forecast/selection', () => ({
  useForecastSelectionContext: () => mocks.useForecastSelectionContext(),
}))

vi.mock('@/forecast/sync', () => ({
  useForecastSync: (args: unknown) => mocks.useForecastSync(args),
}))

vi.mock('@/map/view/useForecastBasemapTheme', () => ({
  useForecastBasemapTheme: (args: unknown) => mocks.useForecastBasemapTheme(args),
}))

function wrapper({ children }: { children: ReactNode }) {
  return <ForecastSettingsProvider>{children}</ForecastSettingsProvider>
}

function renderRuntime(args: UseForecastMapRuntimeArgs = {}) {
  return renderHook(() => useForecastMapRuntime(args), { wrapper })
}

function getLatestSyncArgs(): UseForecastSyncArgs {
  return mocks.useForecastSync.mock.calls.at(-1)?.[0] as UseForecastSyncArgs
}

function getLatestRenderHost() {
  return mocks.useForecastRenderHost.mock.results.at(-1)?.value
}

function createInitialSyncStatus(
  overrides: Partial<ForecastSyncInitialStatus> = {}
): ForecastSyncInitialStatus {
  return {
    phase: 'idle',
    errorMessage: null,
    retry: vi.fn(),
    ...overrides,
  }
}

describe('useForecastMapRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    const map = createMapFixture()
    const renderHost = { version: 4, apply: vi.fn() }

    mocks.useMapLibre.mockReturnValue({
      map,
      mapError: null,
      retryMap: vi.fn(),
    })
    mocks.useForecastRenderHost.mockReturnValue(renderHost)
    mocks.useForecastSelectionContext.mockReturnValue({
      selectedLayerId: 'temperature',
    })
    mocks.useForecastSync.mockReturnValue({
      initialStatus: createInitialSyncStatus(),
    })
  })

  it('wires map runtime hooks and forecast sync from the map instance', () => {
    const { result } = renderRuntime()
    const mapRuntime = mocks.useMapLibre.mock.results[0]?.value
    const renderHost = getLatestRenderHost()

    expect(mocks.useMapLibre).toHaveBeenCalledWith({
      containerId: 'map',
      center: [-100, 35],
      zoom: 3,
      minZoom: 2,
      maxZoom: 8.99,
    })
    expect(mocks.useForecastRenderHost).toHaveBeenCalledWith({
      map: mapRuntime.map,
      profile: PARTICLES_ONLY_RENDER_PROFILE,
      renderSettings: DEFAULT_RENDER_SETTINGS,
    })
    expect(mocks.useForecastBasemapTheme).toHaveBeenCalledWith({
      map: mapRuntime.map,
      selectedLayerId: 'temperature',
    })
    expect(mocks.useForecastSync).toHaveBeenCalledWith({
      renderHost,
      config,
      syncOptions: { contour: false, particles: true },
      onProbeFrameChange: expect.any(Function),
      onFieldLoadingChange: undefined,
    })
    expect(result.current).toEqual(expect.objectContaining({
      map: mapRuntime.map,
      probeFrameChannel: expect.objectContaining({
        getSnapshot: expect.any(Function),
        publish: expect.any(Function),
        subscribe: expect.any(Function),
      }),
    }))
  })

  it('forwards field loading changes to forecast sync', () => {
    const onFieldLoadingChange = vi.fn()

    renderRuntime({ onFieldLoadingChange })

    expect(getLatestSyncArgs().onFieldLoadingChange).toBe(onFieldLoadingChange)
  })

  it('reports initial sync status changes and clears them on unmount', () => {
    const onInitialSyncStatusChange = vi.fn()
    const initialStatus = createInitialSyncStatus({ phase: 'loading' })
    mocks.useForecastSync.mockReturnValue({
      initialStatus,
    })

    const { unmount } = renderRuntime({ onInitialSyncStatusChange })

    expect(onInitialSyncStatusChange).toHaveBeenCalledWith(initialStatus)

    onInitialSyncStatusChange.mockClear()
    unmount()

    expect(onInitialSyncStatusChange).toHaveBeenCalledWith(null)
  })

  it('reports map renderer startup errors through initial sync status', () => {
    const onInitialSyncStatusChange = vi.fn()
    const retryMap = vi.fn()
    mocks.useMapLibre.mockReturnValue({
      map: null,
      mapError: new Error('WebGL unavailable'),
      retryMap,
    })

    renderRuntime({ onInitialSyncStatusChange })

    expect(onInitialSyncStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: 'error',
      errorMessage: 'WebGL unavailable',
      retry: retryMap,
    }))
  })

  it('uses stored particle settings for the render profile and sync options', () => {
    mocks.useForecastSelectionContext.mockReturnValue({
      selectedLayerId: 'wind_speed',
    })
    localStorage.setItem(FORECAST_SETTINGS_STORAGE_KEY, JSON.stringify({
      particles: {
        enabled: false,
      },
    }))
    renderRuntime()

    expect(mocks.useForecastRenderHost).toHaveBeenLastCalledWith(expect.objectContaining({
      profile: RASTER_ONLY_RENDER_PROFILE,
    }))
    expect(mocks.useForecastSync).toHaveBeenLastCalledWith({
      renderHost: getLatestRenderHost(),
      config,
      syncOptions: { contour: false, particles: false },
      onProbeFrameChange: expect.any(Function),
      onFieldLoadingChange: undefined,
    })
  })

  it('uses stored pressure contour settings on non-pressure fields', () => {
    localStorage.setItem(FORECAST_SETTINGS_STORAGE_KEY, JSON.stringify({
      pressureContours: {
        enabled: true,
      },
    }))
    renderRuntime()

    expect(mocks.useForecastRenderHost).toHaveBeenLastCalledWith(expect.objectContaining({
      profile: FULL_RENDER_PROFILE,
    }))
    expect(mocks.useForecastSync).toHaveBeenLastCalledWith({
      renderHost: getLatestRenderHost(),
      config,
      syncOptions: { contour: true, particles: true },
      onProbeFrameChange: expect.any(Function),
      onFieldLoadingChange: undefined,
    })
  })

  it('uses stored renderer runtime settings without changing the render profile', () => {
    localStorage.setItem(FORECAST_SETTINGS_STORAGE_KEY, JSON.stringify({
      raster: {
        gridSamplingMode: 'nearest',
        colorSamplingMode: 'banded',
      },
    }))
    renderRuntime()

    expect(mocks.useForecastRenderHost).toHaveBeenLastCalledWith(expect.objectContaining({
      profile: PARTICLES_ONLY_RENDER_PROFILE,
      renderSettings: expect.objectContaining({
        raster: expect.objectContaining({
          gridSamplingMode: 'nearest',
          colorSamplingMode: 'banded',
        }),
      }),
    }))
  })

  it('passes a custom container id through to map initialization', () => {
    renderRuntime({ containerId: 'forecast-map' })

    expect(mocks.useMapLibre).toHaveBeenCalledWith(expect.objectContaining({
      containerId: 'forecast-map',
    }))
  })

  it('publishes sync probe frames into the place-probe channel', () => {
    const frame = createRasterWindowFixture()
    const { result } = renderRuntime()

    act(() => {
      getLatestSyncArgs().onProbeFrameChange?.(frame)
    })

    expect(result.current.probeFrameChannel.getSnapshot()).toBe(frame)
  })

  it('passes cloud layer selection to the basemap theme hook', () => {
    mocks.useForecastSelectionContext.mockReturnValue({
      selectedLayerId: 'cloud_layers',
    })

    renderRuntime()

    expect(mocks.useForecastBasemapTheme).toHaveBeenCalledWith(expect.objectContaining({
      selectedLayerId: 'cloud_layers',
    }))
  })
})
