import { fireEvent, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  createLayerDatasetAvailabilityFixture,
  createManifestFixture,
  createScalarArtifactFixture,
  createVectorArtifactFixture,
  renderWithForecastSelection,
} from '@/test/fixtures'
import WeatherCategoryBar from './WeatherCategoryBar'

function createModeManifest() {
  return createManifestFixture({
    cycle: '2026041118',
    scalarArtifactIds: ['tmp_surface', 'rh_surface'],
    vectorArtifactIds: [],
    artifacts: {
      tmp_surface: createScalarArtifactFixture(),
      rh_surface: createScalarArtifactFixture({
        units: '%',
        parameter: 'rh',
      }),
    },
  })
}

function createCategoryManifest() {
  return createManifestFixture({
    cycle: '2026041118',
    scalarArtifactIds: ['tmp_surface', 'aptmp_surface', 'gust_surface', 'prmsl_msl'],
    vectorArtifactIds: ['wind10m_uv'],
    artifacts: {
      tmp_surface: createScalarArtifactFixture(),
      aptmp_surface: createScalarArtifactFixture({
        parameter: 'aptmp',
      }),
      gust_surface: createScalarArtifactFixture({
        id: 'gust_surface',
        parameter: 'gust',
      }),
      prmsl_msl: createScalarArtifactFixture({
        id: 'prmsl_msl',
        units: 'Pa',
        parameter: 'prmsl',
      }),
      wind10m_uv: createVectorArtifactFixture({
        components: ['u', 'v'],
      }),
    },
  })
}

function weatherMapsToggle(): HTMLButtonElement {
  return within(screen.getByRole('region', { name: 'Weather maps' }))
    .getByRole('button', { name: 'Weather maps' }) as HTMLButtonElement
}

function selectedFieldLabel(): string | null {
  return weatherMapsToggle().querySelector('.weather-category-bar__summary-field')?.textContent ?? null
}

function openWeatherMapsMenu() {
  fireEvent.click(weatherMapsToggle())
}

function TestWeatherCategoryBar({ initialOpen = false }: { initialOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(initialOpen)
  return <WeatherCategoryBar isOpen={isOpen} onOpenChange={setIsOpen} />
}

describe('WeatherCategoryBar', () => {
  it('shows the active category and field in a compact collapsed header', () => {
    renderWithForecastSelection(
      <TestWeatherCategoryBar />,
      createCategoryManifest(),
      { selectedLayerId: 'apparent_temperature' }
    )

    const toggle = weatherMapsToggle()
    expect(toggle).toHaveAccessibleName('Weather maps')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle.querySelector('.weather-category-bar__toggle-icon svg')).toBeInTheDocument()
    expect(within(toggle).getByText('Temperature')).toBeInTheDocument()
    expect(within(toggle).getByText('Apparent Temperature')).toBeInTheDocument()
  })

  it('switches to the first available field in a weather category', () => {
    renderWithForecastSelection(<TestWeatherCategoryBar />, createModeManifest())

    openWeatherMapsMenu()

    expect(screen.getByRole('button', { name: 'Temperature' }))
      .toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Humidity' }))

    expect(screen.getByRole('button', { name: 'Temperature' }))
      .toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Humidity' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('marks unavailable weather categories without relying only on opacity', () => {
    renderWithForecastSelection(<TestWeatherCategoryBar />, createModeManifest())

    openWeatherMapsMenu()

    const windPressure = screen.getByRole('button', { name: 'Wind & Pressure, unavailable' })
    expect(windPressure).toBeDisabled()
    expect(within(windPressure).getByText('No data')).toBeInTheDocument()
  })

  it('selects active-category fields from the category surface', () => {
    renderWithForecastSelection(
      <TestWeatherCategoryBar />,
      createCategoryManifest()
    )

    openWeatherMapsMenu()

    expect(screen.getByRole('button', { name: 'Field: Temperature' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Field: Apparent Temperature' }))
      .toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Field: Apparent Temperature' }))

    expect(selectedFieldLabel()).toBe('Apparent Temperature')
    expect(screen.getByRole('button', { name: 'Field: Apparent Temperature' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(weatherMapsToggle()).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows a map-native status when the selected field is missing from the current cycle', () => {
    renderWithForecastSelection(
      <TestWeatherCategoryBar />,
      createModeManifest(),
      { selectedLayerId: 'wind_gust' }
    )

    const availability = screen.getByRole('status', { name: 'Wind Gust availability' })
    expect(availability).toHaveTextContent('No Current Field')
    expect(availability).toHaveTextContent('Wind Gust is missing from this GFS cycle.')
  })

  it('shows a map-native status when the active source cannot support a field', () => {
    const manifest = createManifestFixture({
      layers: {
        temperature: {
          datasets: {
            gfs: createLayerDatasetAvailabilityFixture({
              state: 'unsupported',
              support: 'unavailable',
              required_artifacts: ['tmp_surface'],
            }),
          },
        },
      },
    })

    renderWithForecastSelection(
      <TestWeatherCategoryBar />,
      manifest,
      { selectedLayerId: 'temperature' }
    )

    const availability = screen.getByRole('status', { name: 'Temperature availability' })
    expect(availability).toHaveTextContent('Source Not Supported')
    expect(availability).toHaveTextContent('GFS does not carry Temperature. Choose another weather map or source.')
  })

  it('keeps the weather maps menu open on outside click and closes it on escape', () => {
    renderWithForecastSelection(
      <div>
        <TestWeatherCategoryBar />
        <button type="button">Outside</button>
      </div>,
      createCategoryManifest()
    )

    openWeatherMapsMenu()
    expect(weatherMapsToggle()).toHaveAttribute('aria-expanded', 'true')

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
    expect(weatherMapsToggle()).toHaveAttribute('aria-expanded', 'true')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(weatherMapsToggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps the weather maps menu open after category and field selection', () => {
    renderWithForecastSelection(<TestWeatherCategoryBar />, createCategoryManifest())

    openWeatherMapsMenu()

    fireEvent.click(screen.getByRole('button', { name: 'Wind & Pressure' }))
    expect(weatherMapsToggle()).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Temperature' }))
    fireEvent.click(screen.getByRole('button', { name: 'Field: Apparent Temperature' }))
    expect(weatherMapsToggle()).toHaveAttribute('aria-expanded', 'true')
  })

  it('uses the weather maps toggle as the close action', () => {
    renderWithForecastSelection(<TestWeatherCategoryBar />, createCategoryManifest())

    openWeatherMapsMenu()

    fireEvent.click(weatherMapsToggle())

    expect(weatherMapsToggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('can be controlled by open state', () => {
    const onOpenChange = vi.fn()
    const view = renderWithForecastSelection(
      <WeatherCategoryBar isOpen={false} onOpenChange={onOpenChange} />,
      createCategoryManifest()
    )

    expect(weatherMapsToggle()).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(weatherMapsToggle())
    expect(onOpenChange).toHaveBeenLastCalledWith(true)

    view.unmount()
    renderWithForecastSelection(
      <WeatherCategoryBar isOpen onOpenChange={onOpenChange} />,
      createCategoryManifest()
    )
    expect(weatherMapsToggle()).toHaveAttribute('aria-expanded', 'true')

    onOpenChange.mockClear()
    fireEvent.click(weatherMapsToggle())
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('requests close on escape when controlled open', () => {
    const onOpenChange = vi.fn()

    renderWithForecastSelection(
      <WeatherCategoryBar isOpen onOpenChange={onOpenChange} />,
      createCategoryManifest()
    )

    onOpenChange.mockClear()
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })
})
