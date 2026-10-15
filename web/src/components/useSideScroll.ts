import { useEffect, type RefObject } from "react";

// How far the pointer goes before a press on the row stops being a click that
// picks a sport and becomes a drag.
const DRAG_THRESHOLD = 5;
// What a wheel that counts lines (Firefox's, by default) moves by, in pixels.
const LINE_HEIGHT = 16;

// Moves a row that scrolls sideways with a mouse, as a touch screen's swipe
// does: the wheel over `bar` scrolls the row sideways, and a drag with the
// button down moves it too. Touch is left to the browser's own swipe.
export function useSideScroll(bar: RefObject<HTMLElement | null>, row: RefObject<HTMLElement | null>) {
  // The wheel, with a native listener: React's is passive, so it can't cancel
  // the page's scroll. Over the bar the row keeps the wheel even at its ends,
  // so that a mouse resting on the bar never makes the page scroll behind it.
  // Not when every sport fits (nothing to scroll), nor for a sideways gesture,
  // which the browser already scrolls the row with.
  useEffect(() => {
    const target = bar.current;
    if (!target) return;
    function onWheel(event: WheelEvent) {
      const scroller = row.current;
      if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? LINE_HEIGHT : event.deltaMode === 2 ? scroller.clientWidth : 1;
      scroller.scrollLeft += event.deltaY * unit;
    }
    target.addEventListener("wheel", onWheel, { passive: false });
    return () => target.removeEventListener("wheel", onWheel);
  }, [bar, row]);

  // The drag. The pointer is captured once it is one, so that it goes on
  // outside the row, and the click that ends it is swallowed: it would pick
  // the sport under the pointer. A new press starts afresh, in case the
  // browser sent no click (the button let go outside the row).
  useEffect(() => {
    const scroller = row.current;
    if (!scroller) return;
    let press: { id: number; x: number; left: number; dragging: boolean } | null = null;
    let swallowClick = false;

    const onDown = (event: PointerEvent) => {
      swallowClick = false;
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      press = { id: event.pointerId, x: event.clientX, left: scroller.scrollLeft, dragging: false };
    };
    const onMove = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.id) return;
      const travel = event.clientX - press.x;
      if (!press.dragging) {
        if (Math.abs(travel) < DRAG_THRESHOLD) return;
        press.dragging = true;
        scroller.setPointerCapture?.(event.pointerId);
        scroller.setAttribute("data-dragging", "");
      }
      scroller.scrollLeft = press.left - travel;
    };
    const onEnd = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.id) return;
      swallowClick = press.dragging;
      press = null;
      scroller.removeAttribute("data-dragging");
    };
    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    scroller.addEventListener("pointerdown", onDown);
    scroller.addEventListener("pointermove", onMove);
    scroller.addEventListener("pointerup", onEnd);
    scroller.addEventListener("pointercancel", onEnd);
    // Capturing: before the label's own, which would pick the sport.
    scroller.addEventListener("click", onClick, true);
    return () => {
      scroller.removeEventListener("pointerdown", onDown);
      scroller.removeEventListener("pointermove", onMove);
      scroller.removeEventListener("pointerup", onEnd);
      scroller.removeEventListener("pointercancel", onEnd);
      scroller.removeEventListener("click", onClick, true);
      scroller.removeAttribute("data-dragging");
    };
  }, [row]);
}
