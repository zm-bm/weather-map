import type { IControl } from 'maplibre-gl'

export const CLASSIC_MUSIC_TRACK_URL = '/song.mp3'

export class MusicControl implements IControl {
	private readonly src: string
	private container: HTMLDivElement | null = null
	private button: HTMLButtonElement | null = null
	private audio: HTMLAudioElement | null = null
	private onClickBound = () => {
		void this.togglePlayback()
	}
	private onAudioErrorBound = () => {
		if (!this.button) return
		this.button.disabled = true
		this.button.title = 'Music track unavailable'
	}

	constructor(src: string) {
		this.src = src
	}

	onAdd(): HTMLElement {
		const wrap = document.createElement('div')
		wrap.className = 'maplibregl-ctrl maplibregl-ctrl-group'

		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'maplibregl-ctrl-music'
		button.title = 'Play radio'
		button.setAttribute('aria-label', 'Play radio')
		button.setAttribute('aria-pressed', 'false')

		const icon = document.createElement('span')
		icon.className = 'maplibregl-ctrl-icon maplibregl-ctrl-icon--music'
		button.appendChild(icon)

		const audio = new Audio(this.src)
		audio.loop = true
		audio.preload = 'metadata'
		audio.volume = 0.45
		audio.addEventListener('error', this.onAudioErrorBound)
		audio.load()

		button.addEventListener('click', this.onClickBound)

		wrap.appendChild(button)
		this.container = wrap
		this.button = button
		this.audio = audio
		return wrap
	}

	onRemove(): void {
		this.audio?.pause()
		this.audio?.removeEventListener('error', this.onAudioErrorBound)
		this.button?.removeEventListener('click', this.onClickBound)
		this.container?.remove()
		this.audio = null
		this.button = null
		this.container = null
	}

	getDefaultPosition(): 'top-right' {
		return 'top-right'
	}

	private async togglePlayback() {
		if (!this.audio || !this.button || this.button.disabled) return
		if (this.audio.paused) {
			try {
				await this.audio.play()
				this.button.classList.add('is-playing')
				this.button.title = 'Pause radio'
				this.button.setAttribute('aria-label', 'Pause radio')
				this.button.setAttribute('aria-pressed', 'true')
			} catch {
				this.button.title = 'Playback blocked or unavailable'
			}
			return
		}

		this.audio.pause()
		this.button.classList.remove('is-playing')
		this.button.title = 'Play radio'
		this.button.setAttribute('aria-label', 'Play radio')
		this.button.setAttribute('aria-pressed', 'false')
	}
}
