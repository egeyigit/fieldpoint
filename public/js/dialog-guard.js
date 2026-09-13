const DRAFT_PREFIX = 'fieldpoint:draft:';
const CONFIRM_MESSAGE = 'Discard your unsaved changes?';

/**
 * Guards a <dialog>/<form> pair against silent data loss.
 *
 * - Escape or a backdrop click on a pristine form closes immediately; on a
 *   dirty form the user must confirm first.
 * - While the dialog is open the form values are mirrored into sessionStorage,
 *   so an accidental reload can restore what was typed.
 * - A successful save (or any explicit close through `close()`) clears the
 *   draft so the next open starts clean.
 *
 * `serialize(form)` returns the plain object stored as the draft; `restore`
 * receives that object to repopulate the form when a draft is recovered.
 */
export function guardDialog(dialog, form, { key, serialize, restore }) {
  const storageKey = `${DRAFT_PREFIX}${key}`;
  let baseline = '';

  const snapshot = () => JSON.stringify(serialize(form));

  function markPristine() {
    baseline = snapshot();
  }

  function isDirty() {
    return snapshot() !== baseline;
  }

  function saveDraft() {
    if (!dialog.open) return;
    try {
      sessionStorage.setItem(storageKey, snapshot());
    } catch {
      // A full or unavailable sessionStorage must not break editing.
    }
  }

  function clearDraft() {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Nothing to recover if storage is unavailable.
    }
  }

  /** Closes the dialog and clears the draft, skipping the dirty check. */
  function close() {
    clearDraft();
    markPristine();
    dialog.close();
  }

  /** Closes only after confirmation when the form is dirty. */
  function requestClose() {
    if (isDirty() && !window.confirm(CONFIRM_MESSAGE)) return false;
    close();
    return true;
  }

  /** Returns the stored draft object, or null when there is nothing to recover. */
  function readDraft() {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  form.addEventListener('input', saveDraft);
  form.addEventListener('change', saveDraft);

  // A native dialog fires `cancel` on Escape and on a backdrop dismissal.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    requestClose();
  });

  // Clicking the backdrop targets the dialog element itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) requestClose();
  });

  return { markPristine, saveDraft, close, requestClose, readDraft };
}
