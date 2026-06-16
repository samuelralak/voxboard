"use client";

import { useEffect, type RefObject } from "react";

/**
 * Focus the element marked `data-autofocus` inside a native <dialog> every time it opens. React's
 * `autoFocus` only fires on first mount, but these dialogs are mounted for the whole session and
 * reopened via showModal(), so without this the second+ open drops focus on the panel wrapper instead
 * of the intended field. Watches the dialog's `open` attribute so it is library-agnostic.
 */
export function useDialogOpenFocus(dialogRef: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const observer = new MutationObserver(() => {
      if (!dialog.open) return;
      requestAnimationFrame(() => {
        const target = dialog.querySelector("[data-autofocus]");
        if (target instanceof HTMLElement) target.focus();
      });
    });
    observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, [dialogRef]);
}
