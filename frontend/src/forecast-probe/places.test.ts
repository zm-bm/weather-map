import type { MapGeoJSONFeature } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'

import { forecastProbePlaces } from './index'

function createPlaceFeature(
  name: string,
  lon: number,
  lat: number,
  options: {
    capital?: 'yes'
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
      kind: 'locality',
      capital: options.capital,
      population: options.population,
      population_rank: options.populationRank,
    },
  } as unknown as MapGeoJSONFeature
}

describe('forecastProbePlaces.selectVisible', () => {
  it('shows places only above the zoom threshold', () => {
    const features = [
      createPlaceFeature('Capital', -92, 42, { capital: 'yes', population: 200_000 }),
      createPlaceFeature('Metro', -91, 41, { population: 1_000_000 }),
      createPlaceFeature('Mid', -90, 40, { population: 500_000 }),
      createPlaceFeature('Small', -89, 39, { population: 10_000 }),
    ]

    expect(forecastProbePlaces.selectVisible(features, { zoom: 3.49 })).toEqual([])
    expect(forecastProbePlaces.selectVisible(features, { zoom: 3.5 })).toEqual([])
    expect(forecastProbePlaces.selectVisible(features, { zoom: 3.51 }).map((place) => place.name)).toEqual([
      'Capital',
      'Metro',
      'Mid',
      'Small',
    ])
  })

  it('prioritizes capitals, then major labels, and applies the requested limit', () => {
    const selected = forecastProbePlaces.selectVisible([
      createPlaceFeature('Small', -90, 40, { population: 10_000 }),
      createPlaceFeature('Metro', -91, 41, { population: 1_000_000 }),
      createPlaceFeature('Capital', -92, 42, { capital: 'yes', population: 200_000 }),
      ...Array.from({ length: 70 }, (_entry, index) => (
        createPlaceFeature(`Rank 5 ${index}`, -80 + index, 35, {
          populationRank: index + 1,
        })
      )),
    ], { zoom: 4, limit: 12 })

    expect(selected).toHaveLength(12)
    expect(selected.slice(0, 3).map((place) => place.name)).toEqual(['Capital', 'Metro', 'Rank 5 0'])
    expect(selected.map((place) => place.sortKey)).toEqual(selected.map((_place, index) => index))
  })

  it('keeps a stable core of top places, then fills empty screen cells', () => {
    const selected = forecastProbePlaces.selectVisible([
      createPlaceFeature('Dense 1', 10, 10, { population: 5_000_000 }),
      createPlaceFeature('Dense 2', 20, 12, { population: 4_000_000 }),
      createPlaceFeature('Dense 3', 30, 14, { population: 3_000_000 }),
      createPlaceFeature('Sparse West', 240, 10, { population: 500_000 }),
      createPlaceFeature('Sparse East', 480, 10, { population: 400_000 }),
    ], {
      zoom: 4,
      limit: 4,
      cellSizePx: 120,
      minSpacingPx: 80,
      project: (point) => ({ x: point.lon, y: point.lat }),
    })

    expect(selected.map((place) => place.name)).toEqual([
      'Dense 1',
      'Dense 2',
      'Sparse West',
      'Sparse East',
    ])
  })

  it('uses spread slots only after the stable core', () => {
    const selected = forecastProbePlaces.selectVisible([
      createPlaceFeature('Metro 1', 10, 10, { population: 5_000_000 }),
      createPlaceFeature('Metro 2', 50, 10, { population: 4_000_000 }),
      createPlaceFeature('Metro 3', 300, 10, { population: 3_000_000 }),
      createPlaceFeature('Metro 4', 500, 10, { population: 2_000_000 }),
    ], {
      zoom: 4,
      limit: 4,
      cellSizePx: 200,
      minSpacingPx: 60,
      project: (point) => ({ x: point.lon, y: point.lat }),
    })

    expect(selected.map((place) => place.name)).toEqual(['Metro 1', 'Metro 2', 'Metro 3', 'Metro 4'])
  })

  it('dedupes repeated source-tile features by name and rounded coordinates', () => {
    const selected = forecastProbePlaces.selectVisible([
      createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 }),
      createPlaceFeature('Chicago', -87.62501, 41.87501, { population: 2_700_000 }),
    ], { zoom: 4 })

    expect(selected).toHaveLength(1)
  })

  it('uses name properties instead of relying on promoted source ids', () => {
    const feature = createPlaceFeature('Chicago', -87.625, 41.875, { population: 2_700_000 })
    feature.id = 123

    expect(forecastProbePlaces.selectVisible([feature], { zoom: 4 }).map((place) => place.name)).toEqual(['Chicago'])
  })
})
