import { useEffect, useRef, useState } from 'react'

export type AudioLike = Pick<
  HTMLAudioElement,
  'loop' | 'preload' | 'volume' | 'paused' | 'addEventListener' | 'removeEventListener' | 'load' | 'play' | 'pause'
>

export type AudioFactory = (src: string) => AudioLike

type MusicControlViewProps = {
  src: string
  createAudio?: AudioFactory
}

const MUSIC_VOLUME = 0.45

const defaultCreateAudio: AudioFactory = (src) => new Audio(src)

export function MusicControlView({
  src,
  createAudio = defaultCreateAudio,
}: MusicControlViewProps) {
  const audioRef = useRef<AudioLike | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isUnavailable, setIsUnavailable] = useState(false)
  const [statusDetail, setStatusDetail] = useState<string | null>(null)

  useEffect(() => {
    const audio = createAudio(src)
    const handleError = () => {
      setIsPlaying(false)
      setIsUnavailable(true)
      setStatusDetail(null)
    }

    audio.loop = true
    audio.preload = 'metadata'
    audio.volume = MUSIC_VOLUME
    audio.addEventListener('error', handleError)
    audio.load()
    audioRef.current = audio
    setIsPlaying(false)
    setIsUnavailable(false)
    setStatusDetail(null)

    return () => {
      audio.pause()
      audio.removeEventListener('error', handleError)
      audioRef.current = null
    }
  }, [createAudio, src])

  const actionLabel = isPlaying ? 'Pause radio' : 'Play radio'
  const title = isUnavailable
    ? 'Music track unavailable'
    : (statusDetail ?? actionLabel)

  const handleToggle = async () => {
    const audio = audioRef.current
    if (!audio || isUnavailable) return

    if (audio.paused) {
      try {
        await audio.play()
        setIsPlaying(true)
        setStatusDetail(null)
      } catch {
        setIsPlaying(false)
        setStatusDetail('Playback blocked or unavailable')
      }
      return
    }

    audio.pause()
    setIsPlaying(false)
    setStatusDetail(null)
  }

  return (
    <div className="maplibregl-ctrl maplibregl-ctrl-group">
      <button
        type="button"
        className={isPlaying ? 'maplibregl-ctrl-music is-playing' : 'maplibregl-ctrl-music'}
        title={title}
        aria-label={actionLabel}
        aria-pressed={isPlaying}
        disabled={isUnavailable}
        onClick={() => {
          void handleToggle()
        }}
      >
        <span className="maplibregl-ctrl-icon maplibregl-ctrl-icon--music" />
      </button>
    </div>
  )
}
