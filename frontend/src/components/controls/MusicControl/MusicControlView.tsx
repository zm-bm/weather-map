import type { RadioPlaylistFetch } from './playlist'
import { useRadioPlayer, type AudioFactory } from './useRadioPlayer'

type MusicControlViewProps = {
  playlistUrl: string
  createAudio?: AudioFactory
  fetchPlaylist?: RadioPlaylistFetch
  random?: () => number
}

export function MusicControlView({
  playlistUrl,
  createAudio,
  fetchPlaylist,
  random,
}: MusicControlViewProps) {
  const player = useRadioPlayer({
    playlistUrl,
    createAudio,
    fetchPlaylist,
    random,
  })

  const actionLabel = player.isPlaying ? 'Pause radio' : 'Play radio'
  const title = player.isUnavailable
    ? 'Radio playlist unavailable'
    : (player.statusDetail ?? (
        player.currentTrackTitle
          ? `${actionLabel}: ${player.currentTrackTitle}`
          : actionLabel
      ))

  return (
    <div className="maplibregl-ctrl maplibregl-ctrl-group">
      <button
        type="button"
        className={player.isPlaying ? 'maplibregl-ctrl-music is-playing' : 'maplibregl-ctrl-music'}
        title={title}
        aria-label={actionLabel}
        aria-pressed={player.isPlaying}
        disabled={player.isUnavailable || player.isLoading}
        onClick={() => {
          void player.toggle()
        }}
      >
        <span className="maplibregl-ctrl-icon maplibregl-ctrl-icon--music" />
      </button>
    </div>
  )
}
