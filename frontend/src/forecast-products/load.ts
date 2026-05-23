import { isAbortError } from '../abort'
import type { ForecastProductRequest } from './request'
import type {
  FieldInterpolationWindowData,
  ForecastProductId,
  ForecastProductLoad,
  ForecastProductTimeSlices,
  ForecastProductWindows,
  LoadedForecastProducts,
  PreviousForecastProductWindows,
} from './types'
import { setForecastProductWindow } from './productWindows'
import { type LoadedInterpolationWindow, loadInterpolationWindow } from './window'

type LoadForecastProductsArgs = {
  request: ForecastProductRequest
  previousWindows?: PreviousForecastProductWindows
}

type LoadedProduct<K extends ForecastProductId = ForecastProductId> = {
  product: ForecastProductLoad<K>
  window: LoadedInterpolationWindow<ForecastProductTimeSlices[K]> | null
}

export async function loadForecastProducts(args: LoadForecastProductsArgs): Promise<LoadedForecastProducts> {
  const loadedProducts = await Promise.all(
    args.request.products.map((product) => loadProductWindow({
      request: args.request,
      product,
      previousWindow: previousProductWindow(args.previousWindows, product),
    }))
  )
  const products = productWindowsFromLoadedProducts(loadedProducts)

  return {
    products,
    probeField: probeFieldFromLoadedProducts(loadedProducts),
  }
}

async function loadProductWindow<K extends ForecastProductId>(args: {
  request: ForecastProductRequest
  product: ForecastProductLoad<K>
  previousWindow: LoadedInterpolationWindow<ForecastProductTimeSlices[K]> | null
}): Promise<LoadedProduct<K>> {
  try {
    const window = await loadInterpolationWindow<ForecastProductTimeSlices[K]>({
      selection: args.request,
      previousWindow: args.previousWindow,
      loadTimeSlice: args.product.load,
    })
    return {
      product: args.product,
      window,
    }
  } catch (error) {
    if (isAbortError(error) || args.product.failurePolicy === 'required') throw error
    return {
      product: args.product,
      window: null,
    }
  }
}

function previousProductWindow<K extends ForecastProductId>(
  previousWindows: PreviousForecastProductWindows | undefined,
  product: ForecastProductLoad<K>
): LoadedInterpolationWindow<ForecastProductTimeSlices[K]> | null {
  return (previousWindows?.[product.id] ?? null) as LoadedInterpolationWindow<ForecastProductTimeSlices[K]> | null
}

function productWindowsFromLoadedProducts(
  loadedProducts: readonly LoadedProduct[]
): ForecastProductWindows {
  const products: ForecastProductWindows = {}
  for (const product of loadedProducts) {
    if (product.window == null) continue
    setForecastProductWindow(products, product.product.id, product.window)
  }
  return products
}

function probeFieldFromLoadedProducts(
  loadedProducts: readonly LoadedProduct[]
): FieldInterpolationWindowData | null {
  for (const loadedProduct of loadedProducts) {
    const probeField = probeFieldFromLoadedProduct(loadedProduct)
    if (probeField != null) return probeField
  }
  return null
}

function probeFieldFromLoadedProduct<K extends ForecastProductId>(
  loadedProduct: LoadedProduct<K>
): FieldInterpolationWindowData | null {
  const { product, window } = loadedProduct
  if (window == null || product.toProbeField == null) return null
  return product.toProbeField(window)
}
