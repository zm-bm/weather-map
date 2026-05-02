import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RadioPlaylistFetch } from '../../radio/playlist'
import type { AudioFactory, AudioLike } from '../../radio/useRadioPlayer'
import { createFetchErrorResponse, createFetchJsonResponse } from '../../test/fetch'
import RadioButton from './RadioButton'

const PLAYLIST_URL = 'http://localhost:3000/radio/playlist.json'

type MockAudioConfig = {
  playError?: Error | null
}

class MockAudio implements AudioLike {
  loop = false
  preload: HTMLAudioElement['preload'] = ''
  volume = 1
  paused = true
  load = vi.fn()

  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  private readonly playError: Error | null
  readonly src: string

  constructor(src: string, playError: Error | null = null) {
    this.src = src
    this.playError = playError
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return

    let handlers = this.listeners.get(type)
    if (!handlers) {
      handlers = new Set()
      this.listeners.set(type, handlers)
    }
    handlers.add(listener)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return
    this.listeners.get(type)?.delete(listener)
  }

  async play() {
    if (this.playError) {
      throw this.playError
    }
    this.paused = false
  }

  pause() {
    this.paused = true
  }

  emit(type: string) {
    const event = new Event(type)
    this.listeners.get(type)?.forEach((listener) => {
      if (typeof listener === 'function') {
        listener(event)
        return
      }
      listener.handleEvent(event)
    })
  }
}

function installAudioMock(config: MockAudioConfig = {}) {
  const instances: MockAudio[] = []
  const createAudio: AudioFactory = vi.fn((src) => {
    const instance = new MockAudio(src, config.playError ?? null)
    instances.push(instance)
    return instance
  })

  return {
    createAudio,
    instances,
  }
}

function installPlaylistFetch(payload: unknown) {
  return vi.fn(async () => (
    createFetchJsonResponse(payload)
  )) satisfies RadioPlaylistFetch
}

describe('RadioButton', () => {
  it('does not request the playlist or audio until the button is clicked', async () => {
    const { createAudio, instances } = installAudioMock()
    const fetchPlaylist = installPlaylistFetch({
      tracks: [
        { src: 'alpha.mp3', title: 'Alpha' },
        { src: 'bravo.mp3', title: 'Bravo' },
        { src: 'charlie.mp3', title: 'Charlie' },
      ],
    })
    const random = vi.fn()
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0)
      .mockReturnValue(0)
    const { container, unmount } = render(
      <RadioButton
        playlistUrl={PLAYLIST_URL}
        createAudio={createAudio}
        fetchPlaylist={fetchPlaylist}
        random={random}
      />
    )

    const button = container.querySelector('button')
    expect(button).toBeTruthy()
    expect(button).toHaveAttribute('aria-label', 'Play radio')
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(fetchPlaylist).not.toHaveBeenCalled()
    expect(createAudio).not.toHaveBeenCalled()
    expect(instances).toHaveLength(0)

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(fetchPlaylist).toHaveBeenCalledWith(PLAYLIST_URL, expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
    expect(createAudio).toHaveBeenCalledTimes(1)
    expect(instances[0]?.src).toBe('http://localhost:3000/radio/charlie.mp3')
    expect(instances[0]?.load).not.toHaveBeenCalled()
    expect(button).toHaveClass('is-playing')
    expect(button).toHaveAttribute('aria-label', 'Pause radio')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAttribute('title', 'Pause radio: Charlie')

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(button).not.toHaveClass('is-playing')
    expect(button).toHaveAttribute('aria-label', 'Play radio')
    expect(button).toHaveAttribute('aria-pressed', 'false')

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(fetchPlaylist).toHaveBeenCalledTimes(1)
    expect(createAudio).toHaveBeenCalledTimes(1)
    expect(button).toHaveClass('is-playing')

    unmount()
  })

  it('advances through the shuffled playlist when a track ends', async () => {
    const { createAudio, instances } = installAudioMock()
    const fetchPlaylist = installPlaylistFetch({
      tracks: [
        { src: 'alpha.mp3', title: 'Alpha' },
        { src: 'bravo.mp3', title: 'Bravo' },
        { src: 'charlie.mp3', title: 'Charlie' },
      ],
    })
    const random = vi.fn()
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0)
      .mockReturnValue(0)
    const { container, unmount } = render(
      <RadioButton
        playlistUrl={PLAYLIST_URL}
        createAudio={createAudio}
        fetchPlaylist={fetchPlaylist}
        random={random}
      />
    )

    const button = container.querySelector('button')
    expect(button).toBeTruthy()

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(instances.map((audio) => audio.src)).toEqual([
      'http://localhost:3000/radio/charlie.mp3',
    ])

    await act(async () => {
      instances[0]?.emit('ended')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(instances.map((audio) => audio.src)).toEqual([
      'http://localhost:3000/radio/charlie.mp3',
      'http://localhost:3000/radio/alpha.mp3',
    ])
    expect(fetchPlaylist).toHaveBeenCalledTimes(1)
    expect(button).toHaveAttribute('title', 'Pause radio: Alpha')

    unmount()
  })

  it('shows blocked playback feedback when play rejects', async () => {
    const { createAudio } = installAudioMock({
      playError: new Error('Playback blocked'),
    })
    const fetchPlaylist = installPlaylistFetch({
      tracks: [{ src: 'alpha.mp3', title: 'Alpha' }],
    })
    const { container, unmount } = render(
      <RadioButton
        playlistUrl={PLAYLIST_URL}
        createAudio={createAudio}
        fetchPlaylist={fetchPlaylist}
      />
    )

    const button = container.querySelector('button')
    expect(button).toBeTruthy()

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(button).not.toBeDisabled()
    expect(button).not.toHaveClass('is-playing')
    expect(button).toHaveAttribute('aria-label', 'Play radio')
    expect(button).toHaveAttribute('title', 'Playback blocked or unavailable')

    unmount()
  })

  it('disables the button when the playlist cannot be loaded', async () => {
    const { createAudio } = installAudioMock()
    const fetchPlaylist = vi.fn(async () => (
      createFetchErrorResponse(404, 'Not Found')
    )) satisfies RadioPlaylistFetch
    const { container, unmount } = render(
      <RadioButton
        playlistUrl={PLAYLIST_URL}
        createAudio={createAudio}
        fetchPlaylist={fetchPlaylist}
      />
    )

    const button = container.querySelector('button')
    expect(button).toBeTruthy()

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(fetchPlaylist).toHaveBeenCalledTimes(1)
    expect(createAudio).not.toHaveBeenCalled()
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Radio playlist unavailable')

    unmount()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
})
