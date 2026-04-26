import type { WeatherMapConfig } from '../config'
import type { CycleManifest } from '../manifest'
import { loadFramePayload, normalizeFrameHourToken } from './loader'
import { resolveFrameSpec, type FrameKind } from './spec'

export type PrefetchFramePayloadsArgs = {
  config: WeatherMapConfig
  manifest: CycleManifest
  frameKind: FrameKind
  variableId: string
  hourTokens: string[]
  signal: AbortSignal
}

export async function prefetchFramePayloads(
  args: PrefetchFramePayloadsArgs
): Promise<void> {
  await Promise.all(
    uniqueNormalizedHourTokens(args.hourTokens).map((hourToken) => {
      const spec = resolveFrameSpec(
        args.manifest,
        hourToken,
        args.variableId,
        args.frameKind
      )

      return loadFramePayload({
        config: args.config,
        manifest: args.manifest,
        frameRef: spec.frameRef,
        grid: spec.grid,
        hourToken,
        variableId: args.variableId,
        frameKind: args.frameKind,
        signal: args.signal,
        verifyPayloadSha256: args.config.verifyPayloadSha256,
      })
    })
  )
}

function uniqueNormalizedHourTokens(hourTokens: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const hourToken of hourTokens) {
    const normalized = normalizeFrameHourToken(hourToken)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    unique.push(normalized)
  }

  return unique
}
