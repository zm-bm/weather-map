import type { CustomRenderMethodInput } from 'maplibre-gl'
import * as twgl from 'twgl.js'

import { createProgramInfo, type ProgramInfo } from './programs'

export type ProjectionUniformValues = {
  u_projection_matrix: CustomRenderMethodInput['defaultProjectionData']['mainMatrix']
  u_projection_tile_mercator_coords: CustomRenderMethodInput['defaultProjectionData']['tileMercatorCoords']
  u_projection_clipping_plane: CustomRenderMethodInput['defaultProjectionData']['clippingPlane']
  u_projection_transition: CustomRenderMethodInput['defaultProjectionData']['projectionTransition']
  u_projection_fallback_matrix: CustomRenderMethodInput['defaultProjectionData']['fallbackMatrix']
}

export type ProjectionProgramCache = {
  get(input: CustomRenderMethodInput): ProgramInfo | null
  clear(): void
}

export function createProjectionProgramCache(args: {
  gl: WebGL2RenderingContext
  label: string
  vertexSource: string
  fragmentSource: string
  options?: twgl.ProgramOptions
}): ProjectionProgramCache {
  const { gl, label, vertexSource, fragmentSource, options } = args
  const programs = new Map<string, ProgramInfo | null>()

  return {
    get(input) {
      const key = input.shaderData.variantName
      if (programs.has(key)) {
        return programs.get(key) ?? null
      }

      const programInfo = createProgramInfo({
        gl,
        label: `${label}:${key}`,
        vertexSource: buildProjectionVertexSource(vertexSource, input),
        fragmentSource,
        options,
      })
      programs.set(key, programInfo)
      return programInfo
    },
    clear() {
      for (const programInfo of programs.values()) {
        if (programInfo) gl.deleteProgram(programInfo.program)
      }
      programs.clear()
    },
  }
}

export function buildProjectionVertexSource(
  vertexSource: string,
  input: Pick<CustomRenderMethodInput, 'shaderData'>
): string {
  const injection = `${input.shaderData.vertexShaderPrelude}\n${input.shaderData.define}`
  const versionLine = /^(#version\s+300\s+es[^\n]*\n)/
  if (!versionLine.test(vertexSource)) {
    return `${injection}\n${vertexSource}`
  }
  return vertexSource.replace(versionLine, `$1${injection}\n`)
}

export function projectionUniformValues(input: CustomRenderMethodInput): ProjectionUniformValues {
  const {
    mainMatrix,
    tileMercatorCoords,
    clippingPlane,
    projectionTransition,
    fallbackMatrix,
  } = input.defaultProjectionData

  return {
    u_projection_matrix: mainMatrix,
    u_projection_tile_mercator_coords: tileMercatorCoords,
    u_projection_clipping_plane: clippingPlane,
    u_projection_transition: projectionTransition,
    u_projection_fallback_matrix: fallbackMatrix,
  }
}

export function isGlobeProjectionActive(input: CustomRenderMethodInput): boolean {
  return input.defaultProjectionData.projectionTransition > 0
}
