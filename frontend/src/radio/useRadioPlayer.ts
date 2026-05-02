import { useEffect, useRef, useState } from 'react'

import {
  fetchRadioPlaylist,
  resolveRadioTrackUrl,
  type RadioPlaylistFetch,
  type RadioPlaylistTrack,
} from './playlist'

export type AudioLike = Pick<
  HTMLAudioElement,
  'loop' | 'preload' | 'volume' | 'paused' | 'addEventListener' | 'removeEventListener' | 'load' | 'play' | 'pause'
>

export type AudioFactory = (src: string) => AudioLike

export type RadioPlayerState = {
  isPlaying: boolean
  isLoading: boolean
  isUnavailable: boolean
  currentTrackTitle: string | null
  statusDetail: string | null
  toggle: () => Promise<void>
}

type UseRadioPlayerOptions = {
  playlistUrl: string
  createAudio?: AudioFactory
  fetchPlaylist?: RadioPlaylistFetch
  random?: () => number
}

const RADIO_VOLUME = 0.45

const defaultCreateAudio: AudioFactory = (src) => new Audio(src)

function buildRandomQueue(
  tracks: readonly RadioPlaylistTrack[],
  random: () => number,
): RadioPlaylistTrack[] {
  const remaining = [...tracks]
  const queue: RadioPlaylistTrack[] = []

  while (remaining.length > 0) {
    const index = Math.min(
      remaining.length - 1,
      Math.floor(random() * remaining.length),
    )
    const [track] = remaining.splice(index, 1)
    if (track) queue.push(track)
  }

  return queue
}

export function useRadioPlayer({
  playlistUrl,
  createAudio = defaultCreateAudio,
  fetchPlaylist,
  random = Math.random,
}: UseRadioPlayerOptions): RadioPlayerState {
  const audioRef = useRef<AudioLike | null>(null)
  const audioCleanupRef = useRef<(() => void) | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const playlistPromiseRef = useRef<Promise<RadioPlaylistTrack[]> | null>(null)
  const tracksRef = useRef<RadioPlaylistTrack[] | null>(null)
  const queueRef = useRef<RadioPlaylistTrack[]>([])
  const isDisposedRef = useRef(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isUnavailable, setIsUnavailable] = useState(false)
  const [currentTrackTitle, setCurrentTrackTitle] = useState<string | null>(null)
  const [statusDetail, setStatusDetail] = useState<string | null>(null)

  useEffect(() => {
    isDisposedRef.current = false

    return () => {
      isDisposedRef.current = true
      abortRef.current?.abort()
      audioCleanupRef.current?.()
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])

  const stopCurrentAudio = () => {
    audioCleanupRef.current?.()
    audioCleanupRef.current = null
    audioRef.current?.pause()
    audioRef.current = null
  }

  const loadPlaylist = async (): Promise<RadioPlaylistTrack[]> => {
    if (tracksRef.current) return tracksRef.current

    if (!playlistPromiseRef.current) {
      const controller = new AbortController()
      abortRef.current = controller
      playlistPromiseRef.current = fetchRadioPlaylist({
        playlistUrl,
        fetchPlaylist,
        signal: controller.signal,
      }).finally(() => {
        if (abortRef.current === controller) {
          abortRef.current = null
        }
      })
    }

    try {
      const tracks = await playlistPromiseRef.current
      tracksRef.current = tracks
      return tracks
    } catch (error) {
      playlistPromiseRef.current = null
      throw error
    }
  }

  const takeNextTrack = async (allowReshuffle: boolean): Promise<RadioPlaylistTrack | null> => {
    const tracks = await loadPlaylist()
    if (queueRef.current.length === 0) {
      if (!allowReshuffle) return null
      queueRef.current = buildRandomQueue(tracks, random)
    }

    return queueRef.current.shift() ?? null
  }

  const markUnavailable = () => {
    stopCurrentAudio()
    if (isDisposedRef.current) return

    setIsPlaying(false)
    setIsUnavailable(true)
    setCurrentTrackTitle(null)
    setStatusDetail(null)
  }

  const markPlaybackBlocked = () => {
    stopCurrentAudio()
    if (isDisposedRef.current) return

    setIsPlaying(false)
    setCurrentTrackTitle(null)
    setStatusDetail('Playback blocked or unavailable')
  }

  const playNextTrack = async (allowReshuffle = true): Promise<void> => {
    const track = await takeNextTrack(allowReshuffle)
    if (!track) {
      markUnavailable()
      return
    }

    if (isDisposedRef.current) return

    stopCurrentAudio()

    const audio = createAudio(resolveRadioTrackUrl(track, playlistUrl))
    const handleEnded = () => {
      void playNextTrack(true)
    }
    const handleError = () => {
      void playNextTrack(false)
    }

    audio.loop = false
    audio.preload = 'auto'
    audio.volume = RADIO_VOLUME
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)
    audioCleanupRef.current = () => {
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
    }
    audioRef.current = audio

    try {
      await audio.play()
    } catch {
      markPlaybackBlocked()
      return
    }

    if (isDisposedRef.current) {
      audio.pause()
      return
    }

    setIsPlaying(true)
    setCurrentTrackTitle(track.title)
    setStatusDetail(null)
  }

  const toggle = async () => {
    const audio = audioRef.current
    if (isUnavailable || isLoading) return

    if (audio) {
      if (!audio.paused) {
        audio.pause()
        setIsPlaying(false)
        setStatusDetail(null)
        return
      }

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

    setIsLoading(true)
    setStatusDetail('Loading radio')
    try {
      await playNextTrack(true)
    } catch {
      markUnavailable()
    } finally {
      if (!isDisposedRef.current) {
        setIsLoading(false)
      }
    }
  }

  return {
    isPlaying,
    isLoading,
    isUnavailable,
    currentTrackTitle,
    statusDetail,
    toggle,
  }
}
