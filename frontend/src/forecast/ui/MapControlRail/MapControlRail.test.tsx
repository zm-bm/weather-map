import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ForecastSettingsProvider,
} from '@/forecast/settings'
import { createMapFixture } from '@/test/fixtures'
import MapControlRail, { type MapControlRailProps } from './MapControlRail'

const PLAYLIST_URL = 'http://localhost:3000/radio/playlist.json'

function renderRail(props: Partial<MapControlRailProps> = {}) {
  const railProps = {
    map: createMapFixture(),
    playlistUrl: PLAYLIST_URL,
    ...props,
  }

  if ('activePanel' in props || props.onActivePanelChange) {
    return render(
      <ForecastSettingsProvider>
        <MapControlRail
          {...railProps}
          activePanel={props.activePanel ?? null}
          onActivePanelChange={props.onActivePanelChange ?? vi.fn()}
        />
      </ForecastSettingsProvider>
    )
  }

  function ControlledRail() {
    const [activePanel, setActivePanel] = useState<MapControlRailProps['activePanel']>(null)
    return (
      <MapControlRail
        {...railProps}
        activePanel={activePanel}
        onActivePanelChange={setActivePanel}
      />
    )
  }

  return render(
    <ForecastSettingsProvider>
      <ControlledRail />
    </ForecastSettingsProvider>
  )
}

function renderControlledRail(props: MapControlRailProps) {
  return render(
    <ForecastSettingsProvider>
      <MapControlRail
        {...props}
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

  it('keeps information and weather radio in the primary tools group', () => {
    renderRail()

    const tools = screen.getByLabelText('Map tools')

    expect(within(tools).getByRole('button', { name: 'Map information' })).toBeEnabled()
    expect(within(tools).getByRole('button', { name: 'Play weather radio' })).toBeInTheDocument()
  })

  it('opens display options from the tools group', () => {
    renderRail()

    fireEvent.click(screen.getByRole('button', { name: 'Map display options' }))

    expect(screen.getByLabelText('Map controls: tools and navigation')).toBeInTheDocument()
    expect(screen.getByLabelText('Map tools')).toBeInTheDocument()
    expect(screen.getByText('Display Options')).toBeInTheDocument()
  })

  it('keeps rail task panels mutually exclusive', () => {
    renderRail()

    const searchButton = screen.getByRole('button', { name: 'Search places' })
    const optionsButton = screen.getByRole('button', { name: 'Map display options' })

    fireEvent.click(searchButton)
    expect(searchButton).toHaveAttribute('aria-expanded', 'true')
    expect(optionsButton).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(optionsButton)
    expect(searchButton).toHaveAttribute('aria-expanded', 'false')
    expect(optionsButton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(searchButton)
    expect(searchButton).toHaveAttribute('aria-expanded', 'true')
    expect(optionsButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('can be controlled by active panel identity', () => {
    const onActivePanelChange = vi.fn()
    const baseProps = {
      map: createMapFixture(),
      playlistUrl: PLAYLIST_URL,
      onActivePanelChange,
    }
    const { rerender } = renderControlledRail({
      ...baseProps,
      activePanel: null,
    })

    const searchButton = screen.getByRole('button', { name: 'Search places' })
    const optionsButton = screen.getByRole('button', { name: 'Map display options' })

    expect(searchButton).toHaveAttribute('aria-expanded', 'false')
    expect(optionsButton).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(searchButton)
    expect(onActivePanelChange).toHaveBeenLastCalledWith('search')

    rerender(
      <ForecastSettingsProvider>
        <MapControlRail
          {...baseProps}
          activePanel="search"
        />
      </ForecastSettingsProvider>
    )
    expect(searchButton).toHaveAttribute('aria-expanded', 'true')
    expect(optionsButton).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(optionsButton)
    expect(onActivePanelChange).toHaveBeenLastCalledWith('options')
  })
})
