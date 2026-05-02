import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { fontToGlyphs, readFont } from '@mapka/font-sdf'
import { combine } from '@mapka/font-sdf-composite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(projectRoot, '..')
const manifestPath = path.join(projectRoot, 'src', 'assets', 'glyph-fontstacks.json')
const outputRoot = path.join(repoRoot, 'artifacts', 'glyphs')

/**
 * @typedef {{ start: number, end: number, step: number }} RangeConfig
 * @typedef {{ name: string, fonts: string[] }} FontStackConfig
 * @typedef {{ ranges: RangeConfig, stacks: FontStackConfig[] }} GlyphBuildConfig
 */

/**
 * @param {number} value
 * @param {string} label
 */
function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
}

/**
 * @param {unknown} value
 * @returns {GlyphBuildConfig}
 */
function parseConfig(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('glyph config must be an object')
  }

  const config = /** @type {{ ranges?: RangeConfig, stacks?: FontStackConfig[] }} */ (value)
  if (!config.ranges || typeof config.ranges !== 'object') {
    throw new Error('glyph config must define ranges')
  }

  assertNonNegativeInteger(config.ranges.start, 'ranges.start')
  assertNonNegativeInteger(config.ranges.end, 'ranges.end')
  assertNonNegativeInteger(config.ranges.step, 'ranges.step')
  if (config.ranges.step <= 0) {
    throw new Error('ranges.step must be greater than zero')
  }
  if (config.ranges.end < config.ranges.start) {
    throw new Error('ranges.end must be greater than or equal to ranges.start')
  }

  if (!Array.isArray(config.stacks) || config.stacks.length === 0) {
    throw new Error('glyph config must define at least one font stack')
  }

  for (const stack of config.stacks) {
    if (!stack || typeof stack !== 'object') {
      throw new Error('font stack entries must be objects')
    }
    if (typeof stack.name !== 'string' || stack.name.trim().length === 0) {
      throw new Error('font stack name must be a non-empty string')
    }
    if (!Array.isArray(stack.fonts) || stack.fonts.length === 0) {
      throw new Error(`font stack "${stack.name}" must define at least one font file`)
    }
    for (const fontPath of stack.fonts) {
      if (typeof fontPath !== 'string' || fontPath.trim().length === 0) {
        throw new Error(`font stack "${stack.name}" contains an invalid font path`)
      }
    }
  }

  return /** @type {GlyphBuildConfig} */ (config)
}

async function main() {
  const manifest = parseConfig(JSON.parse(await readFile(manifestPath, 'utf8')))

  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(outputRoot, { recursive: true })
  await writeFile(path.join(outputRoot, '.gitignore'), '*\n!.gitignore\n')

  for (const stack of manifest.stacks) {
    const stackDir = path.join(outputRoot, stack.name)
    await mkdir(stackDir, { recursive: true })

    const fonts = await Promise.all(
      stack.fonts.map((fontPath) => readFont(path.join(projectRoot, fontPath)))
    )

    for (
      let start = manifest.ranges.start;
      start <= manifest.ranges.end;
      start += manifest.ranges.step
    ) {
      const end = Math.min(start + manifest.ranges.step - 1, manifest.ranges.end)
      const glyphBuffers = fonts.map((font) => fontToGlyphs(font, start, end))
      const output =
        glyphBuffers.length === 1
          ? glyphBuffers[0]
          : combine(glyphBuffers, stack.name)

      await writeFile(path.join(stackDir, `${start}-${end}.pbf`), output)
    }

    console.log(`Built glyph stack: ${stack.name}`)
  }
}

main().catch((error) => {
  console.error('[build:glyphs] failed', error)
  process.exitCode = 1
})
