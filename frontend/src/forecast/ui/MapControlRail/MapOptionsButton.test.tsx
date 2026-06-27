import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_FORECAST_SETTINGS,
  ForecastSettingsProvider,
  type ForecastSettings,
} from '@/forecast/settings'
import MapOptionsButton from './MapOptionsButton'

const TRAIL_LENGTH = 7
const FORECAST_SETTINGS_STORAGE_KEY = 'weather-map:forecast-settings:v1'

const SETTINGS: ForecastSettings = {
  ...DEFAULT_FORECAST_SETTINGS,
  raster: {
    ...DEFAULT_FORECAST_SETTINGS.raster,
    gridSamplingMode: 'smooth',
    colorSamplingMode: 'gradient',
  },
  pressureContours: {
    enabled: true,
  },
}

function TestMapOptionsButton() {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <ForecastSettingsProvider>
      <MapOptionsButton
        isOpen={isOpen}
        onOpenChange={setIsOpen}
      />
    </ForecastSettingsProvider>
  )
}

function seedSettings(settings: ForecastSettings = SETTINGS) {
  localStorage.setItem(FORECAST_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

describe('MapOptionsButton', () => {
  beforeEach(() => {
    localStorage.clear()
    seedSettings()
  })

  it('toggles panel visibility and updates representative map settings', () => {
    render(<TestMapOptionsButton />)

    const button = screen.getByRole('button', { name: 'Map display options' })

    fireEvent.click(button)

    const globeRadio = screen.getByRole('radio', { name: 'Globe' })
    const mercatorRadio = screen.getByRole('radio', { name: 'Mercator' })
    const bandedRadio = screen.getByRole('radio', { name: 'Banded' })
    const nearestRadio = screen.getByRole('radio', { name: 'Nearest' })
    const opacitySlider = screen.getByRole('slider', { name: /Opacity/ }) as HTMLInputElement
    const speedSlider = screen.getByRole('slider', { name: /Speed/ }) as HTMLInputElement
    const trailLengthSlider = screen.getByRole('slider', { name: /Trail length/ }) as HTMLInputElement
    const locationLabelsCheckbox = screen.getByRole('checkbox', { name: 'Location labels' })
    const pressureContoursCheckbox = screen.getByRole('checkbox', { name: 'Pressure contours' })
    const windAnimationCheckbox = screen.getByRole('checkbox', { name: 'Wind animation' })

    expect(globeRadio).toBeChecked()
    fireEvent.click(mercatorRadio)
    expect(mercatorRadio).toBeChecked()

    fireEvent.change(opacitySlider, { target: { value: '0.65' } })
    expect(opacitySlider).toHaveValue('0.65')

    fireEvent.change(speedSlider, { target: { value: '1.2' } })
    expect(speedSlider).toHaveValue('1.2')

    fireEvent.change(trailLengthSlider, { target: { value: String(TRAIL_LENGTH) } })
    expect(trailLengthSlider).toHaveValue(String(TRAIL_LENGTH))

    fireEvent.click(nearestRadio)
    expect(nearestRadio).toBeChecked()

    fireEvent.click(bandedRadio)
    expect(bandedRadio).toBeChecked()

    expect(locationLabelsCheckbox).toBeChecked()
    fireEvent.click(locationLabelsCheckbox)
    expect(locationLabelsCheckbox).not.toBeChecked()

    fireEvent.click(pressureContoursCheckbox)
    expect(pressureContoursCheckbox).not.toBeChecked()

    fireEvent.click(windAnimationCheckbox)
    expect(windAnimationCheckbox).not.toBeChecked()
  })

  it('disables wind sliders when wind animation is off', () => {
    seedSettings({
      ...SETTINGS,
      particles: {
        ...SETTINGS.particles,
        enabled: false,
      },
    })
    render(<TestMapOptionsButton />)

    fireEvent.click(screen.getByRole('button', { name: 'Map display options' }))

    expect(screen.getByRole('checkbox', { name: 'Wind animation' }))
      .not.toBeChecked()
    expect(screen.getByRole('slider', { name: /Density/ })).toBeDisabled()
    expect(screen.getByRole('slider', { name: /Speed/ })).toBeDisabled()
    expect(screen.getByRole('slider', { name: /Size/ })).toBeDisabled()
    expect(screen.getByRole('slider', { name: /Trail opacity/ })).toBeDisabled()
    expect(screen.getByRole('slider', { name: /Trail length/ })).toBeDisabled()
  })

  it('closes the panel on outside click or escape without closing on inside clicks', () => {
    render(<TestMapOptionsButton />)

    const button = screen.getByRole('button', { name: 'Map display options' })

    fireEvent.click(button)
    const bandedRadio = screen.getByRole('radio', { name: 'Banded' })
    expect(screen.getByText('Grid')).toBeInTheDocument()

    fireEvent.pointerDown(bandedRadio)
    expect(screen.getByText('Grid')).toBeInTheDocument()

    fireEvent.pointerDown(document.body)
    expect(button).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(button)
    expect(screen.getByText('Grid')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('provides an explicit close action for the options panel', () => {
    render(<TestMapOptionsButton />)

    const button = screen.getByRole('button', { name: 'Map display options' })

    fireEvent.click(button)
    expect(screen.getByText('Grid')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close display options' }))

    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

})
