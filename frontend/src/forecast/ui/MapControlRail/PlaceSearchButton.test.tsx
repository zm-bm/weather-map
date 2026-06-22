import { fireEvent, render, screen } from '@testing-library/react'
import type { MapGeoJSONFeature } from 'maplibre-gl'
import type { ComponentProps } from 'react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMapFixture } from '@/test/fixtures'
import PlaceSearchButton from './PlaceSearchButton'

function createPlaceFeature(
  name: string,
  lon: number,
  lat: number,
  options: { population?: number } = {},
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
      population: options.population,
    },
  } as unknown as MapGeoJSONFeature
}

function TestPlaceSearchButton(
  props: Omit<ComponentProps<typeof PlaceSearchButton>, 'isOpen' | 'onOpenChange'>
) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <PlaceSearchButton
      {...props}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
    />
  )
}

describe('PlaceSearchButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens place search and flies to the selected result', () => {
    const map = createMapFixture()
    const onPlaceSelect = vi.fn()
    map.querySourceFeatures.mockReturnValue([
      createPlaceFeature('Wichita', -97.33, 37.69, { population: 397_000 }),
      createPlaceFeature('Kansas City', -94.58, 39.1, { population: 508_000 }),
    ])

    render(
      <TestPlaceSearchButton
        map={map}
        onPlaceSelect={onPlaceSelect}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Search places' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find Place' }), {
      target: { value: 'wich' },
    })
    expect(screen.getByRole('button', { name: /Wichita/ })).toHaveTextContent('37.69N 97.33W')
    fireEvent.click(screen.getByRole('button', { name: /Wichita/ }))

    expect(map.flyTo).toHaveBeenCalledWith({
      center: [-97.33, 37.69],
      zoom: 6,
      essential: true,
    })
    expect(onPlaceSelect).toHaveBeenCalledWith({ lon: -97.33, lat: 37.69 })
    expect(screen.getByRole('button', { name: 'Search places' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('submits the first matching place result', () => {
    const map = createMapFixture()
    const onPlaceSelect = vi.fn()
    map.querySourceFeatures.mockReturnValue([
      createPlaceFeature('Wichita', -97.33, 37.69, { population: 397_000 }),
      createPlaceFeature('Winfield', -96.99, 37.24, { population: 12_000 }),
    ])

    render(
      <TestPlaceSearchButton
        map={map}
        onPlaceSelect={onPlaceSelect}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Search places' }))
    const searchbox = screen.getByRole('searchbox', { name: 'Find Place' })
    fireEvent.change(searchbox, {
      target: { value: 'wi' },
    })

    fireEvent.submit(screen.getByRole('search', { name: 'Search places' }))

    expect(map.flyTo).toHaveBeenCalledWith({
      center: [-97.33, 37.69],
      zoom: 6,
      essential: true,
    })
    expect(onPlaceSelect).toHaveBeenCalledWith({ lon: -97.33, lat: 37.69 })
    expect(screen.getByRole('button', { name: 'Search places' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('uses product copy for empty place-search states', () => {
    const map = createMapFixture()
    map.querySourceFeatures.mockReturnValue([])

    render(
      <TestPlaceSearchButton
        map={map}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Search places' }))

    const searchbox = screen.getByRole('searchbox', { name: 'Find Place' })
    expect(searchbox).toHaveAttribute('placeholder', 'City or place')
    expect(screen.getByText('Type to search map places')).toBeInTheDocument()

    fireEvent.change(searchbox, {
      target: { value: 'zz' },
    })

    expect(screen.getByText('No place matches')).toBeInTheDocument()
  })

  it('is disabled while no map is available', () => {
    render(
      <TestPlaceSearchButton
        map={null}
      />
    )

    expect(screen.getByRole('button', { name: 'Search places' })).toBeDisabled()
  })

})
