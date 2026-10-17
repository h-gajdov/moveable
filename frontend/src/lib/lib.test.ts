import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import en from '../i18n/locales/en.json';
import mk from '../i18n/locales/mk.json';
import sq from '../i18n/locales/sq.json';
import type { Instruction } from '../api/types';
import { formatDistance, pickName } from './format';
import { parseCoordinates, projectOnLine } from './geo';
import { fullInstruction, instructionText } from './instructions';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
}

describe('translations', () => {
  it('Macedonian and Albanian have every English key', () => {
    const base = keys(en).sort();
    expect(keys(mk).sort()).toEqual(base);
    expect(keys(sq).sort()).toEqual(base);
  });

  it('Macedonian UI text is Cyrillic', () => {
    expect(mk.plan.findRoute).toMatch(/[Ѐ-ӿ]/);
  });
});

describe('names', () => {
  const names = { default: 'Македонија', latn: 'Makedonija', sq: 'Maqedonia' };
  it('picks the language-appropriate name with transliteration fallback', () => {
    expect(pickName(names, 'mk')).toBe('Македонија');
    expect(pickName(names, 'sq')).toBe('Maqedonia');
    expect(pickName(names, 'en')).toBe('Makedonija');
  });
});

describe('geo', () => {
  it('parses coordinates in common formats', () => {
    expect(parseCoordinates('42.0, 21.43')).toEqual({ lat: 42, lon: 21.43 });
    expect(parseCoordinates('41,9961 21,4316')).toEqual({ lat: 41.9961, lon: 21.4316 });
    expect(parseCoordinates('Partizanska')).toBeNull();
    expect(parseCoordinates('200, 21')).toBeNull();
  });

  it('projects a position onto the route line', () => {
    const line: [number, number][] = [[21.43, 42.0], [21.431, 42.0], [21.431, 42.001]];
    const p = projectOnLine([21.4305, 42.0001], line);
    expect(p.alongM).toBeGreaterThan(38);
    expect(p.alongM).toBeLessThan(45);
    expect(p.offsetM).toBeGreaterThan(9);
    expect(p.offsetM).toBeLessThan(13);
  });

  it('rounds distances for speech', () => {
    expect(formatDistance(83, 'en')).toMatch(/85/);
    expect(formatDistance(1234, 'en')).toMatch(/1\.2/);
  });
});

describe('instructions', () => {
  const base: Instruction = {
    index: 0, type: 'TURN', modifier: 'LEFT', distanceM: 80, startDistanceM: 0, names: { default: 'Македонија', latn: 'Makedonija' },
    pathClass: 'PEDESTRIAN', location: [21.43, 42], notes: [],
  };

  it('renders turns in each language', async () => {
    await i18n.changeLanguage('en');
    expect(instructionText(base, i18n.t, 'en', false)).toBe('Turn left onto Makedonija and continue for 80 m.');
    await i18n.changeLanguage('mk');
    expect(instructionText(base, i18n.t, 'mk', false)).toContain('Свртете лево кон Македонија');
    await i18n.changeLanguage('sq');
    expect(instructionText(base, i18n.t, 'sq', false)).toContain('Kthehuni majtas');
  });

  it('never invents crossing features: unknown sound is stated as unknown', async () => {
    await i18n.changeLanguage('en');
    const cross: Instruction = { ...base, type: 'CROSS', modifier: 'STRAIGHT', names: {}, crossing: { type: 'SIGNALS', signals: true } };
    const text = fullInstruction(cross, i18n.t, 'en', false);
    expect(text).toContain('crossing with traffic signals');
    expect(text).toContain('Not mapped whether the signal is audible');
    expect(text).not.toContain('Tactile paving mapped');
  });

  it('simple mode is short but keeps safety notes', async () => {
    await i18n.changeLanguage('en');
    const ins: Instruction = { ...base, notes: ['WALK_ON_CARRIAGEWAY'] };
    expect(fullInstruction(ins, i18n.t, 'en', true)).toBe(
      'Turn left. Walk 80 m. No sidewalk is mapped here: you may be walking on the road.');
  });
});
