import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  scalarRuntimeOptions,
  vectorRuntimeOptions,
} from '../../forecast-layers/options'
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

  it('updates scalar and vector runtime options from the options panel', () => {
    const previousScalarColorSamplingMode = scalarRuntimeOptions.colorSamplingMode
    const previousClearTrailsOnViewChange = vectorRuntimeOptions.clearTrailsOnViewChange
    scalarRuntimeOptions.colorSamplingMode = 'interpolated'
    vectorRuntimeOptions.clearTrailsOnViewChange = true

    try {
      render(
        <MapControlRail
          mapRef={{ current: createMapFixture() }}
          mapReadyVersion={1}
          playlistUrl={PLAYLIST_URL}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Map options' }))
      fireEvent.click(screen.getByRole('radio', { name: 'Banded' }))
      fireEvent.click(screen.getByRole('checkbox', { name: 'Clear trails on view change' }))

      expect(scalarRuntimeOptions.colorSamplingMode).toBe('banded')
      expect(vectorRuntimeOptions.clearTrailsOnViewChange).toBe(false)
    } finally {
      scalarRuntimeOptions.colorSamplingMode = previousScalarColorSamplingMode
      vectorRuntimeOptions.clearTrailsOnViewChange = previousClearTrailsOnViewChange
    }
  })
})
