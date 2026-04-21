import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createManifestFixture } from '../../test/fixtures'
import ForecastShell from './ForecastShell'

vi.mock('../LayerPanel', () => ({
  default: () => <div data-testid="layer-panel" />,
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
    expect(screen.queryByTestId('layer-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('legend-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('time-transport')).not.toBeInTheDocument()
  })

  it('renders controls and transport modules when manifest is available', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['000', '003'],
    })

    const { container } = render(<ForecastShell manifest={manifest} />)

    expect(screen.getByTestId('forecast-map')).toBeInTheDocument()
    expect(screen.getByTestId('layer-panel')).toBeInTheDocument()
    expect(screen.getByTestId('legend-panel')).toBeInTheDocument()
    expect(screen.getByTestId('time-transport')).toBeInTheDocument()

    const forecastStage = container.querySelector('.forecast-stage')
    const lowerThird = screen.getByLabelText('Forecast details')

    expect(forecastStage).not.toBeNull()
    expect(lowerThird).toBeInTheDocument()
    expect(within(forecastStage as HTMLElement).getByTestId('legend-panel')).toBeInTheDocument()
    expect(within(lowerThird).queryByTestId('legend-panel')).not.toBeInTheDocument()
  })
})
