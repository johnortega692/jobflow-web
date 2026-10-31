const INSTALLED = "__keepPopupOpenWhileSelecting";

function isBackdrop(element: Element): boolean {
  for (const name of element.classList) {
    if (name.includes("backdrop")) return true;
  }
  return false;
}

function popupOf(target: EventTarget | null): Element | null {
  const element = target instanceof Element ? target : target instanceof Text ? target.parentElement : null;
  return element?.closest("[role='dialog'], [role='alertdialog']") ?? null;
}

/** A highlight that starts inside a popup and ends on the dimmed layer is delivered
 * as a click on that layer, which was closing the popup. A real click still closes it. */
export function keepPopupOpenWhileSelectingText(): void {
  const win = window as Window & { [INSTALLED]?: boolean };
  if (win[INSTALLED]) return;
  win[INSTALLED] = true;

  let pressed: EventTarget | null = null;
  document.addEventListener(
    "pointerdown",
    (event) => {
      pressed = event.target;
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      const down = pressed;
      pressed = null;
      if (event.detail === 0) return;
      if (!(event.target instanceof Element) || down == null || down === event.target) return;

      const backdropClick = isBackdrop(event.target);
      const popup = popupOf(down);
      const dragLeftPopup = Boolean(
        popup && down instanceof Node && event.target.contains(down) && !popup.contains(event.target),
      );
      if (!backdropClick && !dragLeftPopup) return;

      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
}
