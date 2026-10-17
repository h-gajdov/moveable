import { useTranslation } from 'react-i18next';
import type { Profile, ProfileCode, RoutingPreferences } from '../api/types';
import { Button, Checkbox, RadioGroup, Select } from './ui';

export const PROFILE_ORDER: ProfileCode[] = ['STANDARD', 'WHEELCHAIR', 'VISUALLY_IMPAIRED', 'REDUCED_MOBILITY', 'CUSTOM'];

type BoolKey = {
  [K in keyof RoutingPreferences]-?: RoutingPreferences[K] extends boolean | null | undefined ? K : never;
}[keyof RoutingPreferences];

const REQUIREMENT_FLAGS: BoolKey[] = ['wheeled', 'avoidStairs'];
const PREFERENCE_FLAGS: BoolKey[] = [
  'visualGuidance', 'avoidRoughSurfaces', 'preferPedestrianAreas', 'preferAccessibleCrossings',
  'minimizeTrafficExposure', 'preferSimpleIntersections', 'preferRestingSpots', 'preferLitPaths', 'minimizeDistance',
];

const INCLINES = ['', '5', '6', '8', '10', '12', '15'];
const WIDTHS = ['', '0.8', '0.9', '1.0', '1.2', '1.5'];
const KERBS = ['', '0', '2', '3', '5', '8'];
const SPEEDS = ['0.6', '0.8', '1.0', '1.2', '1.4'];

export function effectivePrefs(profile: Profile | undefined, overrides: RoutingPreferences): RoutingPreferences {
  return { ...(profile?.defaults ?? {}), ...overrides };
}

export function ProfilePicker({ value, onChange }: { value: ProfileCode; onChange: (p: ProfileCode) => void }) {
  const { t } = useTranslation();
  return (
    <RadioGroup<ProfileCode>
      legend={t('plan.profileLegend')}
      name="profile"
      value={value}
      onChange={onChange}
      options={PROFILE_ORDER.map((p) => ({
        value: p,
        label: t(`plan.profiles.${p}.name`),
        description: t(`plan.profiles.${p}.desc`),
      }))}
    />
  );
}

/**
 * Requirements (hard constraints) and preferences (soft constraints), shown
 * separately so the user knows which settings remove paths from the route.
 */
export function PreferencesEditor({ profile, overrides, onChange }: {
  profile: Profile | undefined;
  overrides: RoutingPreferences;
  onChange: (o: RoutingPreferences) => void;
}) {
  const { t } = useTranslation();
  const p = effectivePrefs(profile, overrides);
  const set = (patch: RoutingPreferences) => onChange({ ...overrides, ...patch });
  const num = (v: string) => (v === '' ? null : Number(v));
  const fmt = (v: number | null | undefined) => (v == null ? '' : String(v));
  const changed = Object.keys(overrides).length > 0;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-soft">{t('prefs.unknownNote')}</p>
      <fieldset>
        <legend className="font-display text-lg font-semibold">{t('prefs.requirements')}</legend>
        <p className="mb-1 text-sm text-ink-soft">{t('prefs.requirementsHint')}</p>
        {REQUIREMENT_FLAGS.map((k) => (
          <Checkbox key={k} label={t(`prefs.${k}`)} checked={!!p[k]} onChange={(v) => set({ [k]: v })} />
        ))}
        <Select
          label={t('prefs.maxInclinePct')}
          value={fmt(p.maxInclinePct)}
          onChange={(v) => set({ maxInclinePct: num(v) })}
          options={INCLINES.map((v) => ({ value: v, label: v === '' ? t('prefs.noLimit') : `${v} %` }))}
        />
        <Select
          label={t('prefs.minWidthM')}
          value={fmt(p.minWidthM)}
          onChange={(v) => set({ minWidthM: num(v) })}
          options={WIDTHS.map((v) => ({ value: v, label: v === '' ? t('prefs.noLimit') : `${v.replace('.', ',')} m` }))}
        />
        {p.wheeled && (
          <Select
            label={t('prefs.maxKerbHeightCm')}
            value={fmt(p.maxKerbHeightCm ?? 3)}
            onChange={(v) => set({ maxKerbHeightCm: num(v) })}
            options={KERBS.filter((v) => v !== '').map((v) => ({ value: v, label: `${v} cm` }))}
          />
        )}
      </fieldset>
      <fieldset>
        <legend className="font-display text-lg font-semibold">{t('prefs.preferences')}</legend>
        <p className="mb-1 text-sm text-ink-soft">{t('prefs.preferencesHint')}</p>
        {PREFERENCE_FLAGS.map((k) => (
          <Checkbox key={k} label={t(`prefs.${k}`)} checked={!!p[k]} onChange={(v) => set({ [k]: v })} />
        ))}
        <Select
          label={t('prefs.walkingSpeedMps')}
          value={SPEEDS.reduce((best, s) =>
            Math.abs(Number(s) - (p.walkingSpeedMps ?? 1.2)) < Math.abs(Number(best) - (p.walkingSpeedMps ?? 1.2)) ? s : best)}
          onChange={(v) => set({ walkingSpeedMps: Number(v) })}
          options={SPEEDS.map((v) => ({ value: v, label: t(`prefs.speeds.${v}`) }))}
        />
      </fieldset>
      {changed && (
        <div>
          <p className="text-sm text-ink-soft">{t('prefs.changed')}</p>
          <Button variant="quiet" onClick={() => onChange({})} className="mt-1 underline">{t('prefs.resetToProfile')}</Button>
        </div>
      )}
    </div>
  );
}
