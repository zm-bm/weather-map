import type { MapGeoJSONFeature } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'

import { selectVisiblePlaceProbes } from './places'
import type { PlaceProbeBounds, PlaceProbeViewportSize } from './places'

function createPlaceFeature(
  name: string,
  lon: number,
  lat: number,
  options: {
    capital?: 'yes'
    nameEn?: string
    population?: number
    populationRank?: number
  } = {}
): MapGeoJSONFeature {
  return {
    id: name,
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [lon, lat],
    },
    properties: {
      name,
      'name:en': options.nameEn,
      kind: 'locality',
      capital: options.capital,
      population: options.population,
      population_rank: options.populationRank,
    },
  } as unknown as MapGeoJSONFeature
}

function createBounds(
  west: number,
  east: number,
  south: number,
  north: number,
): PlaceProbeBounds {
  return {
    contains: ([lon, lat]) => (
      lon >= west &&
      lon <= east &&
      lat >= south &&
      lat <= north
    ),
    getWest: () => west,
    getEast: () => east,
    getSouth: () => south,
    getNorth: () => north,
  }
}

function createRankedPlaceFeatures(count: number): MapGeoJSONFeature[] {
  return Array.from({ length: count }, (_entry, index) => (
    createPlaceFeature(`Rank ${index}`, index % 20, Math.floor(index / 20), {
      populationRank: index + 1,
    })
  ))
}

function expectSequentialSortKeys(places: Array<{ sortKey: number }>): void {
  expect(places.map((place) => place.sortKey)).toEqual(places.map((_place, index) => index))
}

const smallViewport: PlaceProbeViewportSize = { width: 390, height: 844 }
const largeViewport: PlaceProbeViewportSize = { width: 1920, height: 1080 }

describe('selectVisiblePlaceProbes', () => {
  it('shows place tiers progressively by zoom', () => {
    const features = [
      createPlaceFeature('Capital', -92, 42, { capital: 'yes', population: 200_000 }),
      createPlaceFeature('Metro', -91, 41, { population: 1_000_000 }),
      createPlaceFeature('Mid', -90, 40, { population: 500_000 }),
      createPlaceFeature('Small', -89, 39, { population: 10_000 }),
    ]

    expect(selectVisiblePlaceProbes(features, { zoom: 2.79 })).toEqual([])
    expect(selectVisiblePlaceProbes(features, { zoom: 2.81 }).map((place) => place.name)).toEqual([
      'Capital',
      'Metro',
    ])
    expect(selectVisiblePlaceProbes(features, { zoom: 4.25 }).map((place) => place.name)).toEqual([
      'Capital',
      'Metro',
      'Mid',
    ])
    expect(selectVisiblePlaceProbes(features, { zoom: 5.25 }).map((place) => place.name)).toEqual([
      'Capital',
      'Metro',
      'Mid',
      'Small',
    ])
  })

  it('prioritizes capitals, then major labels, and applies the default limit', () => {
    const selected = selectVisiblePlaceProbes([
      createPlaceFeature('Small', -90, 40, { population: 10_000 }),
      createPlaceFeature('Metro', -91, 41, { population: 1_000_000 }),
      createPlaceFeature('Capital', -92, 42, { capital: 'yes', population: 200_000 }),
      ...Array.from({ length: 70 }, (_entry, index) => (
        createPlaceFeature(`Rank 5 ${index}`, -80 + index, 35, {
          populationRank: index + 1,
        })
      )),
    ], { zoom: 5.25 })

    expect(selected).toHaveLength(30)
    expect(selected.slice(0, 3).map((place) => place.name)).toEqual(['Capital', 'Metro', 'Rank 5 0'])
    expectSequentialSortKeys(selected)
  })

  it('keeps the default limit on small screens', () => {
    const selected = selectVisiblePlaceProbes(createRankedPlaceFeatures(80), {
      zoom: 5.25,
      bounds: createBounds(-1, 20, -1, 4),
      viewportSize: smallViewport,
    })

    expect(selected).toHaveLength(30)
  })

  it('allows more labels on large screens up to the cap', () => {
    const selected = selectVisiblePlaceProbes(createRankedPlaceFeatures(80), {
      zoom: 5.25,
      bounds: createBounds(-1, 20, -1, 4),
      viewportSize: largeViewport,
    })

    expect(selected).toHaveLength(72)
  })

  it('keeps spread selection stable when the viewport bounds pan slightly', () => {
    const features = [
      ...Array.from({ length: 24 }, (_entry, index) => (
        createPlaceFeature(`Cluster ${index}`, 2 + index * 0.01, 2 + index * 0.01, {
          populationRank: index + 1,
        })
      )),
      createPlaceFeature('West', 4, 8, { populationRank: 30 }),
      createPlaceFeature('East', 8, 8, { populationRank: 31 }),
    ]
    const options = {
      zoom: 5.25,
      viewportSize: { width: 1024, height: 768 },
    }

    const initial = selectVisiblePlaceProbes(features, {
      ...options,
      bounds: createBounds(0, 10, 0, 10),
    })
    const panned = selectVisiblePlaceProbes(features, {
      ...options,
      bounds: createBounds(0.4, 10.4, 0, 10),
    })

    expect(panned.map((place) => place.name)).toEqual(initial.map((place) => place.name))
  })

  it('keeps valid previous labels before filling new spread slots', () => {
    const initial = selectVisiblePlaceProbes([
      createPlaceFeature('Sticky', 5, 5, { populationRank: 10 }),
    ], {
      zoom: 5.25,
      bounds: createBounds(0, 10, 0, 10),
      viewportSize: { width: 1024, height: 768 },
    })

    const selected = selectVisiblePlaceProbes([
      createPlaceFeature('New Top', 5.2, 5.2, { capital: 'yes', population: 1_000_000 }),
      createPlaceFeature('Sticky', 5, 5, { populationRank: 10 }),
    ], {
      zoom: 5.25,
      bounds: createBounds(0, 10, 0, 10),
      viewportSize: { width: 1024, height: 768 },
      previousPlaces: initial,
    })

    expect(selected.map((place) => place.name)).toEqual(['Sticky', 'New Top'])
  })

  it('spreads labels beyond a dense ranked cluster when bounds and screen size are available', () => {
    const selected = selectVisiblePlaceProbes([
      ...Array.from({ length: 35 }, (_entry, index) => (
        createPlaceFeature(`Cluster ${index}`, 1 + index * 0.001, 1 + index * 0.001, {
          populationRank: index + 1,
        })
      )),
      ...Array.from({ length: 5 }, (_entry, index) => (
        createPlaceFeature(`Remote ${index}`, 3 + index * 1.5, 8, {
          populationRank: index + 36,
        })
      )),
    ], {
      zoom: 5.25,
      bounds: createBounds(0, 10, 0, 10),
      viewportSize: { width: 1024, height: 768 },
    })

    expect(selected.slice(0, 6).map((place) => place.name)).toContain('Remote 0')
    expect(selected).toHaveLength(30)
  })

  it('uses relaxed next-tier candidates to fill empty spread cells', () => {
    const selected = selectVisiblePlaceProbes([
      createPlaceFeature('Metro', 1, 1, { population: 1_000_000 }),
      createPlaceFeature('Mid Plains', 8, 8, { population: 500_000 }),
      createPlaceFeature('Small', 9, 9, { population: 10_000 }),
    ], {
      zoom: 4.13,
      bounds: createBounds(0, 10, 0, 10),
      viewportSize: { width: 1024, height: 768 },
    })

    expect(selected.map((place) => place.name)).toEqual(['Metro', 'Mid Plains'])
  })

  it('does not use relaxed candidates in cells already filled by strict candidates', () => {
    const selected = selectVisiblePlaceProbes([
      createPlaceFeature('Metro', 1, 1, { population: 1_000_000 }),
      createPlaceFeature('Mid Same Cell', 1.1, 1, { population: 500_000 }),
      createPlaceFeature('Mid Remote', 8, 8, { population: 500_000 }),
    ], {
      zoom: 4.13,
      bounds: createBounds(0, 10, 0, 10),
      viewportSize: { width: 1024, height: 768 },
    })

    expect(selected.map((place) => place.name)).toEqual(['Metro', 'Mid Remote'])
  })

  it('retains previous labels only once per spread cell before filling empty cells', () => {
    const features = [
      createPlaceFeature('Previous A', 1, 1, { population: 1_000_000 }),
      createPlaceFeature('Previous B', 1.1, 1, { population: 900_000 }),
      createPlaceFeature('Remote', 8, 8, { population: 800_000 }),
    ]
    const previousPlaces = selectVisiblePlaceProbes(features, { zoom: 5.25 })
    const selected = selectVisiblePlaceProbes(features, {
      zoom: 5.25,
      bounds: createBounds(0, 10, 0, 10),
      viewportSize: { width: 1024, height: 768 },
      previousPlaces,
    })

    expect(selected.map((place) => place.name)).toEqual(['Previous A', 'Remote', 'Previous B'])
  })

  it('uses visible grid bounds instead of padded candidate bounds for spread cells', () => {
    const features = [
      ...Array.from({ length: 35 }, (_entry, index) => (
        createPlaceFeature(`Cluster ${index}`, 0.9 + index * 0.001, 5, {
          populationRank: index + 1,
        })
      )),
      createPlaceFeature('Visible Grid Slot', 1.1, 5, { populationRank: 60 }),
    ]
    const baseOptions = {
      zoom: 5.25,
      bounds: createBounds(0, 12, 0, 10),
      viewportSize: { width: 1024, height: 768 },
    }

    expect(selectVisiblePlaceProbes(features, baseOptions).map((place) => place.name)).not.toContain(
      'Visible Grid Slot',
    )
    expect(selectVisiblePlaceProbes(features, {
      ...baseOptions,
      gridBounds: createBounds(0, 6, 0, 10),
    }).map((place) => place.name)).toContain('Visible Grid Slot')
  })

  it('dedupes repeated source-tile features by name and rounded coordinates', () => {
    const selected = selectVisiblePlaceProbes([
      createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 }),
      createPlaceFeature('Chicago', -87.62501, 41.87501, { population: 2_700_000 }),
    ], { zoom: 4 })

    expect(selected).toHaveLength(1)
  })

  it('uses name properties instead of relying on promoted source ids', () => {
    const feature = createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })
    feature.id = 123

    expect(selectVisiblePlaceProbes([feature], { zoom: 4 }).map((place) => place.name)).toEqual(['Chicago'])
  })

  it('preserves non-latin local names when using English display names', () => {
    const selected = selectVisiblePlaceProbes([
      createPlaceFeature('東京', 139.69, 35.68, {
        nameEn: 'Tokyo',
        population: 14_000_000,
      }),
    ], { zoom: 4 })

    expect(selected[0]).toMatchObject({
      name: 'Tokyo',
      localName: '東京',
    })
  })
})
