import { LOCALE_TAGS, type Language } from '../i18n';

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

export function hasVoiceFor(lang: Language): boolean {
  if (!speechSupported()) return false;
  const prefix = lang.toLowerCase();
  return window.speechSynthesis.getVoices().some((v) => v.lang.toLowerCase().startsWith(prefix));
}

/** Speak text with the device voice. Silently does nothing if unsupported. */
export function speak(text: string, lang: Language, rate = 1) {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LOCALE_TAGS[lang];
    u.rate = rate;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
    if (voice) u.voice = voice;
    window.speechSynthesis.speak(u);
  } catch {
    /* speech failures must never break navigation */
  }
}

export function stopSpeaking() {
  if (speechSupported()) window.speechSynthesis.cancel();
}

export function vibrationSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function vibrate(pattern: number | number[]) {
  try {
    if (vibrationSupported()) navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}

/** Distinct, learnable patterns: turns vs. crossings vs. warnings. */
export const VIBRATION = {
  step: [120],
  crossing: [120, 80, 120, 80, 120],
  warning: [400, 150, 400],
  arrive: [200, 100, 200],
};
