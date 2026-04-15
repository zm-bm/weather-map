import config from '../../config'
import { joinUrl } from '../../url/joinUrl'
import { parseCycleManifest, parseLatestManifest } from './parse'
import type { CycleManifest, LatestManifest } from './types'

export async function fetchLatestManifest(opts?: { signal?: AbortSignal }): Promise<LatestManifest> {
  const latestUrl = joinUrl(config.manifestBaseUrl, 'latest.json')
  const res = await fetch(latestUrl, { signal: opts?.signal })
  if (!res.ok) throw new Error(`Failed to fetch latest manifest: ${res.status} ${res.statusText}`)
  return parseLatestManifest(await res.json())
}

export async function fetchCycleManifest(
  cycle: string,
  opts?: { signal?: AbortSignal }
): Promise<CycleManifest> {
  const cycleUrl = joinUrl(config.manifestBaseUrl, `${cycle}.json`)
  const res = await fetch(cycleUrl, { signal: opts?.signal })
  if (!res.ok) throw new Error(`Failed to fetch cycle manifest: ${res.status} ${res.statusText}`)
  return parseCycleManifest(await res.json())
}

export async function fetchCurrentManifest(opts?: { signal?: AbortSignal }): Promise<CycleManifest> {
  const latest = await fetchLatestManifest(opts)
  return fetchCycleManifest(latest.cycle, opts)
}
