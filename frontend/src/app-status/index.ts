import AppStatusProvider from './AppStatusProvider'
import {
  useAppStatus,
  useAppStatusActions,
  useAppStatusEntries,
} from './AppStatusContext'
import { selectActiveStatus } from './state'

export { AppStatusProvider, useAppStatus, useAppStatusActions, useAppStatusEntries }

export function useActiveAppStatus() {
  return selectActiveStatus(useAppStatusEntries())
}

export type {
  AppStatusActions,
  AppStatusContextValue,
} from './AppStatusContext'
export type {
  AppStatusEntry,
  AppStatusLevel,
  AppStatusMode,
  AppStatusPayload,
} from './state'
