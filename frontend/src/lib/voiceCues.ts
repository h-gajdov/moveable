import { useEffect } from 'react';
import type { Language } from '../i18n';
import { stopSpeaking } from './speech';

/**
 * Short recorded hints that say what to choose next. The clips are generated
 * from the `voiceCues` locale strings by scripts/generate-voice-cues.py
 * (OmniVoice); this is a demo, so only a few planner steps have one.
 */
export type VoiceCue = 'chooseStart' | 'chooseDestination' | 'pickOnMap' | 'chooseRoute';

let current: HTMLAudioElement | null = null;

export function cueUrl(cue: VoiceCue, lang: Language) {
  return `${import.meta.env.BASE_URL}audio/cues/${lang}/${cue}.mp3`;
}

/** Play a hint, cutting off any hint or device speech still playing. Never throws. */
export function playCue(cue: VoiceCue, lang: Language) {
  if (typeof Audio === 'undefined') return;
  try {
    current?.pause();
    stopSpeaking();
    current = new Audio(cueUrl(cue, lang));
    // Rejected when the browser blocks audio before the first tap, or the clip is missing.
    current.play()?.catch(() => {});
  } catch {
    /* a hint failing must never break the planner */
  }
}

export function stopCue() {
  current?.pause();
  current = null;
}

/** Play `cue` whenever it changes to a new hint while `enabled`. */
export function useVoiceCue(cue: VoiceCue | null, lang: Language, enabled: boolean) {
  useEffect(() => {
    if (enabled && cue) playCue(cue, lang);
  }, [cue, lang, enabled]);
  useEffect(() => stopCue, []);
}
