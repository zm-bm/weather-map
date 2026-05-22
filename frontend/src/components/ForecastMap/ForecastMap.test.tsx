import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import config from '../../config'
import { createMapFixture } from '../../test/fixtures'
import ForecastMap from './ForecastMap'

const FULL_RENDER_PROFILE = {
  key: 'field-cloud-layers-contours-particles',
  rendererIds: ['field', 'cloud-layers', 'field-overlay', 'contour-overlay', 'particles'],
}

const FIELD_ONLY_RENDER_PROFILE = {
  key: 'field-cloud-layers-no-contours-no-particles',
  rendererIds: ['field', 'cloud-layers', 'field-overlay'],
}

const PARTICLES_ONLY_RENDER_PROFILE = {
  key: 'field-cloud-layers-no-contours-particles',
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

vi.mock('../../map/useMap', () => ({
  useMap: (args: unknown) => mocks.useMap(args),
}))

vi.mock('../../forecast-render', () => ({
  DEFAULT_FORECAST_RENDER_PROFILE: {
    key: 'default',
    rendererIds: ['field', 'cloud-layers', 'field-overlay', 'particles'],
  },
  useForecastRenderHost: (args: unknown) => mocks.useForecastRenderHost(args),
}))

vi.mock('../../forecast-selection', () => ({
  useForecastSelectionContext: () => mocks.useForecastSelectionContext(),
}))

vi.mock('../../forecast-sync', () => ({
  useForecastSync: (args: unknown) => mocks.useForecastSync(args),
}))

vi.mock('../../map/view/useForecastBasemapTheme', () => ({
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

describe('ForecastMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const map = createMapFixture()
    const mapRef = { current: map }
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
  })

  it('wires map runtime hooks and forecast sync from the map instance', () => {
    render(<ForecastMap />)

    const { mapRef, getMap, mapReadyVersion } = mocks.useMap.mock.results[0]?.value as {
      mapRef: { current: ReturnType<typeof createMapFixture> }
      getMap: () => ReturnType<typeof createMapFixture>
      mapReadyVersion: number
    }
    const renderHost = mocks.useForecastRenderHost.mock.results[0]?.value

    expect(mocks.useMap).toHaveBeenCalledWith({
      containerId: 'map',
    })
    expect(mocks.useForecastRenderHost).toHaveBeenCalledWith({
      getMap,
      mapReadyVersion,
      profile: PARTICLES_ONLY_RENDER_PROFILE,
    })
    expect(mocks.useForecastBasemapTheme).toHaveBeenCalledWith({
      getMap,
      mapReadyVersion,
      selectedLayerId: 'temperature',
    })
    expect(mocks.useForecastSync).toHaveBeenCalledWith({
      renderHost,
      config,
      pressureContoursEnabled: false,
    })
    expect(mocks.ForecastPlaceProbes).toHaveBeenCalledWith({
      mapRef,
      mapReadyVersion,
    })
    expect(mocks.MapControlRail).toHaveBeenCalledWith({
      mapRef,
      mapReadyVersion,
      particlesEnabled: true,
      pressureContoursEnabled: false,
      onParticlesEnabledChange: expect.any(Function),
      onPressureContoursEnabledChange: expect.any(Function),
    })
  })

  it('updates the render profile when particles are toggled off', () => {
    render(<ForecastMap />)

    const controlProps = mocks.MapControlRail.mock.calls[0]?.[0] as {
      onParticlesEnabledChange: (nextValue: boolean) => void
    }

    act(() => {
      controlProps.onParticlesEnabledChange(false)
    })

    expect(mocks.useForecastRenderHost).toHaveBeenLastCalledWith(expect.objectContaining({
      profile: FIELD_ONLY_RENDER_PROFILE,
    }))
    expect(mocks.MapControlRail).toHaveBeenLastCalledWith(expect.objectContaining({
      particlesEnabled: false,
    }))
    const renderHostResults = mocks.useForecastRenderHost.mock.results
    expect(mocks.useForecastSync).toHaveBeenLastCalledWith({
      renderHost: renderHostResults[renderHostResults.length - 1]?.value,
      config,
      pressureContoursEnabled: false,
    })
  })

  it('updates the render profile and sync option when pressure contours are toggled on', () => {
    render(<ForecastMap />)

    const controlProps = mocks.MapControlRail.mock.calls[0]?.[0] as {
      onPressureContoursEnabledChange: (nextValue: boolean) => void
    }

    act(() => {
      controlProps.onPressureContoursEnabledChange(true)
    })

    expect(mocks.useForecastRenderHost).toHaveBeenLastCalledWith(expect.objectContaining({
      profile: FULL_RENDER_PROFILE,
    }))
    expect(mocks.MapControlRail).toHaveBeenLastCalledWith(expect.objectContaining({
      pressureContoursEnabled: true,
    }))
    const renderHostResults = mocks.useForecastRenderHost.mock.results
    expect(mocks.useForecastSync).toHaveBeenLastCalledWith({
      renderHost: renderHostResults[renderHostResults.length - 1]?.value,
      config,
      pressureContoursEnabled: true,
    })
  })

  it('passes a custom container id through to map initialization', () => {
    render(<ForecastMap containerId="forecast-map" />)

    expect(mocks.useMap).toHaveBeenCalledWith(expect.objectContaining({
      containerId: 'forecast-map',
    }))
  })

  it('passes cloud layer selection to the basemap theme hook', () => {
    mocks.useForecastSelectionContext.mockReturnValue({
      selectedLayerId: 'cloud_layers',
    })

    render(<ForecastMap />)

    expect(mocks.useForecastBasemapTheme).toHaveBeenCalledWith(expect.objectContaining({
      selectedLayerId: 'cloud_layers',
    }))
  })
})
