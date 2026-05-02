import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import config from '../../config'
import { createMapFixture } from '../../test/fixtures'
import ForecastMap from './ForecastMap'

const mocks = vi.hoisted(() => ({
  useMap: vi.fn(),
  useForecastSync: vi.fn(),
  ForecastPlaceProbes: vi.fn(),
  MapControlRail: vi.fn(),
}))

vi.mock('../../map/useMap', () => ({
  useMap: (args: unknown) => mocks.useMap(args),
}))

vi.mock('../../forecast-sync', () => ({
  useForecastSync: (args: unknown) => mocks.useForecastSync(args),
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

    mocks.useMap.mockReturnValue({
      mapRef,
      getMap,
      mapReadyVersion: 1,
    })
  })

  it('wires map runtime hooks and forecast sync from the map instance', () => {
    render(<ForecastMap />)

    const { mapRef, getMap, mapReadyVersion } = mocks.useMap.mock.results[0]?.value as {
      mapRef: { current: ReturnType<typeof createMapFixture> }
      getMap: () => ReturnType<typeof createMapFixture>
      mapReadyVersion: number
    }

    expect(mocks.useMap).toHaveBeenCalledWith({
      containerId: 'map',
    })
    expect(mocks.useForecastSync).toHaveBeenCalledWith({
      getMap,
      mapReadyVersion,
      config,
    })
    expect(mocks.ForecastPlaceProbes).toHaveBeenCalledWith({
      mapRef,
      mapReadyVersion,
    })
    expect(mocks.MapControlRail).toHaveBeenCalledWith({
      mapRef,
      mapReadyVersion,
    })
  })

  it('passes a custom container id through to map initialization', () => {
    render(<ForecastMap containerId="forecast-map" />)

    expect(mocks.useMap).toHaveBeenCalledWith(expect.objectContaining({
      containerId: 'forecast-map',
    }))
  })
})
