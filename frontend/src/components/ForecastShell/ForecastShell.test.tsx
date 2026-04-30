import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createManifestFixture } from '../../test/fixtures'
import ForecastShell from './ForecastShell'

vi.mock('../ForecastPanel', () => ({
  default: () => <div data-testid="forecast-panel" />,
}))

vi.mock('../LegendPanel', () => ({
  default: () => <div data-testid="legend-panel" />,
}))

vi.mock('../TimelineBar', () => ({
  default: () => (
    <section data-testid="timeline-bar" aria-label="Forecast timeline controls">
      <div data-testid="transport-controls" />
      <div data-testid="timeline-scrubber" />
    </section>
  ),
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
    expect(screen.queryByTestId('timeline-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('legend-panel')).not.toBeInTheDocument()
  })

  it('renders map overlays and forecast timeline controls when manifest is available', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['000', '003'],
    })

    const { container } = render(<ForecastShell manifest={manifest} />)

    expect(screen.getByTestId('forecast-map')).toBeInTheDocument()
    expect(screen.getByTestId('forecast-panel')).toBeInTheDocument()
    expect(screen.getByTestId('legend-panel')).toBeInTheDocument()

    const forecastStage = container.querySelector('.forecast-stage')
    const timelineBar = screen.getByLabelText('Forecast timeline controls')

    expect(forecastStage).not.toBeNull()
    expect(timelineBar).toBeInTheDocument()
    expect(within(forecastStage as HTMLElement).getByTestId('legend-panel')).toBeInTheDocument()
    expect(within(timelineBar).getByTestId('transport-controls')).toBeInTheDocument()
    expect(within(timelineBar).getByTestId('timeline-scrubber')).toBeInTheDocument()
    expect(within(timelineBar).queryByTestId('forecast-controls')).not.toBeInTheDocument()
    expect(within(timelineBar).queryByTestId('legend-panel')).not.toBeInTheDocument()
  })
})
