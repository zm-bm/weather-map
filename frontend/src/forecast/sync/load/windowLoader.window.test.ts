import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createCloudLayersLayerSourceFixture,
  createContourSourceFixture,
  createGridFixture,
  createOverlaySourceFixture,
  createParticleSourceFixture,
  createRasterLayerSourceFixture,
  createScalarEncodingFixture,
} from '@/test/fixtures'
import type { ArtifactLoader, RawRasterBands } from '@/forecast/artifacts'
import type { ForecastTimeSliceSelection } from '@/forecast/time'
import { clampInterpolationMix, loadFrameWindow, loadWindows } from './windowLoader'
import { createForecastWindowPlanTestFixture } from './windowPlan.testHelpers'

describe('forecast interpolation window helpers', () => {
  it('loads both normalized hour tokens when interpolation is needed', async () => {
    const loadFrame = vi.fn(async (frameId: string) => ({ frameId }))

    const frameWindow = await loadFrameWindow({
      selection: {
        selectedValidTimeMs: Date.UTC(2026, 3, 9, 3, 30),
        lowerFrameId: '3',
        upperFrameId: '6',
        mix: 0.5,
      },
      loadFrame,
    })

    expect(loadFrame.mock.calls).toEqual([['003'], ['006']])
    expect(frameWindow.lower).toEqual({ frameId: '003' })
    expect(frameWindow.upper).toEqual({ frameId: '006' })
    expect(frameWindow.lowerFrameId).toBe('003')
    expect(frameWindow.upperFrameId).toBe('006')
    expect(frameWindow.mix).toBe(0.5)
  })

  it('reuses the lower frame when the effective hour pair collapses to one frame', async () => {
    const loadFrame = vi.fn(async (frameId: string) => ({ frameId }))

    const frameWindow = await loadFrameWindow({
      selection: {
        selectedValidTimeMs: Date.UTC(2026, 3, 9, 3, 0),
        lowerFrameId: '003',
        upperFrameId: '003',
        mix: 0.75,
      },
      loadFrame,
    })

    expect(loadFrame).toHaveBeenCalledOnce()
    expect(frameWindow.lower).toBe(frameWindow.upper)
    expect(frameWindow.mix).toBe(0)
    expect(frameWindow.upperFrameId).toBe('003')
  })

  it('reuses the previous upper frame as the next lower frame at rollover', async () => {
    const previousWindow = {
      lower: { frameId: '000' },
      upper: { frameId: '001' },
      selectedValidTimeMs: Date.UTC(2026, 3, 9, 0, 50),
      lowerFrameId: '000',
      upperFrameId: '001',
      mix: 0.5,
    }
    const loadFrame = vi.fn(async (frameId: string) => ({ frameId }))

    const frameWindow = await loadFrameWindow({
      selection: {
        selectedValidTimeMs: Date.UTC(2026, 3, 9, 1, 10),
        lowerFrameId: '001',
        upperFrameId: '002',
        mix: 0.1,
      },
      previousWindow,
      loadFrame,
    })

    expect(loadFrame.mock.calls).toEqual([['002']])
    expect(frameWindow.lower).toBe(previousWindow.upper)
    expect(frameWindow.upper).toEqual({ frameId: '002' })
  })

  it('clamps interpolation mix into the unit interval', () => {
    expect(clampInterpolationMix(Number.NaN)).toBe(0)
    expect(clampInterpolationMix(-1)).toBe(0)
    expect(clampInterpolationMix(0.25)).toBe(0.25)
    expect(clampInterpolationMix(2)).toBe(1)
  })
})

const loadRawRasterBands = vi.fn()

function rasterWindowPlan() {
  const source = createRasterLayerSourceFixture({ layerId: 'relative_humidity' })
  return createForecastWindowPlanTestFixture({
    id: 'raster',
    key: 'raster:key',
    failurePolicy: 'required',
    frames: [{
      source,
      artifactId: source.artifactId,
      bandIds: ['value'],
      cacheKeyPrefix: 'raster:key',
    }],
  })
}

function overlayForecastWindowFixture() {
  const source = createOverlaySourceFixture()
  return createForecastWindowPlanTestFixture({
    id: 'overlay',
    key: 'overlay:key',
    failurePolicy: 'optional',
    frames: [{
      source,
      artifactId: source.source.artifactId,
      bandIds: ['snow_frac', 'mix_frac'],
      cacheKeyPrefix: 'overlay:key',
      order: 'by-name',
      failurePolicy: 'optional',
    }],
  })
}

function contourWindowPlan() {
  const source = {
    ...createContourSourceFixture(),
    label: 'Pressure Contours',
  }
  return createForecastWindowPlanTestFixture({
    id: 'contour',
    key: 'contour:key',
    failurePolicy: 'optional',
    frames: [{
      source,
      artifactId: source.source.artifactId,
      bandIds: ['value'],
      cacheKeyPrefix: 'contour:key',
    }],
  })
}

function particlesWindowPlan() {
  const source = {
    ...createParticleSourceFixture(),
    label: 'Wind',
  }
  return createForecastWindowPlanTestFixture({
    id: 'particles',
    key: 'particles:key',
    failurePolicy: 'required',
    frames: [{
      source,
      artifactId: source.source.artifactId,
      bandIds: ['u', 'v'],
      cacheKeyPrefix: 'particles:key',
    }],
  })
}

function cloudLayersWindowPlan() {
  const source = createCloudLayersLayerSourceFixture()
  return createForecastWindowPlanTestFixture({
    id: 'raster',
    key: 'raster:key',
    failurePolicy: 'required',
    frames: [{
      source,
      artifactId: source.artifactId,
      bandIds: ['low', 'middle', 'high'],
      cacheKeyPrefix: 'raster:key',
    }],
  })
}

function rawRasterBands(
  artifactId: string,
  frameId: string,
  bandIds: readonly string[],
): RawRasterBands {
  const firstBandId = bandIds[0] ?? 'value'
  return {
    artifactId,
    frameId,
    grid: createGridFixture({
      id: 'test_grid',
      nx: 2,
      ny: 2,
      lon0: 0,
      lat0: 0,
      dx: 1,
      dy: -1,
    }),
    encoding: createScalarEncodingFixture({
      id: 'test_encoding',
    }),
    bandIds: [firstBandId, ...bandIds.slice(1)],
    bands: bandIds.map(() => new Int8Array([1, 2, 3, 4])),
  }
}

function artifacts(): ArtifactLoader {
  return {
    canLoadRasterBands: vi.fn(() => true),
    loadRawRasterBands,
  }
}

function createSelection(): ForecastTimeSliceSelection {
  return {
    selectedValidTimeMs: 123,
    lowerFrameId: '000',
    upperFrameId: '003',
    mix: 0.5,
  }
}

describe('loadWindows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadRawRasterBands.mockImplementation(async (
      artifactId: string,
      frameId: string,
      bandIds: readonly string[],
    ) => rawRasterBands(artifactId, frameId, bandIds))
  })

  it('loads planned forecast windows', async () => {
    const windowPlans = [
      rasterWindowPlan(),
      overlayForecastWindowFixture(),
      particlesWindowPlan(),
    ]

    await expect(loadWindows({ selection: createSelection(), windowPlans, artifacts: artifacts() })).resolves.toMatchObject({
      raster: {
        lower: { source: { layerId: 'relative_humidity' }, raster: { frameId: '000' } },
        upper: { source: { layerId: 'relative_humidity' }, raster: { frameId: '003' } },
        selectedValidTimeMs: 123,
        lowerFrameId: '000',
        upperFrameId: '003',
        mix: 0.5,
      },
      overlay: {
        lower: [{ raster: { artifactId: 'precip_type_surface', frameId: '000' } }],
        upper: [{ raster: { artifactId: 'precip_type_surface', frameId: '003' } }],
        selectedValidTimeMs: 123,
        lowerFrameId: '000',
        upperFrameId: '003',
        mix: 0.5,
      },
      particles: {
        lower: { raster: { artifactId: 'wind10m_uv', frameId: '000' } },
        upper: { raster: { artifactId: 'wind10m_uv', frameId: '003' } },
        selectedValidTimeMs: 123,
        lowerFrameId: '000',
        upperFrameId: '003',
        mix: 0.5,
      },
    })

    expect(loadRawRasterBands).toHaveBeenCalledTimes(6)
    expect(loadRawRasterBands.mock.calls.map(([artifactId]) => artifactId)).not.toContain('prmsl_msl')
  })

  it('loads only windows included in the plan', async () => {
    const windowPlans = [
      rasterWindowPlan(),
    ]

    await expect(loadWindows({ selection: createSelection(), windowPlans, artifacts: artifacts() })).resolves.toMatchObject({
      raster: {
        lower: { source: { layerId: 'relative_humidity' }, raster: { frameId: '000' } },
        upper: { source: { layerId: 'relative_humidity' }, raster: { frameId: '003' } },
        selectedValidTimeMs: 123,
        lowerFrameId: '000',
        upperFrameId: '003',
        mix: 0.5,
      },
    })

    expect(loadRawRasterBands).toHaveBeenCalledTimes(2)
  })

  it('loads cloud layer raster windows without probe-only coverage fields', async () => {
    const windowPlans = [cloudLayersWindowPlan()]

    const data = await loadWindows({ selection: createSelection(), windowPlans, artifacts: artifacts() })

    expect(data.raster?.lower).not.toHaveProperty('coverage')
    expect(data.raster).toMatchObject({
      lower: {
        source: { layerId: 'cloud_layers' },
        raster: { frameId: '000' },
      },
      upper: {
        source: { layerId: 'cloud_layers' },
        raster: { frameId: '003' },
      },
      selectedValidTimeMs: 123,
      lowerFrameId: '000',
      upperFrameId: '003',
      mix: 0.5,
    })
    expect(loadRawRasterBands).toHaveBeenCalledTimes(2)
  })

  it('loads optional pressure windows when planned', async () => {
    const windowPlans = [
      rasterWindowPlan(),
      contourWindowPlan(),
    ]

    await expect(loadWindows({ selection: createSelection(), windowPlans, artifacts: artifacts() })).resolves.toMatchObject({
      contour: {
        lower: { raster: { artifactId: 'prmsl_msl', frameId: '000' } },
        upper: { raster: { artifactId: 'prmsl_msl', frameId: '003' } },
        selectedValidTimeMs: 123,
        lowerFrameId: '000',
        upperFrameId: '003',
        mix: 0.5,
      },
    })

    expect(loadRawRasterBands.mock.calls.filter(([artifactId]) => artifactId === 'prmsl_msl'))
      .toHaveLength(2)
  })

  it('omits optional windows when they fail', async () => {
    const windowPlans = [
      rasterWindowPlan(),
      overlayForecastWindowFixture(),
      contourWindowPlan(),
    ]
    loadRawRasterBands.mockImplementation(async (
      artifactId: string,
      frameId: string,
      bandIds: readonly string[],
    ) => {
      if (artifactId === 'precip_type_surface' || artifactId === 'prmsl_msl') {
        throw new Error('optional missing')
      }
      return rawRasterBands(artifactId, frameId, bandIds)
    })

    await expect(loadWindows({ selection: createSelection(), windowPlans, artifacts: artifacts() })).resolves.toMatchObject({
      raster: {
        lower: { source: { layerId: 'relative_humidity' }, raster: { frameId: '000' } },
        upper: { source: { layerId: 'relative_humidity' }, raster: { frameId: '003' } },
      },
    })

    expect(loadRawRasterBands).toHaveBeenCalledTimes(6)
  })
})
