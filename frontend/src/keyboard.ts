const SPACE_SHORTCUT_TARGET_SELECTOR =
  'a[href], button, input, select, textarea, [contenteditable="true"], [role="textbox"]'
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])
const pointerShortcutTargets = new WeakSet<HTMLElement>()

export function isSpaceKey(event: Pick<KeyboardEvent, 'code' | 'key'>): boolean {
  return event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar'
}

function spaceShortcutTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null
  return target.closest(SPACE_SHORTCUT_TARGET_SELECTOR)
}

function isTextEntryTarget(element: HTMLElement): boolean {
  if (element instanceof HTMLTextAreaElement) return true
  if (element.isContentEditable) return true
  if (element.getAttribute('role') === 'textbox') return true
  if (!(element instanceof HTMLInputElement)) return false

  const inputType = element.type.toLowerCase()
  return !NON_TEXT_INPUT_TYPES.has(inputType)
}

function canUsePointerShortcut(element: HTMLElement): boolean {
  return (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLInputElement && !isTextEntryTarget(element))
  )
}

export function markPointerShortcut(target: EventTarget | null): void {
  const element = spaceShortcutTarget(target)
  if (!element || !canUsePointerShortcut(element)) return
  pointerShortcutTargets.add(element)
}

export function clearPointerShortcut(target: EventTarget | null): void {
  const element = spaceShortcutTarget(target)
  if (!element) return
  pointerShortcutTargets.delete(element)
}

export function shouldIgnoreSpaceShortcut(target: EventTarget | null): boolean {
  const element = spaceShortcutTarget(target)
  if (!element) return false
  return !pointerShortcutTargets.has(element)
}
