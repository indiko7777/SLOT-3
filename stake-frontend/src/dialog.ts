/** Keep keyboard input inside a modal and return focus after it closes. */
export function attachDialog(overlay: HTMLElement, label: string, close: () => void): () => void {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", label);
  const buttons = () => Array.from(overlay.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key !== "Tab") return;
    const controls = buttons();
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  };
  overlay.addEventListener("keydown", onKey);
  buttons()[0]?.focus();
  return () => { overlay.removeEventListener("keydown", onKey); previous?.focus(); };
}
