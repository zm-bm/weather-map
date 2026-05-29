import type {
  EncodedRasterBand,
  EncodedRasterFrame,
} from '@/forecast/frames'

export type EncodedGridBand = EncodedRasterBand
type GridSpec = EncodedRasterFrame['grid']

export type EncodedGridTextureSpec = {
  key: string
  grid: Pick<GridSpec, 'nx' | 'ny'>
  bands: readonly EncodedGridBand[]
}

export class EncodedGridTextureCache {
  private readonly entries = new Map<string, WebGLTexture>()
  private readonly limit: number

  constructor(limit = 12) {
    this.limit = limit
  }

  getOrCreate(
    gl: WebGL2RenderingContext,
    spec: EncodedGridTextureSpec
  ): WebGLTexture | null {
    const existing = this.entries.get(spec.key)
    if (existing) {
      this.entries.delete(spec.key)
      this.entries.set(spec.key, existing)
      return existing
    }

    const texture = createEncodedTextureArray(gl, spec)
    if (!texture) return null

    this.entries.set(spec.key, texture)
    this.evictOverflow(gl)
    return texture
  }

  clear(gl: WebGL2RenderingContext): void {
    for (const texture of this.entries.values()) {
      gl.deleteTexture(texture)
    }
    this.entries.clear()
  }

  private evictOverflow(gl: WebGL2RenderingContext): void {
    while (this.entries.size > this.limit) {
      const oldestKey = this.entries.keys().next().value as string | undefined
      if (oldestKey == null) return
      const oldestTexture = this.entries.get(oldestKey)
      this.entries.delete(oldestKey)
      if (oldestTexture) gl.deleteTexture(oldestTexture)
    }
  }
}

export function createEncodedTextureArray(
  gl: WebGL2RenderingContext,
  spec: EncodedGridTextureSpec
): WebGLTexture | null {
  const { nx, ny } = spec.grid
  const cellCount = nx * ny
  if (cellCount <= 0 || spec.bands.length === 0) return null

  const first = spec.bands[0]
  if (!first) return null
  for (const band of spec.bands) {
    if (band.length !== cellCount) return null
  }

  const texture = gl.createTexture()
  if (!texture) return null

  const upload = contiguousInt8Bands(spec.bands)

  try {
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.R8I,
      nx,
      ny,
      spec.bands.length,
      0,
      gl.RED_INTEGER,
      gl.BYTE,
      upload
    )
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)
    return texture
  } catch (error) {
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)
    gl.deleteTexture(texture)
    console.warn('[encodedGrid] failed to create texture array:', error)
    return null
  }
}

function contiguousInt8Bands(bands: readonly EncodedGridBand[]): Int8Array {
  const contiguous = contiguousBandView(bands)
  if (contiguous) return contiguous as Int8Array
  const out = new Int8Array(bands[0]!.length * bands.length)
  for (const [index, band] of bands.entries()) {
    out.set(band, index * band.length)
  }
  return out
}

function contiguousBandView(
  bands: readonly EncodedGridBand[]
): EncodedGridBand | null {
  const first = bands[0]
  if (!first) return null
  const bytesPerElement = first.BYTES_PER_ELEMENT
  const length = first.length
  for (const [index, band] of bands.entries()) {
    if (band.buffer !== first.buffer) return null
    if (band.BYTES_PER_ELEMENT !== bytesPerElement) return null
    if (band.byteOffset !== first.byteOffset + (index * length * bytesPerElement)) return null
    if (band.length !== length) return null
  }
  return new Int8Array(first.buffer, first.byteOffset, length * bands.length)
}
