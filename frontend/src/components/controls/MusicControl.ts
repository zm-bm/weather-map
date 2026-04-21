import type { IControl } from 'maplibre-gl'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { MusicControlView, type AudioFactory } from './MusicControlView'

export const TRACK_URL = '/radio/song.mp3'

type MusicControlConfig = {
  src: string
  createAudio?: AudioFactory
}

export class MusicControl implements IControl {
  private readonly src: string
  private readonly createAudio?: AudioFactory
  private container: HTMLDivElement | null = null
  private root: Root | null = null

  constructor(config: MusicControlConfig) {
    this.src = config.src
    this.createAudio = config.createAudio
  }

  onAdd(): HTMLElement {
    const wrap = document.createElement('div')
    this.container = wrap
    this.root = createRoot(wrap)
    this.root.render(createElement(MusicControlView, {
      src: this.src,
      createAudio: this.createAudio,
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
