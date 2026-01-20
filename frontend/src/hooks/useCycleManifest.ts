import { useEffect, useState } from 'react'

import { fetchLatestCycleManifest, type CycleManifest } from '../api/manifests'

export type UseCycleManifestResult = {
	manifest: CycleManifest | null
	loading: boolean
	error: Error | null
}

export function useCycleManifest(): UseCycleManifestResult {
	const [manifest, setManifest] = useState<CycleManifest | null>(null)
	const [loading, setLoading] = useState<boolean>(true)
	const [error, setError] = useState<Error | null>(null)

	useEffect(() => {
		const ac = new AbortController()

		const run = async () => {
			setLoading(true)
			setError(null)
			const m = await fetchLatestCycleManifest({ signal: ac.signal })
			setManifest(m)
		}

		run().catch((err) => {
			if (err?.name === 'AbortError') return
			setError(err instanceof Error ? err : new Error(String(err)))
			setManifest(null)
		}).finally(() => {
			if (!ac.signal.aborted) setLoading(false)
		})

		return () => ac.abort()
	}, [])

	return { manifest, loading, error }
}
