export type ShaderIncludes = Record<string, string>

const INCLUDE_PATTERN = /^[ \t]*#pragma weather-map include ([A-Za-z0-9_-]+)[ \t]*$/gm

export function assembleShader(
  source: string,
  includes: ShaderIncludes = {}
): string {
  return source.replace(INCLUDE_PATTERN, (_line, includeName: string) => {
    const includeSource = includes[includeName]
    if (includeSource == null) {
      throw new Error(`Missing shader include: ${includeName}`)
    }
    return includeSource.trimEnd()
  })
}
