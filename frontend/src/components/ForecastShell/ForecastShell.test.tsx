import { render, screen, within } from '@testing-library/react'
import type { Ref } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  Manifest,
  ForecastModelId,
  ForecastModelOption,
} from '../../forecast-manifest'
import type { ForecastSyncStartupStatus } from '../../forecast-sync'
import { createManifestFixture, createActiveRunFixture } from '../../test/fixtures'
import ForecastShell from './ForecastShell'

const mocks = vi.hoisted(() => ({
  ForecastMap: vi.fn(),
}))

const MODEL_OPTIONS: readonly ForecastModelOption[] = [
  { id: 'gfs', label: 'GFS' },
  { id: 'icon', label: 'ICON' },
]

vi.mock('../ForecastPanel', () => ({
  default: ({ ref }: { ref?: Ref<HTMLDivElement> }) => (
    <div ref={ref} data-testid="forecast-panel" />
  ),
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
  default: (props: unknown) => {
    mocks.ForecastMap(props)
    return <div data-testid="forecast-map" />
  },
}))

function createForecastShellProps(overrides: {
  manifest?: Manifest | null
  activeModelId?: ForecastModelId
  onActiveModelChange?: (modelId: ForecastModelId) => void
} = {}): Parameters<typeof ForecastShell>[0] {
  const manifest = overrides.manifest ?? null
  return {
    forecast: manifest == null
      ? null
      : {
          activeRun: createActiveRunFixture(manifest, overrides.activeModelId ?? 'gfs'),
          modelOptions: MODEL_OPTIONS,
          setActiveModel: overrides.onActiveModelChange ?? vi.fn(),
        },
  }
}

describe('ForecastShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('always renders forecast map even when manifest is unavailable', () => {
    render(<ForecastShell {...createForecastShellProps()} />)

    expect(screen.getByTestId('forecast-map')).toBeInTheDocument()
    expect(screen.queryByTestId('forecast-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('timeline-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('legend-panel')).not.toBeInTheDocument()
  })

  it('forwards sync startup status changes to the map', () => {
    const onSyncStartupStatusChange = vi.fn<(status: ForecastSyncStartupStatus | null) => void>()

    render(
      <ForecastShell
        {...createForecastShellProps()}
        onSyncStartupStatusChange={onSyncStartupStatusChange}
      />
    )

    expect(mocks.ForecastMap).toHaveBeenCalledWith({
      onSyncStartupStatusChange,
    })
  })

  it('renders map overlays and forecast timeline controls when manifest is available', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['000', '003'],
    })

    const { container } = render(<ForecastShell {...createForecastShellProps({ manifest, activeModelId: 'gfs' })} />)

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

  it('measures the forecast panel to offset mobile map controls without hard-coded panel height', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: ['000', '003'],
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      if (this.classList.contains('forecast-stage')) {
        return {
          x: 0,
          y: 20,
          top: 20,
          right: 680,
          bottom: 420,
          left: 0,
          width: 680,
          height: 400,
          toJSON: () => ({}),
        }
      }
      if (this.getAttribute('data-testid') === 'forecast-panel') {
        return {
          x: 12,
          y: 32,
          top: 32,
          right: 668,
          bottom: 154,
          left: 12,
          width: 656,
          height: 122,
          toJSON: () => ({}),
        }
      }

      return {
        x: 0,
        y: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      }
    })

    const { container } = render(<ForecastShell {...createForecastShellProps({ manifest })} />)

    expect(container.querySelector<HTMLElement>('.forecast-stage'))
      .toHaveStyle({ '--wm-map-control-rail-top': '142px' })
  })
})
