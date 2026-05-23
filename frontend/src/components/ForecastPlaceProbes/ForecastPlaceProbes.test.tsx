import { render } from '@testing-library/react'
import type { RefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FieldInterpolationWindowData } from '../../forecast-data'
import type {
  ForecastPlaceProbeFrame,
  ForecastPlaceProbeFrameChannel,
} from '../../forecast-place-probes'
import ForecastPlaceProbes from './ForecastPlaceProbes'

const mocks = vi.hoisted(() => ({
  activeRun: {} as unknown,
  selectedLayerId: 'temperature' as string | null,
  formatProbeValue: vi.fn(),
  createForecastPlaceProbeSession: vi.fn(),
  session: {
    start: vi.fn(),
    destroy: vi.fn(),
    setLayerId: vi.fn(),
    setValueFormatter: vi.fn(),
    setFrame: vi.fn(),
  },
}))

vi.mock('../../forecast-selection', () => ({
  useForecastSelectionContext: () => ({
    activeRun: mocks.activeRun,
    selectedLayerId: mocks.selectedLayerId,
  }),
}))

vi.mock('./useForecastPlaceProbeValueFormatter', () => ({
  useForecastPlaceProbeValueFormatter: () => mocks.formatProbeValue,
}))

vi.mock('../../forecast-place-probes', () => ({
  createForecastPlaceProbeSession: (args: unknown) => mocks.createForecastPlaceProbeSession(args),
}))

function createMapRef(map = {}): RefObject<MapLibreMap | null> {
  return {
    current: map as MapLibreMap,
  }
}

function createFrameChannel(
  initialFrame: ForecastPlaceProbeFrame = null
): ForecastPlaceProbeFrameChannel {
  let publishedFrame = initialFrame
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

function createProbeFrame(layerId = 'temperature', frame = 1): FieldInterpolationWindowData {
  const slice = {
    hourToken: '000',
    layerId,
    paletteId: 'temperature',
    grid: {
      id: 'grid',
      crs: 'EPSG:4326',
      nx: 1,
      ny: 1,
      lon0: 0,
      lat0: 0,
      dx: 1,
      dy: 1,
      origin: 'cell_center' as const,
      layout: 'row_major' as const,
      xWrap: 'none' as const,
      yMode: 'clamp' as const,
    },
    encoding: {
      id: 'encoding',
      format: 'linear-i8-v1' as const,
      dtype: 'int8' as const,
      byteOrder: 'none' as const,
      nodata: -128,
      scale: 1,
      offset: 0,
      decodeFormula: 'value',
    },
    values: new Float32Array([frame]),
    displayRange: [0, 1] as [number, number],
    colorStops: [[0, 0, 0, 0] as [number, number, number, number]],
    frame,
  }

  return {
    lower: slice,
    upper: slice,
    selectedValidTimeMs: frame,
    lowerHourToken: '000',
    upperHourToken: '000',
    mix: 0,
  }
}

describe('ForecastPlaceProbes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.activeRun = {}
    mocks.selectedLayerId = 'temperature'
    mocks.createForecastPlaceProbeSession.mockReturnValue(mocks.session)
  })

  it('does not create a session while forecast selection is unloaded', () => {
    mocks.activeRun = null
    const mapRef = createMapRef()

    render(
      <ForecastPlaceProbes
        mapRef={mapRef}
        mapReadyVersion={1}
        probeFrameChannel={createFrameChannel()}
      />
    )

    expect(mocks.createForecastPlaceProbeSession).not.toHaveBeenCalled()
  })

  it('creates, starts, and destroys a feature session', () => {
    const map = {}
    const mapRef = createMapRef(map)
    const initialFrame = createProbeFrame()
    const probeFrameChannel = createFrameChannel(initialFrame)

    const { unmount } = render(
      <ForecastPlaceProbes
        mapRef={mapRef}
        mapReadyVersion={1}
        probeFrameChannel={probeFrameChannel}
      />
    )

    expect(mocks.createForecastPlaceProbeSession).toHaveBeenCalledWith({
      map,
      layerId: 'temperature',
      valueFormatter: mocks.formatProbeValue,
      initialFrame,
    })
    expect(probeFrameChannel.subscribe).toHaveBeenCalledWith(expect.any(Function))
    expect(mocks.session.start).toHaveBeenCalledTimes(1)

    unmount()

    expect(mocks.session.destroy).toHaveBeenCalledTimes(1)
  })

  it('forwards layer, formatter, and published frame changes', () => {
    const secondFrame = createProbeFrame('temperature', 2)
    const mapRef = createMapRef()
    const probeFrameChannel = createFrameChannel()

    const { rerender } = render(
      <ForecastPlaceProbes
        mapRef={mapRef}
        mapReadyVersion={1}
        probeFrameChannel={probeFrameChannel}
      />
    )

    probeFrameChannel.publish(secondFrame)
    mocks.selectedLayerId = 'dew_point'
    mocks.formatProbeValue = vi.fn()
    rerender(
      <ForecastPlaceProbes
        mapRef={mapRef}
        mapReadyVersion={1}
        probeFrameChannel={probeFrameChannel}
      />
    )

    expect(mocks.session.setLayerId).toHaveBeenLastCalledWith('dew_point')
    expect(mocks.session.setValueFormatter).toHaveBeenLastCalledWith(mocks.formatProbeValue)
    expect(mocks.session.setFrame).toHaveBeenLastCalledWith(secondFrame)
  })

  it('recreates the session when map readiness changes', () => {
    const mapRef = createMapRef()
    const probeFrameChannel = createFrameChannel()

    const { rerender } = render(
      <ForecastPlaceProbes
        mapRef={mapRef}
        mapReadyVersion={1}
        probeFrameChannel={probeFrameChannel}
      />
    )

    rerender(
      <ForecastPlaceProbes
        mapRef={mapRef}
        mapReadyVersion={2}
        probeFrameChannel={probeFrameChannel}
      />
    )

    expect(mocks.session.destroy).toHaveBeenCalledTimes(1)
    expect(mocks.createForecastPlaceProbeSession).toHaveBeenCalledTimes(2)
  })

  it('applies the latest channel frame after subscribing', () => {
    const initialFrame = createProbeFrame('temperature', 1)
    const publishedFrame = createProbeFrame('temperature', 2)
    let snapshotFrame: ForecastPlaceProbeFrame = initialFrame
    const probeFrameChannel: ForecastPlaceProbeFrameChannel = {
      getSnapshot: vi.fn(() => snapshotFrame),
      publish: vi.fn(),
      subscribe: vi.fn(() => {
        snapshotFrame = publishedFrame
        return vi.fn()
      }),
    }

    render(
      <ForecastPlaceProbes
        mapRef={createMapRef()}
        mapReadyVersion={1}
        probeFrameChannel={probeFrameChannel}
      />
    )

    expect(mocks.createForecastPlaceProbeSession).toHaveBeenCalledWith(expect.objectContaining({
      initialFrame,
    }))
    expect(mocks.session.setFrame).toHaveBeenCalledWith(publishedFrame)
  })

  it('unsubscribes from the frame channel on unmount', () => {
    const frame = createProbeFrame()
    const mapRef = createMapRef()
    const probeFrameChannel = createFrameChannel()

    const { unmount } = render(
      <ForecastPlaceProbes
        mapRef={mapRef}
        mapReadyVersion={1}
        probeFrameChannel={probeFrameChannel}
      />
    )

    unmount()
    probeFrameChannel.publish(frame)

    expect(mocks.session.setFrame).not.toHaveBeenCalledWith(frame)
  })
})
