import { describe, expect, it } from 'vitest'

import { assembleShader } from './shaderAssembly'

describe('shader source assembly', () => {
  it('replaces named include pragmas', () => {
    const source = `#version 300 es
precision highp float;

#pragma weather-map include shared-math

void main() {
  outColor = sharedValue();
}
`

    const assembled = assembleShader(source, {
      'shared-math': 'float sharedValue() { return 1.0; }\n',
    })

    expect(assembled).toContain('float sharedValue()')
    expect(assembled).toContain('outColor = sharedValue()')
  })

  it('throws on missing include names', () => {
    expect(() => assembleShader('#pragma weather-map include missing', {}))
      .toThrow('Missing shader include: missing')
  })

  it('leaves no weather-map include pragmas in assembled output', () => {
    const assembled = assembleShader(
      '#pragma weather-map include shared\nvoid main() {}',
      { shared: 'float x = 1.0;' }
    )

    expect(assembled).not.toContain('#pragma weather-map include')
  })
})
