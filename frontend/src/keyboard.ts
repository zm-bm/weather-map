export const ALLOW_SPACE_SHORTCUT_ATTR = 'data-wm-allow-space-shortcut'

const ALLOW_SPACE_SHORTCUT_DATASET_KEY = 'wmAllowSpaceShortcut'

export function isSpaceKey(event: Pick<KeyboardEvent, 'code' | 'key'>): boolean {
  return event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar'
}

export function markSpaceShortcutAllowed(element: HTMLElement): void {
  element.dataset[ALLOW_SPACE_SHORTCUT_DATASET_KEY] = 'true'
}

export function clearSpaceShortcutAllowed(element: HTMLElement): void {
  delete element.dataset[ALLOW_SPACE_SHORTCUT_DATASET_KEY]
}

export function allowsSpaceShortcut(element: HTMLElement): boolean {
  return element.dataset[ALLOW_SPACE_SHORTCUT_DATASET_KEY] === 'true'
}
