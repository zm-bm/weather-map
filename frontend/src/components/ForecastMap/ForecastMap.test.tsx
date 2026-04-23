import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import config from '../../config'
import { createMapFixture } from '../../test/fixtures'
import ForecastMap from './ForecastMap'

const mocks = vi.hoisted(() => ({
  useMap: vi.fn(),
  useMapClick: vi.fn(),
  useForecastSync: vi.fn(),
}))

vi.mock('../../map/useMap', () => ({
  useMap: (args: unknown) => mocks.useMap(args),
}))

vi.mock('../../map/interactions/useMapClick', () => ({
  useMapClick: (mapRef: unknown) => mocks.useMapClick(mapRef),
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
    expect(mocks.useMapClick).toHaveBeenCalledWith(mapRef)
    expect(mocks.useForecastSync).toHaveBeenCalledWith({
      getMap,
      mapReadyVersion,
      config,
    })
  })

  it('passes a custom container id through to map initialization', () => {
    render(<ForecastMap containerId="forecast-map" />)

    expect(mocks.useMap).toHaveBeenCalledWith(expect.objectContaining({
      containerId: 'forecast-map',
    }))
  })
})
