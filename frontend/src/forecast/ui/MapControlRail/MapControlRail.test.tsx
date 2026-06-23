import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ForecastSettingsProvider,
} from '@/forecast/settings'
import { createMapFixture } from '@/test/fixtures'
import MapControlRail, { type MapControlRailProps } from './MapControlRail'

function renderRail(props: Partial<MapControlRailProps> = {}) {
  return render(
    <ForecastSettingsProvider>
      <MapControlRail
        map={'map' in props ? props.map ?? null : createMapFixture()}
        geolocation={props.geolocation}
        onMapPointSelect={props.onMapPointSelect}
        activePanel={props.activePanel ?? null}
        onActivePanelChange={props.onActivePanelChange ?? vi.fn()}
      />
    </ForecastSettingsProvider>
  )
}

describe('MapControlRail', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders zoom controls and calls the map zoom methods', () => {
    const map = createMapFixture()

    renderRail({ map })

    const navigation = screen.getByLabelText('Map navigation')
    expect(within(navigation).getByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
    expect(within(navigation).getByRole('button', { name: 'Zoom out' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))

    expect(map.zoomIn).toHaveBeenCalledTimes(1)
    expect(map.zoomOut).toHaveBeenCalledTimes(1)
  })

  it('uses browser location to center the map', () => {
    const map = createMapFixture()
    const onMapPointSelect = vi.fn()
    const geolocation = {
      getCurrentPosition: vi.fn((onSuccess: PositionCallback) => {
        onSuccess({
          coords: {
            latitude: 38.5,
            longitude: -97.5,
          },
        } as GeolocationPosition)
      }),
    }

    renderRail({
      map,
      geolocation,
      onMapPointSelect,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Show your location' }))

    expect(geolocation.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      {
        enableHighAccuracy: false,
        maximumAge: 60_000,
        timeout: 8_000,
      }
    )
    expect(map.flyTo).toHaveBeenCalledWith({
      center: [-97.5, 38.5],
      zoom: 7,
      essential: true,
    })
    expect(onMapPointSelect).toHaveBeenCalledWith({ lon: -97.5, lat: 38.5 })
  })

  it('shows a location error state when geolocation fails', () => {
    const geolocation = {
      getCurrentPosition: vi.fn((
        _onSuccess: PositionCallback,
        onError?: PositionErrorCallback,
      ) => {
        onError?.({} as GeolocationPositionError)
      }),
    }

    renderRail({ geolocation })

    fireEvent.click(screen.getByRole('button', { name: 'Show your location' }))

    expect(screen.getByRole('button', { name: 'Location unavailable' })).toBeEnabled()
  })

  it('disables zoom controls while no map is available', () => {
    renderRail({
      map: null,
    })

    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Location unavailable' })).toBeDisabled()
  })

  it('keeps information in the primary tools group', () => {
    renderRail()

    const tools = screen.getByLabelText('Map tools')

    expect(within(tools).getByRole('button', { name: 'Map information' })).toBeEnabled()
  })

  it('requests rail panel changes from tool buttons', () => {
    const onActivePanelChange = vi.fn()
    renderRail({ onActivePanelChange })

    const searchButton = screen.getByRole('button', { name: 'Search places' })
    const optionsButton = screen.getByRole('button', { name: 'Map display options' })

    fireEvent.click(searchButton)
    expect(onActivePanelChange).toHaveBeenLastCalledWith('search')

    fireEvent.click(optionsButton)
    expect(onActivePanelChange).toHaveBeenLastCalledWith('options')
  })

  it('requests closing the active rail panel', () => {
    const onActivePanelChange = vi.fn()
    renderRail({
      activePanel: 'search',
      onActivePanelChange,
    })

    const searchButton = screen.getByRole('button', { name: 'Search places' })
    const optionsButton = screen.getByRole('button', { name: 'Map display options' })

    expect(searchButton).toHaveAttribute('aria-expanded', 'true')
    expect(optionsButton).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(searchButton)
    expect(onActivePanelChange).toHaveBeenLastCalledWith(null)
  })
})
