import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createArtifactLoader,
  type ArtifactLoader,
} from '@/forecast/artifacts'
import {
  type VectorEncodingSpec,
} from '@/forecast/manifest'
import {
  createActiveRunFixture,
  createConfigFixture,
  createGridFixture,
  createForecastSyncPlanFixture,
  createScalarArtifactFixture,
  createScalarEncodingFixture,
  createScalarPayloadFixture,
  createSignalFixture,
  createSingleTimeManifestFixture,
  createVectorArtifactFixture,
  createVectorPayloadFixture,
} from '@/test/fixtures'
import {
  createRasterProbeSampler,
  sampleRasterFrameWithSampler,
} from '@/forecast/place-probes'
import { stubFetchArrayBufferOnce } from '@/test/fetch'
import type { ForecastFrameMap, ForecastWindowId } from '@/forecast/frames'
import type {
  ForecastWindowPlan,
} from '../plan'
import { loadWindowFrame } from './windowLoader'

type PlannedWindowFor<K extends ForecastWindowId> =
  ForecastWindowPlan & {
    id: K
    loadFrame: (frameId: string) => Promise<ForecastFrameMap[K]>
  }

afterEach(() => {
  vi.unstubAllGlobals()
})

function plannedWindows(args: {
  manifest: ReturnType<typeof createSingleTimeManifestFixture>
  selectedLayerId?: string
  selectedParticleLayerId?: string | null
  syncOptions?: { contour?: boolean; particles?: boolean }
}): PlannedWindowFor<ForecastWindowId>[] {
  const activeRun = createActiveRunFixture(args.manifest)
  const targetTimeMs = Date.parse(activeRun.latest.frames[0]?.valid_at ?? '2026-04-13T12:00:00Z')
  const syncOptions = {
    contour: false,
    particles: false,
    ...args.syncOptions,
  }
  const plan = createForecastSyncPlanFixture({
    activeRun,
    selectedLayerId: args.selectedLayerId ?? 'temperature',
    selectedParticleLayerId: args.selectedParticleLayerId,
    contourSource: syncOptions.contour ? undefined : null,
    particleSource: syncOptions.particles ? undefined : null,
    targetTimeMs,
    syncOptions,
  })
  const artifacts = createArtifactLoader({
    config: createConfigFixture(),
    activeRun,
    signal: createSignalFixture(),
  })
  return plan.windowPlans.map((windowPlan) => ({
    ...windowPlan,
    loadFrame: (frameId: string) => loadWindowFrame(
      artifacts,
      windowPlan,
      frameId
    ) as Promise<ForecastFrameMap[ForecastWindowId]>,
  }))
}

function plannedWindow<K extends ForecastWindowId>(
  id: K,
  args: Parameters<typeof plannedWindows>[0]
): PlannedWindowFor<K> {
  const windowPlan = plannedWindows(args).find((entry) => entry.id === id) as PlannedWindowFor<K> | undefined
  if (windowPlan == null) throw new Error(`Expected ${id} window plan fixture`)
  return windowPlan
}

function maybePlannedWindow<K extends ForecastWindowId>(
  id: K,
  args: Parameters<typeof plannedWindows>[0]
): PlannedWindowFor<K> | null {
  return (plannedWindows(args).find((entry) => entry.id === id) as PlannedWindowFor<K> | undefined) ?? null
}

describe('window plan loading raster window', () => {
  it('loads direct raster artifacts and applies source display metadata', async () => {
    const payload = createScalarPayloadFixture([1, 2, 3, 4])
    const fetchMock = stubFetchArrayBufferOnce(payload)

    const manifest = createSingleTimeManifestFixture({
      cycle: '2026041100',
      generated_at: '2026-04-11T00:00:00Z',
      artifacts: {
        tmp_surface: createScalarArtifactFixture({
          grid: createGridFixture({
            crs: 'EPSG:4326',
            nx: 2,
            ny: 2,
            lon0: 0,
            lat0: 0,
            dx: 1,
            dy: -1,
            origin: 'cell_center',
            layout: 'row_major',
            x_wrap: 'repeat',
            y_mode: 'clamp',
          }),
          byte_length: 4,
        }),
      },
    })

    const load = plannedWindow('raster', { manifest })
    const frame = await load.loadFrame('000')

    expect(frame.source.layerId).toBe('temperature')
    expect(frame.source.display.range).toEqual({ min: -35, max: 50 })
    expect(frame.raster.grid.nx).toBe(2)
    expect(frame.source.bands[0].id).toBe('value')
    expect(frame.raster.cacheKey).toBe(`${load.frames[0].cacheKeyPrefix}:000`)
    expect(frame.raster.bandIds).toEqual(['value'])
    expect(Array.from(frame.raster.bands[0] ?? [])).toEqual([1, 2, 3, 4])
    const sampler = createRasterProbeSampler(frame, { lon: 0, lat: 0 })
    expect(sampler).not.toBeNull()
    expect(sampleRasterFrameWithSampler(frame, sampler!)).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reuses cached artifact payloads for repeated raster loads', async () => {
    const payload = createScalarPayloadFixture([1, 2, 3, 4])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createSingleTimeManifestFixture()
    const load = plannedWindow('raster', { manifest })

    const firstFrame = await load.loadFrame('000')
    const secondFrame = await load.loadFrame('000')

    expect(secondFrame).not.toBe(firstFrame)
    expect(secondFrame.raster).not.toBe(firstFrame.raster)
    expect(secondFrame.source.bands[0].id).toBe('value')
    expect(Array.from(secondFrame.raster.bands[0] ?? [])).toEqual([1, 2, 3, 4])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('derives wind speed rasters from vector u/v components', async () => {
    const payload = createVectorPayloadFixture([3, 0, -3, 0], [4, 0, -4, 0])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createSingleTimeManifestFixture({
      scalarArtifactIds: [],
      vectorArtifactIds: ['wind10m_uv'],
    })

    const frame = await plannedWindow('raster', {
      manifest,
      selectedLayerId: 'wind_speed',
    }).loadFrame('000')

    expect(frame.source.layerId).toBe('wind_speed')
    expect(frame.source.bands).toMatchObject([
      { id: 'u' },
      { id: 'v' },
    ])
    expect(frame.raster.bandIds).toEqual(['u', 'v'])
    expect(Array.from(frame.raster.bands[0] ?? [])).toEqual([3, 0, -3, 0])
    expect(Array.from(frame.raster.bands[1] ?? [])).toEqual([4, 0, -4, 0])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('loads precipitation rate as a direct scalar raster', async () => {
    const payload = createScalarPayloadFixture([10, 20, 30, 40])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createSingleTimeManifestFixture({
      cycle: '2026041200',
      scalarArtifactIds: ['prate_surface'],
      vectorArtifactIds: [],
    })

    const frame = await plannedWindow('raster', {
      manifest,
      selectedLayerId: 'precipitation_rate',
    }).loadFrame('000')

    expect(frame.source.layerId).toBe('precipitation_rate')
    expect(frame.source.bands[0]).toMatchObject({ id: 'value' })
    expect(Array.from(frame.raster.bands[0] ?? [])).toEqual([10, 20, 30, 40])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('loads cloud layer raster bands with generic raster cache keys', async () => {
    const payload = createVectorPayloadFixture(
      [0, 6, 13, 25],
      [0, 5, 10, 20],
      [0, 3, 8, 15],
    )
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createSingleTimeManifestFixture({
      cycle: '2026041000',
      artifacts: {
        cloud_layers: createVectorArtifactFixture({
          id: 'cloud_layers',
          components: ['low', 'middle', 'high'],
        }),
      },
    })

    const load = plannedWindow('raster', {
      manifest,
      selectedLayerId: 'cloud_layers',
    })
    const frame = await load.loadFrame('000')

    expect(frame.raster.cacheKey).toBe(`${load.frames[0].cacheKeyPrefix}:000`)
    expect(frame.raster.bandIds).toEqual(['low', 'middle', 'high'])
    expect(frame.raster.bands).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('window plan loading overlay window', () => {
  it('loads precipitation type overlays as generic overlay frames', async () => {
    const payload = createVectorPayloadFixture([0, 25, 50, 100], [0, 10, 20, 40])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        prate_surface: createScalarArtifactFixture({ id: 'prate_surface' }),
        precip_type_surface: createVectorArtifactFixture({
          id: 'precip_type_surface',
          components: ['snow_frac', 'mix_frac'],
        }),
      },
    })
    const load = plannedWindow('overlay', {
      manifest,
      selectedLayerId: 'precipitation_rate',
    })

    const slice = await load.loadFrame('0')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(load.id).toBe('overlay')
    expect(load.failurePolicy).toBe('optional')
    expect(slice).toHaveLength(1)
    expect(slice[0]).toMatchObject({
      source: {
        id: 'precipitation_type',
        style: 'precipitation-type-pattern',
        source: {
          artifactId: 'precip_type_surface',
          bands: [{ id: 'snow_frac' }, { id: 'mix_frac' }],
        },
      },
      raster: {
        frameId: '000',
        artifactId: 'precip_type_surface',
        cacheKey: `${load.frames[0].cacheKeyPrefix}:000`,
        bandIds: ['snow_frac', 'mix_frac'],
      },
    })
  })

  it('omits unsupported overlay artifacts before fetching', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        prate_surface: createScalarArtifactFixture({ id: 'prate_surface' }),
        precip_type_surface: createVectorArtifactFixture({
          id: 'precip_type_surface',
          components: ['u', 'v'],
        }),
      },
    })

    const load = maybePlannedWindow('overlay', {
      manifest,
      selectedLayerId: 'precipitation_rate',
    })

    expect(load).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('window plan loading contour window', () => {
  it('loads raw pressure from prmsl_msl with encoding metadata and cache key', async () => {
    const grid = createGridFixture({ nx: 2, ny: 1 })
    const encoding = createScalarEncodingFixture({
      id: 'prmsl_msl_i8_50pa_v1',
      format: 'linear-i8-v1',
      dtype: 'int8',
      byte_order: 'none',
      scale: 50,
      offset: 100500,
      nodata: -128,
    })
    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        tmp_surface: createScalarArtifactFixture({ id: 'tmp_surface' }),
        prmsl_msl: createScalarArtifactFixture({
          id: 'prmsl_msl',
          units: 'Pa',
          grid,
          encoding,
        }),
      },
    })
    const loadRawRasterBands = vi.fn().mockResolvedValue({
      artifactId: 'prmsl_msl',
      frameId: '003',
      grid,
      encoding,
      bandIds: ['value'],
      bands: [new Int8Array([-10, -128])],
    })

    const contourPlan = plannedWindow('contour', { manifest, syncOptions: { contour: true } })
    const artifacts = {
      canLoadRasterBands: vi.fn(() => true),
      loadRawRasterBands,
    } satisfies ArtifactLoader

    const slice = await loadWindowFrame(artifacts, contourPlan, '3') as ForecastFrameMap['contour']

    expect(slice).toMatchObject({
      source: {
        id: 'pressure_contours',
        source: {
          artifactId: 'prmsl_msl',
          bands: [{ id: 'value' }],
        },
      },
      raster: {
        frameId: '003',
        artifactId: 'prmsl_msl',
        cacheKey: `${contourPlan.frames[0].cacheKeyPrefix}:003`,
        grid,
        encoding,
        bandIds: ['value'],
      },
    })
    expect(slice?.raster.bands[0]).toBeInstanceOf(Int8Array)
    expect(Array.from(slice?.raster.bands[0] ?? [])).toEqual([-10, -128])
    expect(loadRawRasterBands).toHaveBeenCalledWith('prmsl_msl', '3', ['value'], { order: undefined })
    expect(slice).not.toHaveProperty('pressureHpa')
  })
})

describe('window plan loading particle window', () => {
  function windVectorLoad(
    manifest: ReturnType<typeof createSingleTimeManifestFixture>
  ): PlannedWindowFor<'particles'>
  function windVectorLoad(
    manifest: ReturnType<typeof createSingleTimeManifestFixture>,
    options: { requireLoad: false }
  ): PlannedWindowFor<'particles'> | null
  function windVectorLoad(
    manifest: ReturnType<typeof createSingleTimeManifestFixture>,
    options: { requireLoad?: boolean } = {}
  ) {
    const load = maybePlannedWindow('particles', {
      manifest,
      selectedParticleLayerId: 'wind',
      syncOptions: { particles: true },
    })
    if ((options.requireLoad ?? true) && load == null) {
      throw new Error('Expected wind vector window plan fixture')
    }
    return load
  }

  it('loads wind vector channels from vector artifacts', async () => {
    const payload = createVectorPayloadFixture([1, -2, 3, -4], [-5, 6, -7, 8])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createSingleTimeManifestFixture({
      cycle: '2026041200',
    })

    const load = windVectorLoad(manifest)
    const frame = await load.loadFrame('000')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(frame.source).toEqual({
      id: 'wind',
      source: {
        artifactId: 'wind10m_uv',
        bands: [{ id: 'u' }, { id: 'v' }],
      },
    })
    expect(frame.raster.cacheKey).toBe(`${load.frames[0].cacheKeyPrefix}:000`)
    expect(frame.raster.bandIds).toEqual(['u', 'v'])
    expect(Array.from(frame.raster.bands[0] ?? [])).toEqual([1, -2, 3, -4])
    expect(Array.from(frame.raster.bands[1] ?? [])).toEqual([-5, 6, -7, 8])
    expect(frame.raster.frameId).toBe('000')
  })

  it('rejects unsupported wind vector metadata before fetching payloads', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const baseEncoding = createVectorArtifactFixture().encoding

    const unsupportedDtype = windVectorLoad(createSingleTimeManifestFixture({
      artifacts: {
        tmp_surface: createScalarArtifactFixture(),
        wind10m_uv: createVectorArtifactFixture({
          encoding: {
            ...baseEncoding,
            dtype: 'int16',
          } as unknown as VectorEncodingSpec,
        }),
      },
    }))

    await expect(unsupportedDtype.loadFrame('000'))
      .rejects.toThrow('Unsupported vector dtype for wind10m_uv: int16')

    expect(
      windVectorLoad(createSingleTimeManifestFixture({
        artifacts: {
          tmp_surface: createScalarArtifactFixture(),
          wind10m_uv: createVectorArtifactFixture({
            components: ['v', 'u'],
          }),
        },
      }), { requireLoad: false })
    ).toBeNull()

    expect(
      windVectorLoad(createSingleTimeManifestFixture({
        artifacts: {
          tmp_surface: createScalarArtifactFixture(),
          wind10m_uv: createVectorArtifactFixture({
            encoding: {
              ...baseEncoding,
              scale: 0.5,
            },
          }),
        },
      }), { requireLoad: false })
    ).not.toBeNull()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves wind vector scale and offset metadata for shader decode', async () => {
    const payload = createVectorPayloadFixture([2, -4, 6, -8], [-10, 12, -14, 16])
    stubFetchArrayBufferOnce(payload)
    const baseEncoding = createVectorArtifactFixture().encoding
    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        tmp_surface: createScalarArtifactFixture(),
        wind10m_uv: createVectorArtifactFixture({
          encoding: {
            ...baseEncoding,
            scale: 0.5,
            offset: 0.25,
          },
        }),
      },
    })

    const frame = await windVectorLoad(manifest).loadFrame('000')

    expect((frame.raster.encoding as VectorEncodingSpec).scale).toBe(0.5)
    expect((frame.raster.encoding as VectorEncodingSpec).offset).toBe(0.25)
    expect(Array.from(frame.raster.bands[0] ?? [])).toEqual([2, -4, 6, -8])
  })

  it('rejects wind-vector artifacts assigned to another kind during plan resolution', () => {
    expect(() => (
      windVectorLoad(createSingleTimeManifestFixture({
        artifacts: {
          tmp_surface: createScalarArtifactFixture(),
          wind10m_uv: {
            ...createScalarArtifactFixture(),
            id: 'wind10m_uv',
          },
        },
      }), { requireLoad: false })
    )).toThrow('Particle layer wind requires vector artifact wind10m_uv, got scalar')
  })
})
