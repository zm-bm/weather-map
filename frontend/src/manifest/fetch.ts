import config from '../config'
import { joinUrl } from '../url/joinUrl'
import { parseCycleManifest } from './parse'
import type { CycleManifest } from './types'

export async function fetchCurrentManifest(opts?: { signal?: AbortSignal }): Promise<CycleManifest> {
  const latestUrl = joinUrl(config.manifestBaseUrl, 'latest.json')
  const res = await fetch(latestUrl, { signal: opts?.signal })
  if (!res.ok) throw new Error(`Failed to fetch current manifest: ${res.status} ${res.statusText}`)
  return parseCycleManifest(await res.json())
}
