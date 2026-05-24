import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ForecastPlaceProbeFrame,
  ForecastPlaceProbeFrameChannel,
} from '@/forecast/place-probes'
import {
  createFieldWindowFixture,
  createMapRefFixture,
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
    setLayerId: vi.fn(),
    setValueFormatter: vi.fn(),
    setFrame: vi.fn(),
  },
}))

vi.mock('@/forecast/selection', () => ({
  useForecastSelectionContext: () => ({
    activeRun: mocks.activeRun,
    selectedLayerId: mocks.selectedLayerId,
  }),
}))

vi.mock('./useForecastPlaceProbeValueFormatter', () => ({
  useForecastPlaceProbeValueFormatter: () => mocks.formatProbeValue,
}))

vi.mock('@/forecast/place-probes', () => ({
  createForecastPlaceProbeSession: (args: unknown) => mocks.createForecastPlaceProbeSession(args),
}))

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

describe('ForecastPlaceProbes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.activeRun = {}
    mocks.selectedLayerId = 'temperature'
    mocks.createForecastPlaceProbeSession.mockReturnValue(mocks.session)
  })

  it('does not create a session while forecast selection is unloaded', () => {
    mocks.activeRun = null
    const mapRef = createMapRefFixture()

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
    const mapRef = createMapRefFixture(map)
    const initialFrame = createFieldWindowFixture()
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
    const secondFrame = createFieldWindowFixture({ layerId: 'temperature', frame: 2 })
    const mapRef = createMapRefFixture()
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
    const mapRef = createMapRefFixture()
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
    const initialFrame = createFieldWindowFixture({ layerId: 'temperature', frame: 1 })
    const publishedFrame = createFieldWindowFixture({ layerId: 'temperature', frame: 2 })
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
        mapRef={createMapRefFixture()}
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
    const frame = createFieldWindowFixture()
    const mapRef = createMapRefFixture()
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
