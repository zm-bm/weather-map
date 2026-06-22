import { describe, expect, it, vi } from 'vitest'

import { createPlaceFeature } from './session.testFixtures'
import { searchBasemapPlaces } from './search'

describe('searchBasemapPlaces', () => {
  it('returns ranked place matches from the basemap source', () => {
    const map = {
      querySourceFeatures: vi.fn(() => [
        createPlaceFeature('Wichita Falls', -98.49, 33.91, { population: 102_000 }),
        createPlaceFeature('Wichita', -97.33, 37.69, { population: 397_000 }),
        createPlaceFeature('Kansas City', -94.58, 39.1, { population: 508_000 }),
      ]),
    }

    expect(searchBasemapPlaces(map as never, 'wich')).toEqual([
      expect.objectContaining({
        name: 'Wichita',
        lon: -97.33,
        lat: 37.69,
      }),
      expect.objectContaining({
        name: 'Wichita Falls',
      }),
    ])
  })

  it('returns no results for short queries or unavailable map sources', () => {
    expect(searchBasemapPlaces(null, 'w')).toEqual([])
    expect(searchBasemapPlaces({
      querySourceFeatures: vi.fn(() => {
        throw new Error('source does not exist')
      }),
    } as never, 'wich')).toEqual([])
  })
})
