import { act, fireEvent, render, screen } from '@testing-library/react'
import type { MapMouseEvent } from 'maplibre-gl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ForecastPlaceProbeFrame,
  ForecastPlaceProbeFrameChannel,
} from '@/forecast/place-probes'
import {
  createMapFixture,
  createRasterWindowFixture,
} from '@/test/fixtures'
import type { MapPoint } from '../mapPoint'
import ForecastMapReadout from './ForecastMapReadout'

const mocks = vi.hoisted(() => ({
  activeRun: { label: 'GFS' } as unknown,
  selectedLayerId: 'temperature' as string | null,
  formatProbeValue: vi.fn((value: number | null, loading = false) => ({
    text: loading ? 'Loading' : value == null ? 'No data' : `${value.toFixed(1)} F`,
  })),
}))

vi.mock('@/forecast/selection', () => ({
  useForecastSelectionContext: () => ({
    activeRun: mocks.activeRun,
    selectedLayerId: mocks.selectedLayerId,
  }),
}))

vi.mock('../useForecastProbeValueFormatter', () => ({
  useForecastProbeValueFormatter: () => mocks.formatProbeValue,
}))

function createFrameChannel(
  startingFrame: ForecastPlaceProbeFrame = null
): ForecastPlaceProbeFrameChannel {
  let publishedFrame = startingFrame
  const listeners = new Set<(frame: ForecastPlaceProbeFrame) => void>()

  return {
    getSnapshot: vi.fn(() => publishedFrame),
    publish: vi.fn((frame) => {
      publishedFrame = frame
      listeners.forEach((listener) => listener(frame))
    }),
    subscribe: vi.fn((listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }),
  }
}

function clickMap(
  map: ReturnType<typeof createMapFixture>,
  lon: number,
  lat: number,
  point: { x: number; y: number } = { x: 240, y: 180 }
) {
  const clickListener = map.on.mock.calls.find(([eventName]) => eventName === 'click')?.[1]
  expect(clickListener).toEqual(expect.any(Function))

  act(() => {
    clickListener?.({
      lngLat: { lng: lon, lat },
      point,
    } as MapMouseEvent)
  })
}

function readoutProps(overrides: Partial<{
  point?: MapPoint | null
  onPoint?: (point: MapPoint) => void
  onClose?: () => void
  suppressed: boolean
}> = {}) {
  return {
    point: null,
    onPoint: vi.fn(),
    onClose: vi.fn(),
    suppressed: false,
    ...overrides,
  }
}

describe('ForecastMapReadout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.activeRun = { label: 'GFS' }
    mocks.selectedLayerId = 'temperature'
  })

  it('does not attach map listeners while forecast selection is unloaded', () => {
    mocks.activeRun = null
    const map = createMapFixture()

    render(
      <ForecastMapReadout
        {...readoutProps()}
        map={map}
        probeFrameChannel={createFrameChannel()}
      />
    )

    expect(map.on).not.toHaveBeenCalledWith('click', expect.any(Function))
  })

  it('does not create hidden readouts from map clicks while suppressed', () => {
    const map = createMapFixture()
    const onPoint = vi.fn()
    const frame = createRasterWindowFixture({ layerId: 'temperature' })
    const props = {
      map,
      probeFrameChannel: createFrameChannel(frame),
      ...readoutProps({ onPoint }),
    }

    const { rerender } = render(<ForecastMapReadout {...props} suppressed />)

    expect(map.on).not.toHaveBeenCalledWith('click', expect.any(Function))
    expect(screen.queryByLabelText('Point forecast readout')).not.toBeInTheDocument()

    rerender(<ForecastMapReadout {...props} suppressed={false} />)
    clickMap(map, -180, 90, { x: 40, y: 60 })

    expect(onPoint).toHaveBeenCalledWith({ lon: -180, lat: 90 })
  })

  it('reports map clicks and renders the selected point readout', () => {
    const map = createMapFixture()
    const onPoint = vi.fn()
    const frame = createRasterWindowFixture({
      layerId: 'temperature',
      selectedValidTimeMs: Date.UTC(2026, 3, 13, 12, 0),
    })
    const props = {
      map,
      probeFrameChannel: createFrameChannel(frame),
      ...readoutProps({ onPoint }),
    }

    const { rerender } = render(<ForecastMapReadout {...props} />)

    clickMap(map, -180, 90, { x: 40, y: 60 })
    expect(onPoint).toHaveBeenCalledWith({ lon: -180, lat: 90 })
    expect(screen.queryByLabelText('Point forecast readout')).not.toBeInTheDocument()

    rerender(<ForecastMapReadout {...props} point={{ lon: -180, lat: 90 }} />)

    expect(screen.getByLabelText('Point forecast readout')).toBeInTheDocument()
    expect(screen.getByText('1.0 F')).toBeInTheDocument()
    expect(screen.getByText('90.00N 180.00W')).toBeInTheDocument()
  })

  it('closes the current readout without detaching the map click listener', () => {
    const map = createMapFixture()
    const onClose = vi.fn()
    const frame = createRasterWindowFixture({ layerId: 'temperature' })
    const props = {
      map,
      probeFrameChannel: createFrameChannel(frame),
      ...readoutProps({ onClose }),
    }

    const { rerender } = render(
      <ForecastMapReadout {...props} point={{ lon: -180, lat: 90 }} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close map readout' }))

    expect(onClose).toHaveBeenCalled()
    rerender(<ForecastMapReadout {...props} point={null} />)
    expect(screen.queryByLabelText('Point forecast readout')).not.toBeInTheDocument()
  })

  it('closes the current readout on escape', () => {
    const map = createMapFixture()
    const onClose = vi.fn()
    const frame = createRasterWindowFixture({ layerId: 'temperature' })
    const props = {
      map,
      probeFrameChannel: createFrameChannel(frame),
      ...readoutProps({ onClose }),
    }

    const { rerender } = render(
      <ForecastMapReadout {...props} point={{ lon: -180, lat: 90 }} />
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
    rerender(<ForecastMapReadout {...props} point={null} />)
    expect(screen.queryByLabelText('Point forecast readout')).not.toBeInTheDocument()
  })

  it('shows a sampled point readout for an external place or location request', () => {
    const map = createMapFixture()
    const frame = createRasterWindowFixture({
      layerId: 'temperature',
      selectedValidTimeMs: Date.UTC(2026, 3, 13, 12, 0),
    })

    render(
      <ForecastMapReadout
        {...readoutProps({ point: { lon: -180, lat: 90 } })}
        map={map}
        probeFrameChannel={createFrameChannel(frame)}
      />
    )

    expect(screen.getByLabelText('Point forecast readout')).toBeInTheDocument()
    expect(screen.getByText('1.0 F')).toBeInTheDocument()
    expect(screen.getByText('90.00N 180.00W')).toBeInTheDocument()
  })

  it('removes an active readout from the DOM while suppressed and restores it afterward', () => {
    const map = createMapFixture()
    const frame = createRasterWindowFixture({ layerId: 'temperature' })
    const props = {
      map,
      probeFrameChannel: createFrameChannel(frame),
      ...readoutProps({ point: { lon: -97.33, lat: 37.69 } }),
    }

    const { rerender } = render(<ForecastMapReadout {...props} />)

    expect(screen.getByLabelText('Point forecast readout')).toBeInTheDocument()

    rerender(<ForecastMapReadout {...props} suppressed />)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByLabelText('Point forecast readout')).not.toBeInTheDocument()

    rerender(<ForecastMapReadout {...props} suppressed={false} />)

    expect(screen.getByLabelText('Point forecast readout')).toBeInTheDocument()
  })

  it('keeps selected points hidden while suppressed for search and location handoff', () => {
    const map = createMapFixture()
    const onClose = vi.fn()
    const frame = createRasterWindowFixture({ layerId: 'temperature' })
    const props = {
      map,
      probeFrameChannel: createFrameChannel(frame),
      ...readoutProps({
        point: { lon: -95.94, lat: 41.26 },
        onClose,
      }),
    }

    const { rerender } = render(<ForecastMapReadout {...props} suppressed />)

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Point forecast readout')).not.toBeInTheDocument()

    rerender(<ForecastMapReadout {...props} suppressed={false} />)

    expect(screen.getByLabelText('Point forecast readout')).toBeInTheDocument()
  })

  it('clears a controlled readout when the shell clears the point', () => {
    const map = createMapFixture()
    const frame = createRasterWindowFixture({ layerId: 'temperature' })
    const props = {
      map,
      probeFrameChannel: createFrameChannel(frame),
      ...readoutProps(),
    }

    const { rerender } = render(
      <ForecastMapReadout {...props} point={{ lon: -180, lat: 90 }} />
    )

    expect(screen.getByLabelText('Point forecast readout')).toBeInTheDocument()

    rerender(<ForecastMapReadout {...props} point={null} />)
    expect(screen.queryByLabelText('Point forecast readout')).not.toBeInTheDocument()

    rerender(<ForecastMapReadout {...props} point={null} />)
    expect(screen.queryByLabelText('Point forecast readout')).not.toBeInTheDocument()
  })

  it('shows loading until the probe frame matches the selected layer', () => {
    const map = createMapFixture()
    mocks.selectedLayerId = 'relative_humidity'
    const channel = createFrameChannel(createRasterWindowFixture({ layerId: 'temperature' }))

    render(
      <ForecastMapReadout
        {...readoutProps({ point: { lon: -180, lat: 90 } })}
        map={map}
        probeFrameChannel={channel}
      />
    )

    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(screen.getByText('90.00N 180.00W')).toBeInTheDocument()

    act(() => {
      channel.publish(createRasterWindowFixture({ layerId: 'relative_humidity' }))
    })

    expect(screen.getByText('1.0 F')).toBeInTheDocument()
  })
})
