export function structuredClone<T>(value: T): T {
	const sc = globalThis.structuredClone
	if (typeof sc === 'function') return sc(value) as T

	// Fallback: sufficient for JSON-ish objects
	return JSON.parse(JSON.stringify(value)) as T
}
