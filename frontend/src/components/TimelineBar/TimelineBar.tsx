import TimelineScrubber from '../TimelineScrubber'
import TransportControls from '../TransportControls'

function TimelineBar() {
  return (
    <section className="timeline-bar wm-docked-band-shell" aria-label="Forecast timeline controls">
      <div className="timeline-bar__titlebar wm-titlebar wm-module-titlebar" aria-hidden="true" />

      <div className="timeline-bar__grid">
        <TransportControls />
        <TimelineScrubber />
      </div>
    </section>
  )
}

export default TimelineBar
