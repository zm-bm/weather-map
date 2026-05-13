import { ZodError } from 'zod'

import { cycleManifestSchema, type CycleManifest } from './schema'

export function parseCycleManifest(raw: unknown): CycleManifest {
  const result = cycleManifestSchema.safeParse(raw)
  if (result.success) return result.data
  throw formatZodError(result.error)
}

function formatZodError(error: ZodError): Error {
  const issue = error.issues[0]
  if (!issue) return new Error('Invalid cycle manifest payload')

  const fieldPath = formatIssuePath(issue.path)
  if (fieldPath === '') {
    return new Error(`Invalid cycle manifest payload: ${issue.message}`)
  }
  return new Error(`Invalid manifest field ${fieldPath}: ${issue.message}`)
}

function formatIssuePath(path: PropertyKey[]): string {
  let formatted = ''
  for (const part of path) {
    if (typeof part === 'number') {
      formatted = `${formatted}[${part}]`
      continue
    }
    const key = String(part)
    formatted = formatted.length === 0 ? key : `${formatted}.${key}`
  }
  return formatted
}
