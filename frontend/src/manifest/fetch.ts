import config from '../config'
import { DEFAULT_FORECAST_MODEL_ID, type ForecastModelId } from '../forecast-models'
import { joinUrl } from '../url/joinUrl'
import { parseCycleManifest } from './parse'
import type { CycleManifest } from './types'

export async function fetchCurrentManifest(opts?: {
  modelId?: ForecastModelId
  signal?: AbortSignal
}): Promise<CycleManifest> {
  const modelId = opts?.modelId ?? DEFAULT_FORECAST_MODEL_ID
  const latestUrl = joinUrl(config.artifactBaseUrl, `manifests/${modelId}/latest.json`)
  const res = await fetch(latestUrl, { signal: opts?.signal })
  if (!res.ok) throw new Error(`Failed to fetch current manifest: ${res.status} ${res.statusText}`)
  return parseCycleManifest(await res.json())
}
