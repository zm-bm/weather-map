import type { IControl } from 'maplibre-gl'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { ScalarColorSamplingMode, ScalarRuntimeOptions } from '../../../map/scalar/options'
import type { VectorRuntimeOptions } from '../../../map/vector/options'
import { OptionsControlView } from './OptionsControlView'

type OptionsControlConfig = {
  scalarOptions: ScalarRuntimeOptions
  vectorOptions: VectorRuntimeOptions
}

export class OptionsControl implements IControl {
  private readonly scalarOptions: ScalarRuntimeOptions
  private readonly vectorOptions: VectorRuntimeOptions
  private container: HTMLDivElement | null = null
  private root: Root | null = null

  constructor(config: OptionsControlConfig) {
    this.scalarOptions = config.scalarOptions
    this.vectorOptions = config.vectorOptions
  }

  onAdd(): HTMLElement {
    const wrap = document.createElement('div')
    this.container = wrap
    this.root = createRoot(wrap)

    this.root.render(createElement(OptionsControlView, {
      scalarColorSamplingMode: this.scalarOptions.colorSamplingMode,
      onScalarColorSamplingModeChange: (nextValue: ScalarColorSamplingMode) => {
        this.scalarOptions.colorSamplingMode = nextValue
      },
      reseedOnFrameChange: this.vectorOptions.reseedOnFrameChange,
      onReseedOnFrameChange: (nextValue: boolean) => {
        this.vectorOptions.reseedOnFrameChange = nextValue
      },
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
