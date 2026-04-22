import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import config from '../../config'
import { MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM, MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '../../map/config'
import { createMapFixture } from '../../test/fixtures'
import ForecastMap from './ForecastMap'

const mocks = vi.hoisted(() => ({
  useMapLibre: vi.fn(),
  useMapHover: vi.fn(),
  useMapClickProbe: vi.fn(),
  useMapControls: vi.fn(),
  useForecastSync: vi.fn(),
}))

vi.mock('../../hooks/useMapLibre', () => ({
  useMapLibre: (args: unknown) => mocks.useMapLibre(args),
}))

vi.mock('../../hooks/useMapHover', () => ({
  useMapHover: (mapRef: unknown) => mocks.useMapHover(mapRef),
}))

vi.mock('../../map-probe/useMapClickProbe', () => ({
  useMapClickProbe: (mapRef: unknown) => mocks.useMapClickProbe(mapRef),
}))

vi.mock('../../hooks/useMapControls', () => ({
  useMapControls: (mapRef: unknown, mapReadyVersion: unknown) => {
    mocks.useMapControls(mapRef, mapReadyVersion)
  },
}))

vi.mock('../../forecast-sync', () => ({
  useForecastSync: (args: unknown) => mocks.useForecastSync(args),
}))

describe('ForecastMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const map = createMapFixture()
    const mapRef = { current: map }
    const getMap = () => map

    mocks.useMapLibre.mockReturnValue({
      mapRef,
      getMap,
      mapReadyVersion: 1,
    })
  })

  it('wires map runtime hooks and forecast sync from the map instance', () => {
    render(<ForecastMap />)

    const { mapRef, getMap, mapReadyVersion } = mocks.useMapLibre.mock.results[0]?.value as {
      mapRef: { current: ReturnType<typeof createMapFixture> }
      getMap: () => ReturnType<typeof createMapFixture>
      mapReadyVersion: number
    }

    expect(mocks.useMapLibre).toHaveBeenCalledWith({
      config,
      containerId: 'map',
      center: MAP_DEFAULT_CENTER,
      zoom: MAP_DEFAULT_ZOOM,
      minZoom: MAP_MIN_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
    })
    expect(mocks.useMapHover).toHaveBeenCalledWith(mapRef)
    expect(mocks.useMapClickProbe).toHaveBeenCalledWith(mapRef)
    expect(mocks.useMapControls).toHaveBeenCalledWith(mapRef, mapReadyVersion)
    expect(mocks.useForecastSync).toHaveBeenCalledWith({
      getMap,
      mapReadyVersion,
      config,
    })
  })

  it('passes a custom container id through to map initialization', () => {
    render(<ForecastMap containerId="forecast-map" />)

    expect(mocks.useMapLibre).toHaveBeenCalledWith(expect.objectContaining({
      containerId: 'forecast-map',
    }))
  })
})
