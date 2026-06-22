import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ForecastDatasetOption,
  Manifest,
} from '@/forecast/manifest'
import type { ForecastSyncInitialStatus } from '@/forecast/sync'
import {
  createForecastPlaceProbeFrameChannel,
} from '@/forecast/place-probes'
import type { MapPoint } from '../mapPoint'
import {
  createForecastManifestDataFixture,
  createManifestFixture,
  createMapFixture,
} from '@/test/fixtures'
import type { MapControlRailProps } from '../MapControlRail'
import ForecastShell from './ForecastShell'

const mocks = vi.hoisted(() => ({
  ForecastMapReadout: vi.fn(),
  ForecastPlaceProbes: vi.fn(),
  ForecastRunStatus: vi.fn(),
  MapControlRail: vi.fn(),
  TimelineBar: vi.fn(),
  WeatherCategoryBar: vi.fn(),
  useForecastMapRuntime: vi.fn(),
}))

const MODEL_OPTIONS: readonly ForecastDatasetOption[] = [
  { id: 'gfs', label: 'GFS' },
  { id: 'icon', label: 'ICON' },
]

vi.mock('./useForecastMapRuntime', () => ({
  useForecastMapRuntime: (args: unknown) => mocks.useForecastMapRuntime(args),
}))

vi.mock('../ForecastPlaceProbes', () => ({
  default: (props: unknown) => {
    mocks.ForecastPlaceProbes(props)
    return <div data-testid="forecast-place-probes" />
  },
}))

vi.mock('../ForecastMapReadout', () => ({
  default: (props: unknown) => {
    mocks.ForecastMapReadout(props)
    return <section data-testid="forecast-map-readout" />
  },
}))

vi.mock('../WeatherCategoryBar', () => ({
  default: (props: unknown) => {
    mocks.WeatherCategoryBar(props)
    return <div data-testid="weather-category-bar" />
  },
}))

vi.mock('../LegendPanel', () => ({
  default: () => <div data-testid="legend-panel" />,
}))

vi.mock('../ForecastRunStatus', () => ({
  default: (props: unknown) => {
    mocks.ForecastRunStatus(props)
    return <section data-testid="forecast-run-status" />
  },
}))

vi.mock('../MapControlRail', () => ({
  default: (props: unknown) => {
    mocks.MapControlRail(props)
    return <div data-testid="map-control-rail" />
  },
}))

vi.mock('../TimelineBar', () => ({
  default: (props: unknown) => {
    mocks.TimelineBar(props)
    return <section data-testid="timeline-bar" aria-label="Forecast timeline controls" />
  },
}))

type WeatherCategoryBarProps = {
  isOpen?: boolean
  onOpenChange?: (isOpen: boolean) => void
}

type MapReadoutProps = {
  point?: MapPoint | null
  onPoint?: (point: MapPoint) => void
  onClose?: () => void
  suppressed: boolean
}

function createForecastShellProps(overrides: {
  manifest?: Manifest | null
} = {}): Parameters<typeof ForecastShell>[0] {
  const manifest = overrides.manifest ?? null
  return {
    forecast: manifest == null
      ? null
      : createForecastManifestDataFixture({
          manifest,
          datasetOptions: MODEL_OPTIONS,
        }),
  }
}

function latestWeatherCategoryBarProps(): WeatherCategoryBarProps {
  expect(mocks.WeatherCategoryBar).toHaveBeenCalled()
  return mocks.WeatherCategoryBar.mock.calls.at(-1)?.[0] as WeatherCategoryBarProps
}

function latestMapControlRailProps(): MapControlRailProps {
  expect(mocks.MapControlRail).toHaveBeenCalled()
  return mocks.MapControlRail.mock.calls.at(-1)?.[0] as MapControlRailProps
}

function latestMapReadoutProps(): MapReadoutProps {
  expect(mocks.ForecastMapReadout).toHaveBeenCalled()
  return mocks.ForecastMapReadout.mock.calls.at(-1)?.[0] as MapReadoutProps
}

function renderForecastShell(props: Parameters<typeof ForecastShell>[0]) {
  return render(
    <MemoryRouter initialEntries={['/?layer=temperature']}>
      <ForecastShell {...props} />
    </MemoryRouter>
  )
}

describe('ForecastShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()

    mocks.useForecastMapRuntime.mockReturnValue({
      map: createMapFixture(),
      probeFrameChannel: createForecastPlaceProbeFrameChannel(),
    })
  })

  it('always renders the map viewport even when manifest is unavailable', () => {
    renderForecastShell(createForecastShellProps())

    expect(document.querySelector('#map')).toBeInTheDocument()
    expect(screen.getByTestId('forecast-place-probes')).toBeInTheDocument()
    expect(screen.getByTestId('map-control-rail')).toBeInTheDocument()
    expect(screen.getByTestId('forecast-map-readout')).toBeInTheDocument()
  })

  it('forwards app status callbacks to the map runtime', () => {
    const onInitialSyncStatusChange = vi.fn<(status: ForecastSyncInitialStatus | null) => void>()
    const onFieldLoadingChange = vi.fn<(isLoading: boolean) => void>()

    renderForecastShell({
      ...createForecastShellProps(),
      onInitialSyncStatusChange,
      onFieldLoadingChange,
    })

    expect(mocks.useForecastMapRuntime).toHaveBeenCalledWith({
      onInitialSyncStatusChange,
      onFieldLoadingChange,
    })
  })

  it('renders shell-owned map chrome when manifest is available', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      frameIds: ['000', '003'],
    })

    renderForecastShell(createForecastShellProps({ manifest }))

    expect(screen.getByTestId('forecast-place-probes')).toBeInTheDocument()
    expect(screen.getByTestId('weather-category-bar')).toBeInTheDocument()
    expect(screen.getByTestId('forecast-run-status')).toBeInTheDocument()
    expect(screen.getByTestId('legend-panel')).toBeInTheDocument()
    expect(screen.getByTestId('map-control-rail')).toBeInTheDocument()
    expect(screen.getByTestId('forecast-map-readout')).toBeInTheDocument()
    expect(mocks.TimelineBar).toHaveBeenLastCalledWith({})
  })

  it('coordinates weather maps and right-rail panels through one owner', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      frameIds: ['000', '003'],
    })

    renderForecastShell(createForecastShellProps({ manifest }))

    expect(latestMapControlRailProps().activePanel).toBeNull()
    expect(latestWeatherCategoryBarProps().isOpen).toBe(false)
    expect(latestMapReadoutProps()).toEqual(expect.objectContaining({
      point: null,
      suppressed: false,
    }))

    act(() => {
      latestMapControlRailProps().onActivePanelChange('options')
    })
    expect(latestMapControlRailProps().activePanel).toBe('options')
    expect(latestWeatherCategoryBarProps().isOpen).toBe(false)
    expect(latestMapReadoutProps()).toEqual(expect.objectContaining({
      point: null,
      suppressed: true,
    }))

    act(() => {
      latestMapControlRailProps().onActivePanelChange(null)
    })
    expect(latestMapControlRailProps().activePanel).toBeNull()
    expect(latestMapReadoutProps().suppressed).toBe(false)

    act(() => {
      latestWeatherCategoryBarProps().onOpenChange?.(true)
    })
    expect(latestWeatherCategoryBarProps().isOpen).toBe(true)
    expect(latestMapControlRailProps().activePanel).toBeNull()
    expect(latestMapReadoutProps()).toEqual(expect.objectContaining({
      point: null,
      suppressed: true,
    }))

    act(() => {
      latestMapControlRailProps().onActivePanelChange('search')
    })
    expect(latestWeatherCategoryBarProps().isOpen).toBe(false)
    expect(latestMapControlRailProps().activePanel).toBe('search')
  })

  it('coordinates point forecast with edge panels', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      frameIds: ['000', '003'],
    })

    renderForecastShell(createForecastShellProps({ manifest }))

    act(() => {
      latestMapReadoutProps().onPoint?.({ lon: -97.5, lat: 38.5 })
    })

    expect(latestMapReadoutProps()).toEqual(expect.objectContaining({
      point: { lon: -97.5, lat: 38.5 },
      suppressed: false,
    }))
    expect(latestMapControlRailProps().activePanel).toBeNull()
    expect(latestWeatherCategoryBarProps().isOpen).toBe(false)

    act(() => {
      latestMapControlRailProps().onActivePanelChange('options')
    })
    expect(latestMapReadoutProps()).toEqual(expect.objectContaining({
      point: null,
      suppressed: true,
    }))
    expect(latestMapControlRailProps().activePanel).toBe('options')

    act(() => {
      latestMapReadoutProps().onPoint?.({ lon: -96.8, lat: 39.1 })
    })
    expect(latestMapReadoutProps()).toEqual(expect.objectContaining({
      point: { lon: -96.8, lat: 39.1 },
      suppressed: false,
    }))

    act(() => {
      latestWeatherCategoryBarProps().onOpenChange?.(true)
    })
    expect(latestWeatherCategoryBarProps().isOpen).toBe(true)
    expect(latestMapReadoutProps()).toEqual(expect.objectContaining({
      point: null,
      suppressed: true,
    }))
  })

  it('passes right-rail map point requests into the point readout', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      frameIds: ['000', '003'],
    })

    renderForecastShell(createForecastShellProps({ manifest }))

    act(() => {
      latestMapControlRailProps().onMapPointSelect?.({ lon: -97.5, lat: 38.5 })
    })

    expect(latestMapReadoutProps().point).toEqual({
      lon: -97.5,
      lat: 38.5,
    })
  })
})
