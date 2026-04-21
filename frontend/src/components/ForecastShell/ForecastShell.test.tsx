import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createManifestFixture } from '../../test/fixtures'
import ForecastShell from './ForecastShell'

vi.mock('../LayerControls', () => ({
  default: () => <div data-testid="layer-controls" />,
}))

vi.mock('../LegendPanel', () => ({
  default: () => <div data-testid="legend-panel" />,
}))

vi.mock('../TimelineTransport', () => ({
  default: () => <div data-testid="time-transport" />,
}))

vi.mock('../ForecastMap/ForecastMap', () => ({
  default: () => <div data-testid="forecast-map" />,
}))

describe('ForecastShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('always renders forecast map even when manifest is unavailable', () => {
    render(<ForecastShell manifest={null} />)

    expect(screen.getByTestId('forecast-map')).toBeInTheDocument()
    expect(screen.queryByTestId('layer-controls')).not.toBeInTheDocument()
    expect(screen.queryByTestId('legend-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('time-transport')).not.toBeInTheDocument()
  })

  it('renders controls and transport modules when manifest is available', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['000', '003'],
    })

    render(<ForecastShell manifest={manifest} />)

    expect(screen.getByTestId('forecast-map')).toBeInTheDocument()
    expect(screen.getByTestId('layer-controls')).toBeInTheDocument()
    expect(screen.getByTestId('legend-panel')).toBeInTheDocument()
    expect(screen.getByTestId('time-transport')).toBeInTheDocument()
  })
})
