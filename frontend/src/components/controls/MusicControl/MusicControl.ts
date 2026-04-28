import type { IControl } from 'maplibre-gl'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { RadioPlaylistFetch } from './playlist'
import { MusicControlView } from './MusicControlView'
import type { AudioFactory } from './useRadioPlayer'

type MusicControlConfig = {
  playlistUrl: string
  createAudio?: AudioFactory
  fetchPlaylist?: RadioPlaylistFetch
  random?: () => number
}

export class MusicControl implements IControl {
  private readonly playlistUrl: string
  private readonly createAudio?: AudioFactory
  private readonly fetchPlaylist?: RadioPlaylistFetch
  private readonly random?: () => number
  private container: HTMLDivElement | null = null
  private root: Root | null = null

  constructor(config: MusicControlConfig) {
    this.playlistUrl = config.playlistUrl
    this.createAudio = config.createAudio
    this.fetchPlaylist = config.fetchPlaylist
    this.random = config.random
  }

  onAdd(): HTMLElement {
    const wrap = document.createElement('div')
    this.container = wrap
    this.root = createRoot(wrap)
    this.root.render(createElement(MusicControlView, {
      key: this.playlistUrl,
      playlistUrl: this.playlistUrl,
      createAudio: this.createAudio,
      fetchPlaylist: this.fetchPlaylist,
      random: this.random,
    }))

    return wrap
  }

  onRemove(): void {
    const root = this.root
    this.container?.remove()
    this.root = null
    this.container = null
    if (root) {
      queueMicrotask(() => {
        root.unmount()
      })
    }
  }

  getDefaultPosition(): 'top-right' {
    return 'top-right'
  }
}
