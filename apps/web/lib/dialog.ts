/**
 * Open a native <dialog> (wrapped by Tailwind Plus Elements) by id. Used where a click handler must
 * decide whether to open a dialog (e.g. open compose only when logged in), which the declarative
 * command="show-modal" invoker cannot express. showModal() fires the toggle the ElDialog transition
 * listens for, so the open animation still runs.
 */
export function openDialog(id: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (el instanceof HTMLDialogElement && !el.open) el.showModal();
}

/** Close a native <dialog> by id, if open. */
export function closeDialog(id: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (el instanceof HTMLDialogElement && el.open) el.close();
}
