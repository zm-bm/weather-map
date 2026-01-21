function LayerControls(props: {
	layers: string[]
	forecastHours: string[]
	activeLayer: string
	activeHour: string
	onLayerChange: (layer: string) => void
	onHourChange: (hour: string) => void
	onPrevHour: () => void
	onNextHour: () => void
	isPlaying: boolean
	onTogglePlay: () => void
	playIntervalSeconds?: number
}) {
	const {
		layers,
		forecastHours,
		activeLayer,
		activeHour,
		onLayerChange,
		onHourChange,
		onPrevHour,
		onNextHour,
		isPlaying,
		onTogglePlay,
		playIntervalSeconds,
	} = props

	const activeHourIdx = Math.max(0, forecastHours.indexOf(activeHour))
	const maxHourIdx = Math.max(0, forecastHours.length - 1)
	const hourControlsDisabled = forecastHours.length <= 1

	return (
		<div style={{ position: 'absolute', top: 12, left: 12, zIndex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
			{layers.length > 1 && (
				<fieldset style={{ border: 0, padding: 0, margin: 0 }}>
					<legend style={{ fontWeight: 600, marginBottom: 4 }}>Layer</legend>
					<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
						{layers.map((l) => (
							<label key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
								<input type="radio" name="layer" checked={activeLayer === l} onChange={() => onLayerChange(l)} />
								<span>{l}</span>
							</label>
						))}
					</div>
				</fieldset>
			)}

			{forecastHours.length > 0 && (
				<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
					<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
						<button type="button" onClick={onPrevHour} disabled={hourControlsDisabled} aria-label="Previous hour">
							{/* TODO: replace with icon */} Prev
						</button>

						<button type="button" onClick={onTogglePlay} disabled={hourControlsDisabled} aria-label={isPlaying ? 'Pause' : 'Play'}>
							{/* TODO: replace with icon */} {isPlaying ? 'Pause' : 'Play'}
							{typeof playIntervalSeconds === 'number' ? ` (${playIntervalSeconds}s)` : null}
						</button>

						<button type="button" onClick={onNextHour} disabled={hourControlsDisabled} aria-label="Next hour">
							{/* TODO: replace with icon */} Next
						</button>
					</div>

					{forecastHours.length > 1 && (
						<label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
							<span style={{ fontWeight: 600 }}>Hour: {activeHour}</span>
							<input
								type="range"
								min={0}
								max={maxHourIdx}
								step={1}
								value={activeHourIdx}
								onChange={(e) => {
									const idx = Number(e.target.value)
									const next = forecastHours[idx]
									if (next) onHourChange(next)
								}}
							/>
						</label>
					)}
				</div>
			)}
		</div>
	)
}

export default LayerControls
