import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFetchErrorResponse, stubFetchJsonOnce } from '@/test/fetch'
import { fetchManifest } from './fetch'

afterEach(() => {
  vi.unstubAllGlobals()
})

function createForecastManifestPayload() {
  return {
    schema: 'weather-map.manifest-index',
    schema_version: 2,
    generated_at: '2026-05-16T00:00:00Z',
    catalog_version: 'forecast-catalog-v1',
    payload_contract: 'field-binary-v2',
    datasets: {
      gfs: {
        label: 'GFS',
        latest: {
          run: {
            cycle: '2026040900',
            run_id: '20260409T000000Z-abcdef12',
            payload_root: 'runs/gfs/2026040900/20260409T000000Z-abcdef12/payloads',
            generated_at: '2026-04-09T00:00:00Z',
            revision: 'test-revision',
          },
          frames: [
            {
              id: '000',
              lead_hours: 0,
              valid_at: '2026-04-09T00:00:00Z',
            },
          ],
          artifacts: {
            tmp_surface: {
              id: 'tmp_surface',
              kind: 'scalar',
              units: 'C',
              parameter: 'tmp',
              level: 'surface',
              components: ['value'],
              grid: {
                id: 'gfs_0p25_global',
                crs: 'EPSG:4326',
                nx: 2,
                ny: 2,
                lon0: 0,
                lat0: 0,
                dx: 1,
                dy: 1,
                origin: 'cell_center',
                layout: 'row_major',
                x_wrap: 'repeat',
                y_mode: 'clamp',
              },
              encoding: {
                id: 'tmp_surface_i8_v1',
                format: 'linear-i8-v1',
                dtype: 'int8',
                byte_order: 'none',
                nodata: -128,
                scale: 1,
                offset: 0,
                decode_formula: 'value = stored * scale + offset',
                finite_value_range: { min: -50, max: 50 },
              },
              byte_length: 4,
              payload_file: 'tmp_surface.i8.bin',
            },
          },
        },
      },
    },
    layers: {
      temperature: {
        datasets: {
          gfs: {
            state: 'available',
            support: 'native',
            required_artifacts: ['tmp_surface'],
            optional_artifacts: [],
          },
        },
      },
    },
  }
}

describe('fetchManifest', () => {
  it('fetches the manifest index', async () => {
    const fetchMock = stubFetchJsonOnce(createForecastManifestPayload())

    const manifest = await fetchManifest()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/manifests/index.json',
      expect.any(Object)
    )
    const artifact = manifest.datasets.gfs?.latest?.artifacts.tmp_surface
    expect(artifact?.byte_length).toBe(4)
    expect(artifact?.encoding.format).toBe('linear-i8-v1')
    if (artifact?.encoding.format !== 'linear-i8-v1') throw new Error('Expected linear int8 encoding')
    expect(artifact.encoding.finite_value_range).toEqual({ min: -50, max: 50 })
  })

  it('fails on non-ok responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createFetchErrorResponse(404, 'Not Found'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchManifest()).rejects.toThrow(
      'Failed to fetch manifest index: 404 Not Found'
    )
  })

  it('rejects payloads with the wrong schema', async () => {
    stubFetchJsonOnce({
      ...createForecastManifestPayload(),
      schema: 'weather-map.other',
    })

    await expect(fetchManifest()).rejects.toThrow()
  })
})
