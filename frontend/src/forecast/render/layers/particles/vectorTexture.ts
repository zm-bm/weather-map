import type { ParticlesWindow } from '@/forecast/frames'
import {
  sourceBandIds,
} from '@/forecast/catalog/source'
import { encodedRasterBandIdMismatch } from '../../encodedGrid'
import { toCellCenterOrigin } from './geo'

type ParticleFrame = ParticlesWindow['lower']
type VectorRasterEncoding = {
  scale: number
  offset: number
}

export type PackedVectorFramePair = {
  lowerFrame: ParticleFrame
  upperFrame: ParticleFrame
  lowerTexture: WebGLTexture
  upperTexture: WebGLTexture
  timeMix: number
}

export function createPackedVectorFramePair(
  gl: WebGL2RenderingContext,
  window: ParticlesWindow,
  previousFramePair: PackedVectorFramePair | null,
): PackedVectorFramePair | null {
  const lowerFrame = window.lower
  const canBlend = window.mix > 0
  const upperFrame = canBlend ? window.upper : window.lower
  const reusableTextureLower = findReusableVectorTexture(previousFramePair, lowerFrame)
  const reusableTextureUpper = upperFrame === lowerFrame
    ? reusableTextureLower
    : findReusableVectorTexture(previousFramePair, upperFrame)
  const createdTextureLower = reusableTextureLower ? null : createVectorTexture(gl, lowerFrame)
  const nextTextureLower = reusableTextureLower ?? createdTextureLower
  if (!nextTextureLower) {
    console.warn('[particles] failed to upload live vector texture; keeping previous texture')
    return null
  }
  const createdTextureUpper = upperFrame === lowerFrame || reusableTextureUpper
    ? null
    : createVectorTexture(gl, upperFrame)
  const nextTextureUpper = upperFrame === lowerFrame
    ? nextTextureLower
    : reusableTextureUpper ?? createdTextureUpper
  if (!nextTextureUpper) {
    if (createdTextureLower) gl.deleteTexture(createdTextureLower)
    console.warn('[particles] failed to upload live vector texture; keeping previous texture')
    return null
  }

  return {
    lowerFrame,
    upperFrame,
    lowerTexture: nextTextureLower,
    upperTexture: nextTextureUpper,
    timeMix: upperFrame === lowerFrame ? 0 : window.mix,
  }
}

export function deletePackedVectorFramePairTextures(
  gl: WebGL2RenderingContext,
  framePair: PackedVectorFramePair | null,
  nextFramePair: PackedVectorFramePair | null = null,
): void {
  if (!framePair) return
  const nextTextures = new Set<WebGLTexture>()
  if (nextFramePair) {
    nextTextures.add(nextFramePair.lowerTexture)
    nextTextures.add(nextFramePair.upperTexture)
  }

  for (const texture of new Set([framePair.lowerTexture, framePair.upperTexture])) {
    if (!nextTextures.has(texture)) gl.deleteTexture(texture)
  }
}

export function packedVectorFramePairSignature(framePair: PackedVectorFramePair | null): string | null {
  if (!framePair) return null
  return [
    framePair.lowerFrame.raster.artifactId,
    framePair.lowerFrame.raster.hourToken,
    framePair.upperFrame.raster.hourToken,
  ].join(':')
}

export function packedVectorFramePairUniforms(framePair: PackedVectorFramePair) {
  const { lowerFrame } = framePair
  const { raster } = lowerFrame
  const encoding = raster.encoding as VectorRasterEncoding
  const samplingOrigin = toCellCenterOrigin(
    raster.grid.lon0,
    raster.grid.lat0,
    raster.grid.dx,
    raster.grid.dy,
  )

  return {
    u_lon0: samplingOrigin.lon0,
    u_lat0: samplingOrigin.lat0,
    u_dx: raster.grid.dx,
    u_dy: raster.grid.dy,
    u_vector_scale: encoding.scale,
    u_vector_offset: encoding.offset,
    u_vector_size: [raster.grid.nx, raster.grid.ny],
    u_time_mix: framePair.timeMix,
    u_vector_tex_lower: framePair.lowerTexture,
    u_vector_tex_upper: framePair.upperTexture,
  }
}

function findReusableVectorTexture(
  framePair: PackedVectorFramePair | null,
  frame: ParticleFrame,
): WebGLTexture | null {
  if (!framePair) return null
  if (framePair.lowerFrame === frame) return framePair.lowerTexture
  if (framePair.upperFrame === frame) return framePair.upperTexture
  return null
}

function createVectorTexture(gl: WebGL2RenderingContext, frame: ParticleFrame) {
  const componentBytes = frame.raster.grid.nx * frame.raster.grid.ny
  const [u, v] = frame.raster.bands
  const bandMismatch = encodedRasterBandIdMismatch({
    raster: frame.raster,
    expectedBandIds: sourceBandIds(frame.source.source),
    label: 'particles vector',
  })
  if (bandMismatch) {
    console.warn(`[particles] ${bandMismatch}`)
    return null
  }
  if (u.length !== componentBytes || v.length !== componentBytes) {
    console.warn('[particles] unexpected vector component sizes')
    return null
  }

  const bytes = interleaveVectorComponents(frame)

  let texture: WebGLTexture | null = null
  try {
    texture = gl.createTexture()
    if (!texture) return null

    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RG8I,
      frame.raster.grid.nx,
      frame.raster.grid.ny,
      0,
      gl.RG_INTEGER,
      gl.BYTE,
      bytes,
    )
    gl.bindTexture(gl.TEXTURE_2D, null)

    return texture
  } catch (error) {
    gl.bindTexture(gl.TEXTURE_2D, null)
    if (texture) gl.deleteTexture(texture)
    console.warn('[particles] failed to create vector texture:', error)
    return null
  }
}

function interleaveVectorComponents(frame: ParticleFrame): Int8Array {
  const componentBytes = frame.raster.grid.nx * frame.raster.grid.ny
  const [u, v] = frame.raster.bands
  const bytes = new Int8Array(componentBytes * 2)
  for (let i = 0; i < componentBytes; i += 1) {
    const base = i * 2
    bytes[base] = u[i] ?? 0
    bytes[base + 1] = v[i] ?? 0
  }
  return bytes
}
