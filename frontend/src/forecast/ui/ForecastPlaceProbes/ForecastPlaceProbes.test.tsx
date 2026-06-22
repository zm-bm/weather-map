import { render } from '@testing-library/react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ForecastPlaceProbeFrame,
  ForecastPlaceProbeFrameChannel,
} from '@/forecast/place-probes'
import {
  createRasterWindowFixture,
} from '@/test/fixtures'
import ForecastPlaceProbes from './ForecastPlaceProbes'

const mocks = vi.hoisted(() => ({
  activeRun: {} as unknown,
  selectedLayerId: 'temperature' as string | null,
  formatProbeValue: vi.fn(),
  createForecastPlaceProbeSession: vi.fn(),
  session: {
    start: vi.fn(),
    destroy: vi.fn(),
    setFrame: vi.fn(),
  },
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

vi.mock('@/forecast/place-probes', () => ({
  createForecastPlaceProbeSession: (args: unknown) => mocks.createForecastPlaceProbeSession(args),
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

function createMapFixture(): MapLibreMap {
  return {} as MapLibreMap
}

describe('ForecastPlaceProbes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.activeRun = {}
    mocks.selectedLayerId = 'temperature'
    mocks.formatProbeValue.mockReset()
    mocks.formatProbeValue.mockImplementation((rawValue: number | null, loading = false) => ({
      text: loading
        ? 'Loading'
        : rawValue == null
          ? 'No data'
          : `${rawValue}`,
    }))
    mocks.createForecastPlaceProbeSession.mockReturnValue(mocks.session)
  })

  it('does not create a session while forecast selection is unloaded', () => {
    mocks.activeRun = null

    render(
      <ForecastPlaceProbes
        map={createMapFixture()}
        probeFrameChannel={createFrameChannel()}
      />
    )

    expect(mocks.createForecastPlaceProbeSession).not.toHaveBeenCalled()
  })

  it('creates, starts, and destroys a feature session', () => {
    const map = createMapFixture()
    const startingFrame = createRasterWindowFixture()
    const probeFrameChannel = createFrameChannel(startingFrame)

    const { unmount } = render(
      <ForecastPlaceProbes
        map={map}
        probeFrameChannel={probeFrameChannel}
      />
    )

    expect(mocks.createForecastPlaceProbeSession).toHaveBeenCalledWith({
      map,
      layerId: 'temperature',
      valueFormatter: mocks.formatProbeValue,
    })
    expect(probeFrameChannel.subscribe).toHaveBeenCalledWith(expect.any(Function))
    expect(mocks.session.setFrame).toHaveBeenCalledWith(startingFrame)
    expect(mocks.session.start).toHaveBeenCalledTimes(1)

    unmount()

    expect(mocks.session.destroy).toHaveBeenCalledTimes(1)
  })

  it('recreates the session for layer and formatter changes', () => {
    const secondFrame = createRasterWindowFixture({ layerId: 'temperature', frame: 2 })
    const map = createMapFixture()
    const probeFrameChannel = createFrameChannel()

    const { rerender } = render(
      <ForecastPlaceProbes
        map={map}
        probeFrameChannel={probeFrameChannel}
      />
    )

    probeFrameChannel.publish(secondFrame)
    mocks.selectedLayerId = 'dew_point'
    mocks.formatProbeValue = vi.fn()
    rerender(
      <ForecastPlaceProbes
        map={map}
        probeFrameChannel={probeFrameChannel}
      />
    )

    expect(mocks.session.destroy).toHaveBeenCalledTimes(1)
    expect(mocks.createForecastPlaceProbeSession).toHaveBeenCalledTimes(2)
    expect(mocks.createForecastPlaceProbeSession).toHaveBeenLastCalledWith({
      map,
      layerId: 'dew_point',
      valueFormatter: mocks.formatProbeValue,
    })
    expect(mocks.session.setFrame).toHaveBeenCalledWith(secondFrame)
  })

  it('recreates the session when the map changes', () => {
    const map = createMapFixture()
    const probeFrameChannel = createFrameChannel()

    const { rerender } = render(
      <ForecastPlaceProbes
        map={map}
        probeFrameChannel={probeFrameChannel}
      />
    )

    rerender(
      <ForecastPlaceProbes
        map={createMapFixture()}
        probeFrameChannel={probeFrameChannel}
      />
    )

    expect(mocks.session.destroy).toHaveBeenCalledTimes(1)
    expect(mocks.createForecastPlaceProbeSession).toHaveBeenCalledTimes(2)
  })

  it('applies the latest channel frame after subscribing', () => {
    const startingFrame = createRasterWindowFixture({ layerId: 'temperature', frame: 1 })
    const publishedFrame = createRasterWindowFixture({ layerId: 'temperature', frame: 2 })
    let snapshotFrame: ForecastPlaceProbeFrame = startingFrame
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
        map={createMapFixture()}
        probeFrameChannel={probeFrameChannel}
      />
    )

    expect(mocks.session.setFrame).toHaveBeenCalledWith(publishedFrame)
  })

  it('unsubscribes from the frame channel on unmount', () => {
    const frame = createRasterWindowFixture()
    const probeFrameChannel = createFrameChannel()

    const { unmount } = render(
      <ForecastPlaceProbes
        map={createMapFixture()}
        probeFrameChannel={probeFrameChannel}
      />
    )

    unmount()
    probeFrameChannel.publish(frame)

    expect(mocks.session.setFrame).not.toHaveBeenCalledWith(frame)
  })
})
