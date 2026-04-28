import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createManifestFixture } from '../../test/fixtures'
import ForecastShell from './ForecastShell'

vi.mock('../ForecastPanel', () => ({
  default: () => <div data-testid="forecast-panel" />,
}))

vi.mock('../ProductPanel', () => ({
  default: () => <div data-testid="product-panel" />,
}))

vi.mock('../LegendPanel', () => ({
  default: () => <div data-testid="legend-panel" />,
}))

vi.mock('../TimelinePanel', () => ({
  default: () => <div data-testid="timeline-panel" />,
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
    expect(screen.queryByTestId('forecast-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('product-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('legend-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('timeline-panel')).not.toBeInTheDocument()
  })

  it('renders controls and transport modules when manifest is available', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['000', '003'],
    })

    const { container } = render(<ForecastShell manifest={manifest} />)

    expect(screen.getByTestId('forecast-map')).toBeInTheDocument()
    expect(screen.getByTestId('forecast-panel')).toBeInTheDocument()
    expect(screen.getByTestId('product-panel')).toBeInTheDocument()
    expect(screen.getByTestId('legend-panel')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-panel')).toBeInTheDocument()

    const forecastStage = container.querySelector('.forecast-stage')
    const lowerThird = screen.getByLabelText('Forecast details')

    expect(forecastStage).not.toBeNull()
    expect(lowerThird).toBeInTheDocument()
    expect(within(lowerThird).queryByText('Forecast Controls')).not.toBeInTheDocument()
    expect(within(forecastStage as HTMLElement).getByTestId('legend-panel')).toBeInTheDocument()
    expect(within(lowerThird).getByTestId('product-panel')).toBeInTheDocument()
    expect(within(lowerThird).queryByTestId('legend-panel')).not.toBeInTheDocument()
    expect(lowerThird.querySelector('.lower-third__titlebar')).not.toBeNull()
    expect(lowerThird.querySelector('.lower-third__divider')).toBeNull()
    expect(lowerThird.querySelector('.product-panel__titlebar')).toBeNull()
    expect(lowerThird.querySelector('.timeline-panel__titlebar')).toBeNull()
  })
})
