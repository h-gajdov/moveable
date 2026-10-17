import type { TFunction } from 'i18next';
import type { Names } from '../api/types';
import { LOCALE_TAGS, type Language } from '../i18n';

export function formatDistance(m: number, lang: Language): string {
  const tag = LOCALE_TAGS[lang];
  if (m >= 1000) {
    return new Intl.NumberFormat(tag, { style: 'unit', unit: 'kilometer', maximumFractionDigits: 1 }).format(m / 1000);
  }
  const rounded = m < 100 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10;
  return new Intl.NumberFormat(tag, { style: 'unit', unit: 'meter', maximumFractionDigits: 0 }).format(Math.max(rounded, m < 5 ? Math.round(m) : rounded));
}

export function formatDuration(s: number, t: TFunction): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return t('common.minutes', { count: min });
  return t('common.hours', { h: Math.floor(min / 60), m: min % 60 });
}

export function formatDate(iso: string, lang: Language): string {
  try {
    return new Intl.DateTimeFormat(LOCALE_TAGS[lang], { dateStyle: 'long' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Pick the best name for the UI language. Macedonian names in OSM are usually
 * Cyrillic; for Albanian and English we fall back to the official Latin
 * transliteration before showing Cyrillic.
 */
export function pickName(names: Names | undefined | null, lang: Language): string | undefined {
  if (!names) return undefined;
  if (lang === 'mk') return names.mk ?? names.default ?? names.latn ?? names.en ?? names.sq;
  if (lang === 'sq') return names.sq ?? names.latn ?? names.default ?? names.en;
  return names.en ?? names.latn ?? names.default ?? names.sq;
}

export function coordLabel(lat: number, lon: number) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
