import config from '../config'
import { joinUrl } from '../url/joinUrl'
import { parseCycleManifest } from './parse'
import type { CycleManifest } from './schema'

export async function fetchCurrentManifest(opts: {
  manifestPath: string
  signal?: AbortSignal
}): Promise<CycleManifest> {
  const latestUrl = joinUrl(config.artifactBaseUrl, opts.manifestPath)
  const res = await fetch(latestUrl, { signal: opts.signal })
  if (!res.ok) throw new Error(`Failed to fetch current manifest: ${res.status} ${res.statusText}`)
  return parseCycleManifest(await res.json())
}
