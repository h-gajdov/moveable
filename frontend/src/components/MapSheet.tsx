import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { prefersReducedMotion, useSettings } from '../settings/SettingsContext';

/** Height of the sheet that stays visible when it is pulled down (px). */
const PEEK = 112;
/** The sheet's rounded top overlaps the map by this much (matches -mt-6). */
const OVERLAP = 24;
/** Smallest map height when the sheet is up (matches the old min-h-[18rem]). */
const MIN_MAP = 288;
/** Finger travel before a touch counts as dragging the sheet rather than a tap. */
const SLOP = 8;

/**
 * Map with a bottom sheet over it (Apple Maps style). The sheet can be pulled
 * down until only its top edge shows, so the map fills the screen, and pulled
 * up again. Touch: drag the sheet down while it is scrolled to the top, or up
 * from its collapsed edge. Mouse and keyboard: drag or activate the grab
 * handle, which is a real button with aria-expanded. Focus moving into a
 * collapsed sheet (Tab, or a new result being focused) opens it again.
 */
export function MapSheet({ map, mapLabel, onMapFocus, open, onOpenChange, className = '', children }: {
  map: ReactNode;
  mapLabel: string;
  onMapFocus?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Layout of the sheet's content (gap etc.). */
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const reduced = prefersReducedMotion(settings.ui);
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const [dims, setDims] = useState<{ open: number; collapsed: number } | null>(null);
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ startY: number; startH: number; h: number; active: boolean } | null>(null);
  const moved = useRef(false);
  // Latest values for the native touch listeners, which are bound once.
  const live = useRef({ open, dims, onOpenChange });
  live.current = { open, dims, onOpenChange };

  // Map heights for both states, from the space the page actually has.
  useLayoutEffect(() => {
    const main = rootRef.current?.closest('main');
    const frame = rootRef.current?.closest('.app-frame');
    if (!main || !frame) return;
    const measure = () => {
      const up = Math.max(MIN_MAP, Math.round(frame.clientHeight * 0.46));
      setDims({ open: up, collapsed: Math.max(up, main.clientHeight - PEEK + OVERLAP) });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(main);
    return () => ro.disconnect();
  }, []);

  // A collapsed sheet starts at its top, so its visible edge is the beginning.
  useEffect(() => {
    if (!open) rootRef.current?.closest('main')?.scrollTo?.({ top: 0 });
  }, [open]);

  function begin(y: number) {
    const h = mapRef.current?.getBoundingClientRect().height ?? 0;
    drag.current = { startY: y, startH: h, h, active: false };
  }

  /** Returns true while this gesture moves the sheet (so the caller can stop scrolling). */
  function move(y: number) {
    const d = drag.current;
    const { open: isOpen, dims: size } = live.current;
    if (!d || !size) return false;
    const dy = y - d.startY;
    if (!d.active) {
      if (Math.abs(dy) < SLOP) return false;
      const atTop = (rootRef.current?.closest('main')?.scrollTop ?? 0) <= 0;
      if (!((isOpen && dy > 0 && atTop) || (!isOpen && dy < 0))) {
        drag.current = null; // an ordinary scroll
        return false;
      }
      d.active = true;
      moved.current = true;
    }
    d.h = Math.min(size.collapsed, Math.max(size.open, d.startH + dy));
    setDragH(d.h);
    return true;
  }

  function end() {
    const d = drag.current;
    drag.current = null;
    if (!d?.active) return;
    const { open: isOpen, onOpenChange: change } = live.current;
    if (isOpen && d.h - d.startH > 60) change(false);
    else if (!isOpen && d.startH - d.h > 40) change(true);
    setDragH(null);
  }

  // Touch anywhere on the sheet (not on the map, which pans itself).
  useEffect(() => {
    const main = rootRef.current?.closest('main');
    if (!main) return;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || mapRef.current?.contains(e.target as Node)) return;
      begin(e.touches[0].clientY);
    };
    const onMove = (e: TouchEvent) => {
      if (drag.current && move(e.touches[0].clientY) && e.cancelable) e.preventDefault();
    };
    main.addEventListener('touchstart', onStart, { passive: true });
    main.addEventListener('touchmove', onMove, { passive: false });
    main.addEventListener('touchend', end);
    main.addEventListener('touchcancel', end);
    return () => {
      main.removeEventListener('touchstart', onStart);
      main.removeEventListener('touchmove', onMove);
      main.removeEventListener('touchend', end);
      main.removeEventListener('touchcancel', end);
    };
    // handlers read the latest state through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSheetFocus(e: FocusEvent) {
    if (!open && e.target !== handleRef.current) onOpenChange(true);
  }

  const height = dragH ?? (dims ? (open ? dims.open : dims.collapsed) : undefined);

  return (
    <div ref={rootRef} className="map-sheet flex flex-col" data-collapsed={open ? undefined : ''}>
      <div
        onFocus={onSheetFocus}
        className="relative z-10 -mt-6 rounded-t-[28px] bg-canvas px-4 pb-8 shadow-[0_-6px_20px_rgb(0_0_0/0.08)]"
      >
        <button
          ref={handleRef}
          type="button"
          aria-expanded={open}
          aria-label={open ? t('common.sheetHide') : t('common.sheetShow')}
          onPointerDown={(e) => {
            if (e.pointerType === 'touch') return; // touch is handled for the whole sheet
            moved.current = false;
            e.currentTarget.setPointerCapture(e.pointerId);
            begin(e.clientY);
          }}
          onPointerMove={(e) => { if (e.pointerType !== 'touch') move(e.clientY); }}
          onPointerUp={(e) => { if (e.pointerType !== 'touch') end(); }}
          onClick={() => {
            if (moved.current) {
              moved.current = false;
              return;
            }
            onOpenChange(!open);
          }}
          className="flex h-11 w-full cursor-grab touch-none items-center justify-center rounded-t-[28px] active:cursor-grabbing"
        >
          <span aria-hidden="true" className="h-[5px] w-9 rounded-full bg-control" />
        </button>
        <div className={className}>{children}</div>
      </div>
      <section
        ref={mapRef}
        aria-label={mapLabel}
        onFocus={onMapFocus}
        style={{ height }}
        className={`map-under-sheet sticky top-0 z-0 order-first h-[calc(var(--app-h)*0.46)] min-h-[18rem] overflow-hidden bg-fill ${
          dragH == null && !reduced ? 'transition-[height] duration-300 ease-apple' : ''}`}
      >
        {map}
      </section>
    </div>
  );
}
