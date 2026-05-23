import { describe, expect, it } from 'vitest'

import { FORECAST_LAYERS_BY_ID } from '../../forecast-catalog'
import { createLayerDataSource } from '../../forecast-data-targets'
import {
  createGridFixture,
  createVectorEncodingFixture,
} from '../../test/fixtures'
import { materializeCloudLayersTimeSlice } from './load'

describe('materializeCloudLayersTimeSlice', () => {
  it('keeps low middle high components and derives composite coverage', () => {
    const grid = createGridFixture({ nx: 2, ny: 2 })
    const source = createCloudLayersSource()
    const slice = materializeCloudLayersTimeSlice(source, {
      artifactId: 'cloud_layers',
      hourToken: '003',
      grid,
      encoding: createVectorEncodingFixture({
        id: 'cloud_layers_vector_i8_2pct_v1',
        scale: 2,
        offset: 0,
        nodata: -128,
      }),
      componentIds: ['low', 'middle', 'high'],
      components: {
        low: new Int8Array([0, 25, -128, -128]),
        middle: new Int8Array([10, 0, -128, 10]),
        high: new Int8Array([50, 25, -128, -128]),
      },
    })

    expect(slice).toMatchObject({
      hourToken: '003',
      layerId: 'cloud_layers',
      artifactId: 'cloud_layers',
      grid,
    })
    expect(Array.from(slice.low)).toEqual([0, 25, -128, -128])
    expect(Array.from(slice.middle)).toEqual([10, 0, -128, 10])
    expect(Array.from(slice.high)).toEqual([50, 25, -128, -128])
    expect(Array.from(slice.coverage.values, (value) => Number.isNaN(value) ? 'NaN' : Number(value.toFixed(1)))).toEqual([
      100,
      75,
      'NaN',
      20,
    ])
  })

  it('rejects vectors that do not use low middle high component order', () => {
    expect(() => materializeCloudLayersTimeSlice(createCloudLayersSource(), {
      artifactId: 'cloud_layers',
      hourToken: '003',
      grid: createGridFixture({ nx: 1, ny: 1 }),
      encoding: createVectorEncodingFixture({ scale: 2, offset: 0, nodata: -128 }),
      componentIds: ['low', 'high', 'middle'],
      components: {
        low: new Int8Array([0]),
        middle: new Int8Array([0]),
        high: new Int8Array([0]),
      },
    })).toThrow('Cloud Layers requires components low, middle, high; got low, high, middle')
  })
})

function createCloudLayersSource() {
  const source = createLayerDataSource(FORECAST_LAYERS_BY_ID.cloud_layers!)
  if (source.kind !== 'cloudLayers') throw new Error('Expected cloud layer fixture')
  return source
}
