import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import config from '@/core/config'
import {
  DEFAULT_FORECAST_SETTINGS,
  type ForecastSettingsActions,
  ForecastSettingsProvider,
} from '@/forecast/settings'
import type { ForecastPlaceProbeFrameChannel } from '@/forecast/place-probes'
import type { UseForecastSyncArgs, ForecastSyncInitialStatus } from '@/forecast/sync'
import {
  createFieldWindowFixture,
  createMapFixture,
  createMapRefFixture,
} from '@/test/fixtures'
import type { MapControlRailProps } from '../MapControlRail'
import ForecastMap from './ForecastMap'

const FULL_RENDER_PROFILE = {
  rendererIds: ['field', 'cloud-layers', 'field-overlay', 'contour-overlay', 'particles'],
}

const FIELD_ONLY_RENDER_PROFILE = {
  rendererIds: ['field', 'cloud-layers', 'field-overlay'],
}

const PARTICLES_ONLY_RENDER_PROFILE = {
  rendererIds: ['field', 'cloud-layers', 'field-overlay', 'particles'],
}

const mocks = vi.hoisted(() => ({
  useMap: vi.fn(),
  useForecastRenderHost: vi.fn(),
  useForecastSelectionContext: vi.fn(),
  useForecastSync: vi.fn(),
  useForecastBasemapTheme: vi.fn(),
  ForecastPlaceProbes: vi.fn(),
  MapControlRail: vi.fn(),
}))

vi.mock('@/map/useMap', () => ({
  useMap: (args: unknown) => mocks.useMap(args),
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

vi.mock('../ForecastPlaceProbes', () => ({
  default: (props: unknown) => {
    mocks.ForecastPlaceProbes(props)
    return <div data-testid="forecast-place-probes" />
  },
}))

vi.mock('../MapControlRail', () => ({
  default: (props: unknown) => {
    mocks.MapControlRail(props)
    return <div data-testid="map-control-rail" />
  },
}))

const DEFAULT_RENDER_SETTINGS = {
  field: DEFAULT_FORECAST_SETTINGS.field,
  particles: expect.objectContaining({
    clearTrailsOnViewChange: true,
    particleCount: DEFAULT_FORECAST_SETTINGS.particles.particleCount,
  }),
}

type MapRuntimeFixture = {
  mapRef: ReturnType<typeof createMapRefFixture>
  getMap: () => ReturnType<typeof createMapFixture>
  mapReadyVersion: number
}

type PlaceProbeProps = {
  mapRef: MapRuntimeFixture['mapRef']
  mapReadyVersion: number
  probeFrameChannel: ForecastPlaceProbeFrameChannel
  initialFrame?: unknown
}

function renderForecastMap(ui = <ForecastMap />) {
  return render(
    <ForecastSettingsProvider>
      {ui}
    </ForecastSettingsProvider>
  )
}

function getMapRuntime(): MapRuntimeFixture {
  return mocks.useMap.mock.results[0]?.value as MapRuntimeFixture
}

function getLatestControlProps(): MapControlRailProps {
  return mocks.MapControlRail.mock.calls.at(-1)?.[0] as MapControlRailProps
}

function getLatestPlaceProbeProps(): PlaceProbeProps {
  return mocks.ForecastPlaceProbes.mock.calls.at(-1)?.[0] as PlaceProbeProps
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

describe('ForecastMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const map = createMapFixture()
    const mapRef = createMapRefFixture(map)
    const getMap = () => map
    const renderHost = { version: 4, apply: vi.fn() }

    mocks.useMap.mockReturnValue({
      mapRef,
      getMap,
      mapReadyVersion: 1,
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
    renderForecastMap()

    const { mapRef, getMap, mapReadyVersion } = getMapRuntime()
    const renderHost = getLatestRenderHost()

    expect(mocks.useMap).toHaveBeenCalledWith({
      containerId: 'map',
    })
    expect(mocks.useForecastRenderHost).toHaveBeenCalledWith({
      getMap,
      mapReadyVersion,
      profile: PARTICLES_ONLY_RENDER_PROFILE,
      renderSettings: DEFAULT_RENDER_SETTINGS,
    })
    expect(mocks.useForecastBasemapTheme).toHaveBeenCalledWith({
      getMap,
      mapReadyVersion,
      selectedLayerId: 'temperature',
    })
    expect(mocks.useForecastSync).toHaveBeenCalledWith({
      renderHost,
      config,
      dataOptions: { pressure: false, windVectors: true },
      onProbeFrameChange: expect.any(Function),
    })
    const placeProbeProps = getLatestPlaceProbeProps()
    expect(placeProbeProps).toEqual({
      mapRef,
      mapReadyVersion,
      probeFrameChannel: expect.objectContaining({
        getSnapshot: expect.any(Function),
        publish: expect.any(Function),
        subscribe: expect.any(Function),
      }),
    })
    expect(placeProbeProps).not.toHaveProperty('initialFrame')
    expect(mocks.MapControlRail).toHaveBeenCalledWith({
      mapRef,
      mapReadyVersion,
      settings: DEFAULT_FORECAST_SETTINGS,
      settingsActions: expect.objectContaining({
        updateField: expect.any(Function),
        updateParticles: expect.any(Function),
        updatePressureContours: expect.any(Function),
      }),
    })
  })

  it('reports initial sync status changes and clears them on unmount', () => {
    const onInitialSyncStatusChange = vi.fn()
    const initialStatus = createInitialSyncStatus({ phase: 'loading' })
    mocks.useForecastSync.mockReturnValue({
      initialStatus,
    })

    const { unmount } = renderForecastMap(
      <ForecastMap onInitialSyncStatusChange={onInitialSyncStatusChange} />
    )

    expect(onInitialSyncStatusChange).toHaveBeenCalledWith(initialStatus)

    onInitialSyncStatusChange.mockClear()
    unmount()

    expect(onInitialSyncStatusChange).toHaveBeenCalledWith(null)
  })

  it('updates the render profile when particles are toggled off', () => {
    renderForecastMap()

    const controlProps = getLatestControlProps()

    act(() => {
      controlProps.settingsActions?.updateParticles({ enabled: false })
    })

    expect(mocks.useForecastRenderHost).toHaveBeenLastCalledWith(expect.objectContaining({
      profile: FIELD_ONLY_RENDER_PROFILE,
    }))
    expect(mocks.MapControlRail).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({
        particles: expect.objectContaining({ enabled: false }),
      }),
    }))
    expect(mocks.useForecastSync).toHaveBeenLastCalledWith({
      renderHost: getLatestRenderHost(),
      config,
      dataOptions: { pressure: false, windVectors: false },
      onProbeFrameChange: expect.any(Function),
    })
  })

  it('updates the render profile and sync option when pressure contours are toggled on', () => {
    renderForecastMap()

    const controlProps = getLatestControlProps()

    act(() => {
      controlProps.settingsActions?.updatePressureContours({ enabled: true })
    })

    expect(mocks.useForecastRenderHost).toHaveBeenLastCalledWith(expect.objectContaining({
      profile: FULL_RENDER_PROFILE,
    }))
    expect(mocks.MapControlRail).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({
        pressureContours: { enabled: true },
      }),
    }))
    expect(mocks.useForecastSync).toHaveBeenLastCalledWith({
      renderHost: getLatestRenderHost(),
      config,
      dataOptions: { pressure: true, windVectors: true },
      onProbeFrameChange: expect.any(Function),
    })
  })

  it('updates renderer runtime settings without changing the render profile', () => {
    renderForecastMap()

    const controlProps = getLatestControlProps()
    const settingsActions = controlProps.settingsActions as ForecastSettingsActions

    act(() => {
      settingsActions.updateField({ colorSamplingMode: 'interpolated' })
    })

    expect(mocks.useForecastRenderHost).toHaveBeenLastCalledWith(expect.objectContaining({
      profile: PARTICLES_ONLY_RENDER_PROFILE,
      renderSettings: {
        field: { colorSamplingMode: 'interpolated' },
        particles: expect.objectContaining({ clearTrailsOnViewChange: true }),
      },
    }))
    expect(mocks.MapControlRail).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({
        field: { colorSamplingMode: 'interpolated' },
      }),
    }))

    const latestControlProps = getLatestControlProps()
    const latestSettingsActions = latestControlProps.settingsActions as ForecastSettingsActions
    act(() => {
      latestSettingsActions.updateParticles({ clearTrailsOnViewChange: false })
    })

    expect(mocks.useForecastRenderHost).toHaveBeenLastCalledWith(expect.objectContaining({
      profile: PARTICLES_ONLY_RENDER_PROFILE,
      renderSettings: {
        field: { colorSamplingMode: 'interpolated' },
        particles: expect.objectContaining({ clearTrailsOnViewChange: false }),
      },
    }))
    expect(mocks.MapControlRail).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({
        particles: expect.objectContaining({ clearTrailsOnViewChange: false }),
      }),
    }))
  })

  it('passes a custom container id through to map initialization', () => {
    renderForecastMap(<ForecastMap containerId="forecast-map" />)

    expect(mocks.useMap).toHaveBeenCalledWith(expect.objectContaining({
      containerId: 'forecast-map',
    }))
  })

  it('publishes sync probe frames into the place-probe channel', () => {
    const frame = createFieldWindowFixture()

    renderForecastMap()

    const syncArgs = getLatestSyncArgs()
    const placeProbeProps = getLatestPlaceProbeProps()

    act(() => {
      syncArgs.onProbeFrameChange?.(frame)
    })

    expect(placeProbeProps.probeFrameChannel.getSnapshot()).toBe(frame)
  })

  it('passes cloud layer selection to the basemap theme hook', () => {
    mocks.useForecastSelectionContext.mockReturnValue({
      selectedLayerId: 'cloud_layers',
    })

    renderForecastMap()

    expect(mocks.useForecastBasemapTheme).toHaveBeenCalledWith(expect.objectContaining({
      selectedLayerId: 'cloud_layers',
    }))
  })
})
