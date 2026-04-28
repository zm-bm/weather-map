export type RadioPlaylistTrack = {
  src: string
  title: string
}

type RadioPlaylistFetchResponse = {
  ok: boolean
  status?: number
  statusText?: string
  json?: () => Promise<unknown>
}

export type RadioPlaylistFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<RadioPlaylistFetchResponse>

type FetchRadioPlaylistArgs = {
  playlistUrl: string
  fetchPlaylist?: RadioPlaylistFetch
  signal?: AbortSignal
}

const defaultFetchRadioPlaylist: RadioPlaylistFetch = (input, init) => fetch(input, init)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function deriveTrackTitle(src: string): string {
  const pathSegment = src.split('/').pop() ?? src
  const rawFilename = pathSegment.split(/[?#]/)[0] ?? pathSegment
  let filename = rawFilename

  try {
    filename = decodeURIComponent(rawFilename)
  } catch {
    filename = rawFilename
  }

  return filename.replace(/\.[^.]+$/, '').trim() || 'Untitled track'
}

export function parseRadioPlaylist(payload: unknown): RadioPlaylistTrack[] {
  if (!isRecord(payload) || !Array.isArray(payload.tracks)) {
    throw new Error('Radio playlist must contain a tracks array')
  }

  const tracks = payload.tracks.flatMap((entry): RadioPlaylistTrack[] => {
    if (typeof entry === 'string') {
      const src = entry.trim()
      return src ? [{ src, title: deriveTrackTitle(src) }] : []
    }

    if (!isRecord(entry) || typeof entry.src !== 'string') {
      return []
    }

    const src = entry.src.trim()
    if (!src) return []

    const title = typeof entry.title === 'string' && entry.title.trim()
      ? entry.title.trim()
      : deriveTrackTitle(src)

    return [{ src, title }]
  })

  if (tracks.length === 0) {
    throw new Error('Radio playlist is empty')
  }

  return tracks
}

export async function fetchRadioPlaylist({
  playlistUrl,
  fetchPlaylist = defaultFetchRadioPlaylist,
  signal,
}: FetchRadioPlaylistArgs): Promise<RadioPlaylistTrack[]> {
  const response = await fetchPlaylist(playlistUrl, { signal })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch radio playlist: ${response.status ?? 0} ${response.statusText ?? 'Unknown Error'}`
    )
  }

  if (typeof response.json !== 'function') {
    throw new Error('Radio playlist response is not JSON')
  }

  return parseRadioPlaylist(await response.json())
}

export function resolveRadioTrackUrl(
  track: RadioPlaylistTrack,
  playlistUrl: string,
): string {
  return new URL(track.src, playlistUrl).toString()
}
