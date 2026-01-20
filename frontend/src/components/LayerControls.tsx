function LayerControls(props: {
	layers: string[]
	forecastHours: string[]
	activeLayer: string
	activeHour: string
	onLayerChange: (layer: string) => void
	onNextHour: () => void
}) {
	const { layers, forecastHours, activeLayer, activeHour, onLayerChange, onNextHour } = props

	return (
		<div style={{ position: 'absolute', top: 12, left: 12, zIndex: 1, display: 'flex', gap: 8 }}>
			{layers.length > 1 && (
				<label>
					<span style={{ marginRight: 6 }}>Layer</span>
					<select value={activeLayer} onChange={(e) => onLayerChange(e.target.value)}>
						{layers.map((l) => (
							<option key={l} value={l}>
								{l}
							</option>
						))}
					</select>
				</label>
			)}

			{forecastHours.length > 1 && (
				<button type="button" onClick={onNextHour}>
					Next hour ({activeHour})
				</button>
			)}
		</div>
	)
}

export default LayerControls
