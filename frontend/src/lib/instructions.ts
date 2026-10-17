import type { TFunction } from 'i18next';
import type { Instruction } from '../api/types';
import type { Language } from '../i18n';
import { formatDistance, pickName } from './format';

/**
 * Turn a structured instruction into a sentence. Only facts present in the data
 * are mentioned; unknown crossing features are stated as unknown, never guessed.
 */
export function instructionText(ins: Instruction, t: TFunction, lang: Language, simple: boolean): string {
  const distance = formatDistance(ins.distanceM, lang);
  const name = pickName(ins.names, lang);
  const way = name ?? t(`instr.path.${ins.pathClass ?? 'PATH'}`, { defaultValue: t('instr.path.PATH') });
  const mod = ins.modifier ? t(`instr.mod.${ins.modifier}`, { defaultValue: ins.modifier }) : '';
  switch (ins.type) {
    case 'DEPART':
      return simple
        ? t('instr.simple.depart', { dir: t(`instr.dir.${ins.modifier}`), distance })
        : t('instr.depart', { dir: t(`instr.dir.${ins.modifier}`), way, distance });
    case 'TURN':
      return simple ? t('instr.simple.turn', { mod, distance }) : t('instr.turn', { mod, way, distance });
    case 'CONTINUE':
      return simple ? t('instr.simple.continue', { distance }) : t('instr.continue', { way, distance });
    case 'CROSS': {
      if (simple) return t('instr.simple.cross');
      const kind = t(`instr.crossKind.${ins.crossing?.type ?? 'unknown'}`, { defaultValue: t('instr.crossKind.unknown') });
      const turn = ins.modifier && ins.modifier !== 'STRAIGHT' && !/^[NSEW]{1,2}$/.test(ins.modifier);
      return turn ? t('instr.crossTurn', { mod, kind }) : t('instr.cross', { kind });
    }
    case 'STAIRS': {
      if (simple) return t('instr.simple.stairs');
      const d = ins.stairs?.direction;
      return d === 'UP' ? t('instr.stairsUp') : d === 'DOWN' ? t('instr.stairsDown') : t('instr.stairsUnknown');
    }
    case 'ARRIVE':
      return simple ? t('instr.simple.arrive') : t('instr.arrive');
    default:
      return '';
  }
}

/** Additional mapped facts for a step (crossing signals, kerbs, stairs details, notes). */
export function instructionDetails(ins: Instruction, t: TFunction): string[] {
  const out: string[] = [];
  const c = ins.crossing;
  if (ins.type === 'CROSS' && c) {
    if (c.signals) out.push(t(`instr.signalSound.${String(c.sound ?? null)}`));
    const tactile = t(`instr.tactile.${String(c.tactilePaving ?? null)}`);
    if (tactile) out.push(tactile);
    if (c.island) out.push(t('instr.island'));
    if (c.kerb) out.push(t(`instr.kerb.${c.kerb}`, { defaultValue: '' }));
  }
  if (ins.type === 'STAIRS' && ins.stairs) {
    if (ins.stairs.stepCount) out.push(t('instr.stairsSteps', { count: ins.stairs.stepCount }));
    if (ins.stairs.handrail) out.push(t('instr.handrail'));
    if (ins.stairs.ramp) out.push(t('instr.ramp'));
  }
  for (const n of ins.notes ?? []) out.push(t(`instr.note.${n}`, { defaultValue: '' }));
  return out.filter(Boolean);
}

export function fullInstruction(ins: Instruction, t: TFunction, lang: Language, simple: boolean) {
  const main = instructionText(ins, t, lang, simple);
  if (simple) {
    // Short form keeps only the safety notes (e.g. no sidewalk), not crossing details.
    const notes = (ins.notes ?? []).map((n) => t(`instr.note.${n}`, { defaultValue: '' })).filter(Boolean);
    return [main, ...notes].join(' ');
  }
  return [main, ...instructionDetails(ins, t)].join(' ');
}
