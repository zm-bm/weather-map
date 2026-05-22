import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_FORECAST_SETTINGS,
  type ForecastSettingsActions,
} from '../../forecast-settings'
import { createMapFixture } from '../../test/fixtures'
import MapControlRail from './MapControlRail'

const PLAYLIST_URL = 'http://localhost:3000/radio/playlist.json'

describe('MapControlRail', () => {
  it('renders zoom controls and calls the map zoom methods', () => {
    const map = createMapFixture()

    render(
      <MapControlRail
        mapRef={{ current: map }}
        mapReadyVersion={1}
        playlistUrl={PLAYLIST_URL}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))

    expect(map.zoomIn).toHaveBeenCalledTimes(1)
    expect(map.zoomOut).toHaveBeenCalledTimes(1)
  })

  it('disables zoom controls while no map is available', () => {
    render(
      <MapControlRail
        mapRef={{ current: null }}
        mapReadyVersion={0}
        playlistUrl={PLAYLIST_URL}
      />
    )

    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
  })

  it('renders radio and options controls in the rail', () => {
    render(
      <MapControlRail
        mapRef={{ current: createMapFixture() }}
        mapReadyVersion={1}
        playlistUrl={PLAYLIST_URL}
      />
    )

    expect(screen.getByRole('button', { name: 'Play radio' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Map options' })).toBeInTheDocument()
  })

  it('requests render setting changes from the options panel', () => {
    const actions: ForecastSettingsActions = {
      updateField: vi.fn(),
      updateParticles: vi.fn(),
      updatePressureContours: vi.fn(),
    }

    render(
      <MapControlRail
        mapRef={{ current: createMapFixture() }}
        mapReadyVersion={1}
        playlistUrl={PLAYLIST_URL}
        settings={{
          ...DEFAULT_FORECAST_SETTINGS,
          field: {
            colorSamplingMode: 'interpolated',
          },
          pressureContours: {
            enabled: true,
          },
        }}
        settingsActions={actions}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Map options' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show pressure contours' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show particles' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Banded' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Clear trails on view change' }))

    expect(actions.updatePressureContours).toHaveBeenCalledWith({ enabled: false })
    expect(actions.updateParticles).toHaveBeenCalledWith({ enabled: false })
    expect(actions.updateField).toHaveBeenCalledWith({ colorSamplingMode: 'banded' })
    expect(actions.updateParticles).toHaveBeenCalledWith({ clearTrailsOnViewChange: false })
  })
})
