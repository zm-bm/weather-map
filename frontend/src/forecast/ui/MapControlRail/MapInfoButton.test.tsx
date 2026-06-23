import { fireEvent, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import {
  createManifestFixture,
  createScalarArtifactFixture,
  renderWithForecastSelection,
} from '@/test/fixtures'
import MapInfoButton from './MapInfoButton'

function TestMapInfoButton({ initialOpen = false }: { initialOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(initialOpen)
  return <MapInfoButton isOpen={isOpen} onOpenChange={setIsOpen} />
}

describe('MapInfoButton', () => {
  it('opens the data information panel with selected layer and run details', () => {
    const manifest = createManifestFixture({
      artifacts: {
        tmp_surface: createScalarArtifactFixture({
          id: 'tmp_surface',
          source_interval_hours: 3,
        }),
      },
      frameIds: ['000', '006'],
    })

    renderWithForecastSelection(<TestMapInfoButton />, manifest)

    fireEvent.click(screen.getByRole('button', { name: 'Map information' }))

    expect(screen.getByRole('dialog', { name: 'About' })).toBeInTheDocument()
    expect(screen.getByText(/map-first forecast viewer for exploring public weather data/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'GitHub project' })).toHaveAttribute(
      'href',
      'https://github.com/zm-bm/weather-map'
    )
    expect(screen.getAllByText('Temperature').length).toBeGreaterThan(0)
    expect(screen.getByText('GFS / NOAA/NCEP')).toBeInTheDocument()
    expect(screen.getByText('Apr 13, 12Z')).toBeInTheDocument()
    expect(screen.getByText('Source interval is 3 hours.')).toBeInTheDocument()
    expect(screen.getByText(/Temperature maps show near-surface air temperature from GFS forecast guidance from NOAA\/NCEP/i)).toBeInTheDocument()
    expect(screen.getByText(/modified, interpolated, regridded, reformatted/i)).toBeInTheDocument()
  })

  it('dismisses the panel from close, Escape, and outside pointer actions', () => {
    const manifest = createManifestFixture()
    const view = renderWithForecastSelection(<TestMapInfoButton initialOpen />, manifest)

    fireEvent.click(screen.getByRole('button', { name: 'Close data information' }))
    expect(screen.queryByRole('dialog', { name: 'About' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Map information' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'About' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Map information' }))
    fireEvent.pointerDown(view.container)
    expect(screen.queryByRole('dialog', { name: 'About' })).not.toBeInTheDocument()
  })

  it('falls back to dataset labels when source metadata is unknown', () => {
    const manifest = createManifestFixture({
      dataset: { id: 'custom', label: 'Custom Model' },
    })

    renderWithForecastSelection(<TestMapInfoButton initialOpen />, manifest, 'custom')

    expect(screen.getAllByText('Custom Model').length).toBeGreaterThan(0)
    expect(screen.getByText('When a completed run is available.')).toBeInTheDocument()
    expect(screen.getByText(/Temperature maps show near-surface air temperature from Custom Model data/i)).toBeInTheDocument()
  })
})
