import type { RadioPlaylistFetch } from '@/radio/playlist'
import { useRadioPlayer, type AudioFactory } from '@/radio/useRadioPlayer'

export type RadioButtonProps = {
  playlistUrl: string
  createAudio?: AudioFactory
  fetchPlaylist?: RadioPlaylistFetch
  random?: () => number
}

export default function RadioButton({
  playlistUrl,
  createAudio,
  fetchPlaylist,
  random,
}: RadioButtonProps) {
  const player = useRadioPlayer({
    playlistUrl,
    createAudio,
    fetchPlaylist,
    random,
  })

  const actionLabel = player.isPlaying ? 'Pause weather radio' : 'Play weather radio'
  const title = player.isUnavailable
    ? 'Weather radio unavailable'
    : (player.statusDetail ?? (
        player.currentTrackTitle
          ? `${actionLabel}: ${player.currentTrackTitle}`
          : actionLabel
      ))

  return (
    <div className="map-control-group">
      <button
        type="button"
        className={player.isPlaying
          ? 'map-control-button map-control-button--radio is-playing'
          : 'map-control-button map-control-button--radio'}
        title={title}
        aria-label={actionLabel}
        aria-pressed={player.isPlaying}
        disabled={player.isUnavailable || player.isLoading}
        onClick={() => {
          void player.toggle()
        }}
      >
        <span className="map-control-icon map-control-icon--radio" />
      </button>
    </div>
  )
}
