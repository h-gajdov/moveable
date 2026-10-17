import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import mk from './locales/mk.json';
import sq from './locales/sq.json';

export const LANGUAGES = ['mk', 'sq', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** BCP 47 tags used for Intl formatting and speech synthesis. */
export const LOCALE_TAGS: Record<Language, string> = { mk: 'mk-MK', sq: 'sq-MK', en: 'en-GB' };

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, mk: { translation: mk }, sq: { translation: sq } },
    supportedLngs: [...LANGUAGES],
    fallbackLng: 'mk',
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'accessible-skopje:lang',
      caches: ['localStorage'],
    },
    returnNull: false,
  });

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.resolvedLanguage ?? 'mk';

export function currentLanguage(): Language {
  const l = (i18n.resolvedLanguage ?? 'mk') as Language;
  return LANGUAGES.includes(l) ? l : 'mk';
}

export default i18n;
