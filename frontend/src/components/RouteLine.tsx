import { useTranslation } from 'react-i18next';
import type { Instruction } from '../api/types';
import { currentLanguage } from '../i18n';
import { instructionDetails, instructionText } from '../lib/instructions';
import { useSettings } from '../settings/SettingsContext';

/**
 * The route drawn as a transit-line diagram: one stop per step. It is an
 * ordered list, so screen readers announce "list, N items" and each step's
 * position. Crossings and stairs get their own stop shapes (and their names
 * in text) so they stand out without relying on colour.
 */
export function RouteLine({ instructions, color, currentIndex, onSelect }: {
  instructions: Instruction[];
  color: string;
  currentIndex?: number;
  onSelect?: (i: number) => void;
}) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const { settings } = useSettings();
  const simple = settings.ui.instructionDetail === 'simple';

  return (
    <ol className="route-line" style={{ ['--line-color' as string]: color }}>
      {instructions.map((ins, i) => {
        const details = simple ? [] : instructionDetails(ins, t);
        const notes = simple ? (ins.notes ?? []).map((n) => t(`instr.note.${n}`, { defaultValue: '' })).filter(Boolean) : [];
        const current = currentIndex === i;
        return (
          <li key={ins.index} aria-current={current ? 'step' : undefined} className="pb-5">
            <span className="stop" data-kind={ins.type} aria-hidden="true">
              {ins.type === 'CROSS' ? '' : ins.type === 'STAIRS' ? '≡' : i + 1}
            </span>
            <div className={`rounded-lg px-3 py-2 ${current ? 'bg-surface-2' : ''}`}>
              <p className="sr-only">{t('instr.stepLabel', { n: i + 1, total: instructions.length })}</p>
              {onSelect ? (
                <button type="button" onClick={() => onSelect(i)} className="text-left text-lg font-medium leading-snug">
                  {instructionText(ins, t, lang, simple)}
                </button>
              ) : (
                <p className="text-lg font-medium leading-snug">{instructionText(ins, t, lang, simple)}</p>
              )}
              {[...details, ...notes].length > 0 && (
                <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                  {[...details, ...notes].map((d, j) => <li key={j}>{d}</li>)}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
