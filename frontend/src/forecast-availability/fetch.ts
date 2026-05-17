import config from '../config'
import { joinUrl } from '../url/joinUrl'
import { parseAvailabilityIndex } from './parse'
import type { ModelLayerAvailabilityIndex } from './schema'

export async function fetchAvailabilityIndex(opts?: {
  signal?: AbortSignal
}): Promise<ModelLayerAvailabilityIndex> {
  const availabilityUrl = joinUrl(config.artifactBaseUrl, 'manifests/availability-index.json')
  const res = await fetch(availabilityUrl, { signal: opts?.signal })
  if (!res.ok) throw new Error(`Failed to fetch availability index: ${res.status} ${res.statusText}`)
  return parseAvailabilityIndex(await res.json())
}
