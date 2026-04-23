import { act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MusicControl, TRACK_URL } from './MusicControl'
import type { AudioFactory, AudioLike } from './MusicControlView'

type MockAudioConfig = {
  playError?: Error | null
}

class MockAudio implements AudioLike {
  loop = false
  preload: HTMLAudioElement['preload'] = ''
  volume = 1
  paused = true

  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  private readonly playError: Error | null

  constructor(playError: Error | null = null) {
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

  load() {}

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
  const createAudio: AudioFactory = vi.fn(() => {
    const instance = new MockAudio(config.playError ?? null)
    instances.push(instance)
    return instance
  })

  return {
    createAudio,
    instances,
  }
}

describe('MusicControl', () => {
  it('toggles playback state through the rendered React control', async () => {
    const { createAudio, instances } = installAudioMock()
    const control = new MusicControl({ src: TRACK_URL, createAudio })
    let root: HTMLElement

    await act(async () => {
      root = control.onAdd()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const button = root!.querySelector('button')
    expect(button).toBeTruthy()
    expect(button).toHaveAttribute('aria-label', 'Play radio')
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(createAudio).toHaveBeenCalledWith(TRACK_URL)
    expect(instances).toHaveLength(1)

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(button).toHaveClass('is-playing')
    expect(button).toHaveAttribute('aria-label', 'Pause radio')
    expect(button).toHaveAttribute('aria-pressed', 'true')

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(button).not.toHaveClass('is-playing')
    expect(button).toHaveAttribute('aria-label', 'Play radio')
    expect(button).toHaveAttribute('aria-pressed', 'false')

    await act(async () => {
      control.onRemove()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  })

  it('disables the button when the audio element errors', async () => {
    const { createAudio, instances } = installAudioMock()
    const control = new MusicControl({ src: TRACK_URL, createAudio })
    let root: HTMLElement

    await act(async () => {
      root = control.onAdd()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const button = root!.querySelector('button')
    expect(button).toBeTruthy()

    await act(async () => {
      instances[0]?.emit('error')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Music track unavailable')

    await act(async () => {
      control.onRemove()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  })

  it('shows blocked playback feedback when play rejects', async () => {
    const { createAudio } = installAudioMock({
      playError: new Error('Playback blocked'),
    })
    const control = new MusicControl({ src: TRACK_URL, createAudio })
    let root: HTMLElement

    await act(async () => {
      root = control.onAdd()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const button = root!.querySelector('button')
    expect(button).toBeTruthy()

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(button).not.toBeDisabled()
    expect(button).not.toHaveClass('is-playing')
    expect(button).toHaveAttribute('aria-label', 'Play radio')
    expect(button).toHaveAttribute('title', 'Playback blocked or unavailable')

    await act(async () => {
      control.onRemove()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
})
