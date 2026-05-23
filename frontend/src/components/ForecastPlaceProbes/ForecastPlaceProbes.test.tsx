import { render } from '@testing-library/react'
import type { RefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FieldInterpolationWindowData } from '../../forecast-data'
import ForecastPlaceProbes from './ForecastPlaceProbes'

const mocks = vi.hoisted(() => ({
  activeRun: {} as unknown,
  selectedLayerId: 'temperature' as string | null,
  formatProbeDisplay: vi.fn(),
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

vi.mock('../../forecast-probe', () => ({
  useForecastProbeValueFormatter: () => mocks.formatProbeDisplay,
}))

vi.mock('../../forecast-place-probes', () => ({
  createForecastPlaceProbeSession: (args: unknown) => mocks.createForecastPlaceProbeSession(args),
}))

function createMapRef(map = {}): RefObject<MapLibreMap | null> {
  return {
    current: map as MapLibreMap,
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
        appliedProbeField={null}
      />
    )

    expect(mocks.createForecastPlaceProbeSession).not.toHaveBeenCalled()
  })

  it('creates, starts, and destroys a feature session', () => {
    const map = {}
    const mapRef = createMapRef(map)
    const appliedProbeField = createProbeFrame()

    const { unmount } = render(
      <ForecastPlaceProbes
        mapRef={mapRef}
        mapReadyVersion={1}
        appliedProbeField={appliedProbeField}
      />
    )

    expect(mocks.createForecastPlaceProbeSession).toHaveBeenCalledWith({
      map,
      layerId: 'temperature',
      valueFormatter: mocks.formatProbeDisplay,
      appliedProbeField,
    })
    expect(mocks.session.start).toHaveBeenCalledTimes(1)

    unmount()

    expect(mocks.session.destroy).toHaveBeenCalledTimes(1)
  })

  it('forwards layer, formatter, and applied probe field changes', () => {
    const firstFrame = createProbeFrame('temperature', 1)
    const secondFrame = createProbeFrame('temperature', 2)
    const mapRef = createMapRef()

    const { rerender } = render(
      <ForecastPlaceProbes
        mapRef={mapRef}
        mapReadyVersion={1}
        appliedProbeField={firstFrame}
      />
    )

    mocks.selectedLayerId = 'dew_point'
    mocks.formatProbeDisplay = vi.fn()
    rerender(
      <ForecastPlaceProbes
        mapRef={mapRef}
        mapReadyVersion={1}
        appliedProbeField={secondFrame}
      />
    )

    expect(mocks.session.setLayerId).toHaveBeenLastCalledWith('dew_point')
    expect(mocks.session.setValueFormatter).toHaveBeenLastCalledWith(mocks.formatProbeDisplay)
    expect(mocks.session.setFrame).toHaveBeenLastCalledWith(secondFrame)
  })

  it('recreates the session when map readiness changes', () => {
    const mapRef = createMapRef()

    const { rerender } = render(
      <ForecastPlaceProbes
        mapRef={mapRef}
        mapReadyVersion={1}
        appliedProbeField={null}
      />
    )

    rerender(
      <ForecastPlaceProbes
        mapRef={mapRef}
        mapReadyVersion={2}
        appliedProbeField={null}
      />
    )

    expect(mocks.session.destroy).toHaveBeenCalledTimes(1)
    expect(mocks.createForecastPlaceProbeSession).toHaveBeenCalledTimes(2)
  })
})
