import { describe, expect, it, vi } from 'vitest'

import { createGridFixture } from '@/test/fixtures'
import { createEncodedTextureArray, EncodedGridTextureCache } from './texture'

function createMockWebGl2() {
  return {
    TEXTURE_2D_ARRAY: 35866,
    UNPACK_ALIGNMENT: 3317,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    NEAREST: 9728,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    REPEAT: 10497,
    CLAMP_TO_EDGE: 33071,
    R8I: 33329,
    RED_INTEGER: 36244,
    BYTE: 5120,
    createTexture: vi.fn(() => ({})),
    bindTexture: vi.fn(),
    pixelStorei: vi.fn(),
    texParameteri: vi.fn(),
    texImage3D: vi.fn(),
    deleteTexture: vi.fn(),
  }
}

describe('encoded grid texture upload', () => {
  it('uploads int8 bands as R8I texture arrays', () => {
    const gl = createMockWebGl2()
    const grid = createGridFixture({ nx: 2, ny: 2 })
    const bands = [
      new Int8Array([1, 2, 3, 4]),
      new Int8Array([5, 6, 7, 8]),
    ]

    const texture = createEncodedTextureArray(gl as never, {
      key: 'fixture:int8',
      grid,
      bands,
    })

    expect(texture).not.toBeNull()
    expect(gl.texImage3D).toHaveBeenCalledWith(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.R8I,
      2,
      2,
      2,
      0,
      gl.RED_INTEGER,
      gl.BYTE,
      expect.any(Int8Array)
    )
  })

  it('reuses cached textures by key', () => {
    const gl = createMockWebGl2()
    const grid = createGridFixture({ nx: 1, ny: 1 })
    const cache = new EncodedGridTextureCache()

    const first = cache.getOrCreate(gl as never, {
      key: 'fixture:cached',
      grid,
      bands: [new Int8Array([1])],
    })
    const second = cache.getOrCreate(gl as never, {
      key: 'fixture:cached',
      grid,
      bands: [new Int8Array([2])],
    })

    expect(second).toBe(first)
    expect(gl.texImage3D).toHaveBeenCalledTimes(1)
  })

  it('refreshes LRU order and evicts the oldest texture over the cache limit', () => {
    const gl = createMockWebGl2()
    const textureObjects = [
      { id: 'first' },
      { id: 'second' },
      { id: 'third' },
    ]
    gl.createTexture.mockImplementation(() => textureObjects.shift() ?? {})
    const grid = createGridFixture({ nx: 1, ny: 1 })
    const cache = new EncodedGridTextureCache(2)

    const first = cache.getOrCreate(gl as never, {
      key: 'fixture:first',
      grid,
      bands: [new Int8Array([1])],
    })
    const second = cache.getOrCreate(gl as never, {
      key: 'fixture:second',
      grid,
      bands: [new Int8Array([2])],
    })
    const firstAgain = cache.getOrCreate(gl as never, {
      key: 'fixture:first',
      grid,
      bands: [new Int8Array([3])],
    })
    const third = cache.getOrCreate(gl as never, {
      key: 'fixture:third',
      grid,
      bands: [new Int8Array([4])],
    })

    expect(firstAgain).toBe(first)
    expect(third).not.toBeNull()
    expect(gl.deleteTexture).toHaveBeenCalledWith(second)
    expect(gl.deleteTexture).not.toHaveBeenCalledWith(first)
  })
})
