/**
 * Focus snapshot / restore utilities for AIMD inline editing.
 *
 * When the VNode tree is rebuilt (e.g. after a content change),
 * we capture the currently focused element's key and selection state,
 * then restore it after the new tree is mounted.
 */

export interface FocusSnapshot {
  key: string
  selectionStart?: number | null
  selectionEnd?: number | null
  selectionDirection?: HTMLInputElement["selectionDirection"]
}

/**
 * Capture the focus state of the currently active element inside `contentRoot`.
 * Returns `null` if nothing relevant is focused.
 */
export function captureFocusSnapshot(contentRoot: HTMLElement | null): FocusSnapshot | null {
  if (typeof document === "undefined" || !contentRoot) {
    return null
  }

  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement) || !contentRoot.contains(activeElement)) {
    return null
  }

  const key = activeElement.dataset.recFocusKey
  if (!key) {
    return null
  }

  const snapshot: FocusSnapshot = { key }
  if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
    snapshot.selectionStart = activeElement.selectionStart
    snapshot.selectionEnd = activeElement.selectionEnd
    snapshot.selectionDirection = activeElement.selectionDirection
  }

  return snapshot
}

/**
 * Restore focus (and optionally selection) to the element matching the snapshot key.
 */
export function restoreFocusSnapshot(contentRoot: HTMLElement | null, snapshot: FocusSnapshot | null) {
  if (!snapshot || !contentRoot) {
    return
  }

  const candidates = contentRoot.querySelectorAll<HTMLElement>("[data-rec-focus-key]")
  let target: HTMLElement | null = null
  for (let index = 0; index < candidates.length; index += 1) {
    if (candidates[index].dataset.recFocusKey === snapshot.key) {
      target = candidates[index]
      break
    }
  }

  if (!target) {
    return
  }

  target.focus()

  if (
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
    snapshot.selectionStart != null &&
    snapshot.selectionEnd != null
  ) {
    try {
      target.setSelectionRange(
        snapshot.selectionStart,
        snapshot.selectionEnd,
        snapshot.selectionDirection ?? undefined,
      )
    } catch {
      // Some input types (e.g. number, date) don't support setSelectionRange
    }
  }
}
