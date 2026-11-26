import { useEffect, useState } from "react";

export const SITE = "SDIQT";

/** Phones and touch screens: tap targets grow to 40 px. Same query as the CSS. */
export const TOUCH = "(max-width: 809px), (pointer: coarse)";

/**
 * Sets `document.title` while mounted. With `restore`, the previous title comes
 * back on unmount (a drawer over a page); pages leave it for the next page.
 */
export function useDocumentTitle(title: string, restore = false): void {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    if (restore)
      return () => {
        document.title = prev;
      };
  }, [title, restore]);
}

/** Whether a CSS media query matches, kept current as the viewport changes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/**
 * Where Tab should land inside a focus trap, or `null` to let the browser move
 * focus. `items` are the trap's focusable elements in tab order; focus that
 * sits outside the trap goes to the first (or, with Shift, the last) item.
 */
export function wrapTab<T>(items: readonly T[], current: T | null, shift: boolean): T | null {
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) return null;
  const at = current === null ? -1 : items.indexOf(current);
  if (at === -1) return shift ? last : first;
  if (shift && at === 0) return last;
  if (!shift && at === items.length - 1) return first;
  return null;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Visible, tabbable elements inside `root`, in DOM order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex >= 0 && el.getClientRects().length > 0,
  );
}

/** Keeps Tab and Shift+Tab cycling inside `root`. Returns true when it moved focus. */
export function trapTab(root: HTMLElement, e: KeyboardEvent): boolean {
  if (e.key !== "Tab") return false;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const items = focusables(root);
  const next = wrapTab(items, active && root.contains(active) ? active : null, e.shiftKey);
  if (items.length === 0) {
    e.preventDefault();
    return true;
  }
  if (!next) return false;
  e.preventDefault();
  next.focus();
  return true;
}
