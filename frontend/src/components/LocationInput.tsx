import { useQuery } from '@tanstack/react-query';
import { Crosshair, LocateFixed, MapPin, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import type { ChosenLocation, Place } from '../api/types';
import { currentLanguage } from '../i18n';
import { coordLabel, pickName } from '../lib/format';
import { parseCoordinates } from '../lib/geo';
import { useAnnounce } from './Announcer';
import { Button } from './ui';

interface Option {
  id: string;
  label: string;
  detail?: string;
  location: ChosenLocation;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

function categoryLabel(p: Place): string | undefined {
  if (p.kind === 'STREET') return undefined;
  return p.category?.split('=')[1]?.replace(/_/g, ' ');
}

/**
 * Accessible location field (ARIA 1.2 combobox with list autocomplete).
 * Alternatives to the map: text search, typed coordinates, or the device location.
 */
export function LocationInput({ label, value, onChange, onPickOnMap, pickActive, allowGps = true }: {
  label: string;
  value: ChosenLocation | null;
  onChange: (l: ChosenLocation | null) => void;
  onPickOnMap?: () => void;
  pickActive?: boolean;
  allowGps?: boolean;
}) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const announce = useAnnounce();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value?.label ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [gpsState, setGpsState] = useState<'idle' | 'locating' | 'error'>('idle');
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);

  useEffect(() => {
    setText(value?.label ?? '');
  }, [value]);

  const q = useDebounced(text.trim(), 250);
  const searching = open && q.length >= 2 && q !== value?.label;
  const { data, isFetching, error } = useQuery({
    queryKey: ['places', q],
    queryFn: ({ signal }) => api.places(q, signal),
    enabled: searching,
    staleTime: 5 * 60_000,
  });

  const coords = parseCoordinates(text);
  const options: Option[] = [];
  if (coords) {
    options.push({
      id: 'coords',
      label: t('plan.coordinatesOption', { lat: coords.lat, lon: coords.lon }),
      location: { ...coords, label: t('plan.pointAt', { lat: coords.lat.toFixed(5), lon: coords.lon.toFixed(5) }), source: 'coordinates' },
    });
  }
  if (searching && data) {
    for (const p of data) {
      const name = pickName(p.names, lang) ?? coordLabel(p.lat, p.lon);
      options.push({ id: p.id, label: name, detail: lang === 'en' ? categoryLabel(p) : undefined, location: { lat: p.lat, lon: p.lon, label: name, source: 'search' } });
    }
  }
  const expanded = open && (options.length > 0 || (searching && !isFetching && data !== undefined));

  useEffect(() => {
    if (searching && data && !isFetching) {
      announce(data.length === 0 && !coords ? t('plan.noResults') : t('plan.results', { count: options.length }));
    }
    // announce only when results arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isFetching]);

  function choose(o: Option) {
    onChange(o.location);
    setText(o.location.label);
    setOpen(false);
    setActive(-1);
    announce(t('plan.selected', { field: label, label: o.location.label }));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && expanded && active >= 0 && options[active]) {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === 'Escape') {
      if (expanded) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    }
  }

  function useGps() {
    if (!('geolocation' in navigator)) {
      setGpsState('error');
      setGpsMessage(t('plan.gpsUnavailable'));
      return;
    }
    setGpsState('locating');
    setGpsMessage(null);
    announce(t('plan.locating'));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const acc = Math.round(pos.coords.accuracy);
        const loc: ChosenLocation = {
          lat: pos.coords.latitude, lon: pos.coords.longitude, accuracyM: acc,
          label: t('plan.myLocation', { accuracy: acc }), source: 'gps',
        };
        onChange(loc);
        setGpsState('idle');
        const msg = acc > 50 ? t('plan.poorGps', { accuracy: acc }) : null;
        setGpsMessage(msg);
        announce(t('plan.selected', { field: label, label: loc.label }) + (msg ? ` ${msg}` : ''));
      },
      (err) => {
        setGpsState('error');
        const msg = err.code === err.PERMISSION_DENIED ? t('plan.gpsDenied') : t('plan.gpsUnavailable');
        setGpsMessage(msg);
        announce(msg, 'assertive');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
    );
  }

  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const errorText = error instanceof ApiError ? t(`errors.${error.code}`, { defaultValue: t('errors.default') }) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-input`} className="px-1 font-display text-[1.0625rem] font-semibold">{label}</label>
      <div className="relative">
        <MapPin aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-describedby={hintId}
          aria-activedescendant={expanded && active >= 0 ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={t('plan.searchPlaceholder')}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(-1);
            if (value) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          className="field min-h-12 w-full py-2.5 pl-11 pr-12 text-[1.0625rem]"
        />
        {text && (
          <button
            type="button"
            onClick={() => {
              setText('');
              onChange(null);
              inputRef.current?.focus();
            }}
            aria-label={t('plan.clear', { field: label })}
            className="absolute right-0.5 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full text-muted hover:text-ink"
          >
            <span className="grid size-5 place-items-center rounded-full bg-control text-card">
              <X aria-hidden="true" className="size-3.5" strokeWidth={3} />
            </span>
          </button>
        )}
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          hidden={!expanded}
          className="glass absolute z-30 mt-2 max-h-80 w-full overflow-auto rounded-[14px] p-1.5"
        >
          {options.map((o, i) => (
            <li
              key={o.id}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5 ${i === active ? 'bg-accent text-accent-ink' : 'hover:bg-fill'}`}
            >
              <span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-full ${i === active ? 'bg-white/20' : 'bg-fill'}`}>
                <MapPin className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="font-medium">{o.label}</span>
                {o.detail && <span className="block text-[0.875rem] opacity-80">{o.detail}</span>}
              </span>
            </li>
          ))}
          {expanded && options.length === 0 && (
            <li role="option" aria-selected={false} aria-disabled="true" className="px-3 py-2.5 text-muted">
              {t('plan.noResults')}
            </li>
          )}
        </ul>
      </div>
      <p id={hintId} className="px-1 text-[0.8125rem] text-muted">{t('plan.searchHint')}</p>
      {errorText && <p className="px-1 text-[0.875rem] text-issue" role="alert">{errorText}</p>}
      {(allowGps || onPickOnMap) && (
        <div className="flex flex-wrap gap-2">
          {allowGps && (
            <Button variant="tinted" onClick={useGps} disabled={gpsState === 'locating'} icon={<LocateFixed aria-hidden="true" className="size-4.5" />}>
              {gpsState === 'locating' ? t('plan.locating') : t('plan.useMyLocation')}
            </Button>
          )}
          {onPickOnMap && (
            <Button variant={pickActive ? 'primary' : 'tinted'} onClick={onPickOnMap} aria-pressed={pickActive}
              icon={<Crosshair aria-hidden="true" className="size-4.5" />}>
              {t('plan.chooseOnMap')}
            </Button>
          )}
        </div>
      )}
      {gpsMessage && <p className="px-1 text-[0.875rem] text-issue">{gpsMessage}</p>}
    </div>
  );
}
