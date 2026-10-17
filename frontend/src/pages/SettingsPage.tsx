import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProfileCode } from '../api/types';
import { useAnnounce } from '../components/Announcer';
import { Layout } from '../components/Layout';
import { ProfilePicker } from '../components/NeedsEditor';
import { Button, Checkbox, Footnote, Group, GroupHeading, PageTitle, RadioGroup, Select } from '../components/ui';
import { currentLanguage } from '../i18n';
import { hasVoiceFor, speak, speechSupported, vibrate, vibrationSupported, VIBRATION } from '../lib/speech';
import { useSettings, type InterfaceSettings } from '../settings/SettingsContext';

export function SettingsPage() {
  const { t } = useTranslation();
  const announce = useAnnounce();
  const { settings, updateUi, updateRouting, reset } = useSettings();
  const ui = settings.ui;
  const lang = currentLanguage();
  const [voiceNote, setVoiceNote] = useState<string | null>(null);

  return (
    <Layout title={t('settings.title')}>
      <PageTitle subtitle={t('settings.intro')}>{t('settings.title')}</PageTitle>

      <section aria-labelledby="disp-h" className="mt-10 flex flex-col gap-5">
        <GroupHeading id="disp-h">{t('settings.display')}</GroupHeading>
        <RadioGroup<InterfaceSettings['theme']> variant="segmented" legend={t('settings.theme')} name="theme" value={ui.theme}
          onChange={(v) => updateUi({ theme: v })}
          options={(['system', 'light', 'dark', 'contrast'] as const).map((v) => ({ value: v, label: t(`settings.themes.${v}`) }))} />
        <RadioGroup<string> variant="segmented" legend={t('settings.textSize')} name="textScale" value={String(ui.textScale)}
          onChange={(v) => updateUi({ textScale: Number(v) as InterfaceSettings['textScale'] })}
          options={['1', '1.25', '1.5', '2'].map((v) => ({ value: v, label: `${Math.round(Number(v) * 100)} %` }))} />
        <RadioGroup<InterfaceSettings['motion']> variant="segmented" legend={t('settings.motion')} name="motion" value={ui.motion}
          onChange={(v) => updateUi({ motion: v })}
          options={(['system', 'reduce'] as const).map((v) => ({ value: v, label: t(`settings.motions.${v}`) }))} />
        <Group>
          <Checkbox label={t('settings.spacing')} checked={ui.wideSpacing} onChange={(v) => updateUi({ wideSpacing: v })} />
          <Checkbox label={t('settings.showMap')} hint={t('settings.showMapHint')} checked={ui.showMap}
            onChange={(v) => updateUi({ showMap: v })} />
        </Group>
      </section>

      <section aria-labelledby="guide-h" className="mt-10 flex flex-col gap-5">
        <GroupHeading id="guide-h">{t('settings.guidance')}</GroupHeading>
        <RadioGroup<InterfaceSettings['instructionDetail']> variant="segmented" legend={t('settings.detail')} name="detail" value={ui.instructionDetail}
          onChange={(v) => updateUi({ instructionDetail: v })}
          options={(['detailed', 'simple'] as const).map((v) => ({ value: v, label: t(`settings.details.${v}`) }))} />
        <Group>
          <Checkbox label={t('settings.speech')} hint={speechSupported() ? t('settings.speechHint') : t('nav2.speechUnavailable')}
            checked={ui.speech} onChange={(v) => updateUi({ speech: v })} />
          {ui.speech && speechSupported() && (
            <Select label={t('settings.speechRate')} value={String(ui.speechRate)} onChange={(v) => updateUi({ speechRate: Number(v) })}
              options={['0.7', '0.85', '1', '1.2', '1.4'].map((v) => ({ value: v, label: `${v}×` }))} />
          )}
          {ui.speech && speechSupported() && (
            <div className="py-2">
              <Button variant="quiet" className="-ml-4" onClick={() => {
                speak(t('settings.testSpeechText'), lang, ui.speechRate);
                setVoiceNote(hasVoiceFor(lang) ? null : t('settings.noVoice'));
              }}>{t('settings.testSpeech')}</Button>
              {voiceNote && <p role="status" className="pb-1 text-[0.875rem] text-muted">{voiceNote}</p>}
            </div>
          )}
          <Checkbox label={t('settings.vibration')} hint={vibrationSupported() ? t('settings.vibrationHint') : t('settings.noVibration')}
            checked={ui.vibration} onChange={(v) => updateUi({ vibration: v })} />
          {ui.vibration && vibrationSupported() && (
            <div className="py-2">
              <Button variant="quiet" className="-ml-4" onClick={() => vibrate(VIBRATION.step)}>{t('settings.testVibration')}</Button>
            </div>
          )}
        </Group>
      </section>

      <section aria-labelledby="route-h" className="mt-10 flex flex-col gap-3">
        <div>
          <GroupHeading id="route-h">{t('settings.routing')}</GroupHeading>
          <Footnote>{t('settings.routingHint')}</Footnote>
        </div>
        <ProfilePicker value={settings.routing.profile} onChange={(p: ProfileCode) => updateRouting({ profile: p, overrides: {} })} />
      </section>

      <section aria-labelledby="priv-h" className="mt-10 flex flex-col gap-3">
        <GroupHeading id="priv-h">{t('settings.privacy')}</GroupHeading>
        <div className="card">
          <Button variant="quiet" className="min-h-12 w-full justify-start rounded-card px-4 text-issue! hover:bg-fill"
            onClick={() => { reset(); announce(t('settings.cleared')); }}>
            {t('settings.clear')}
          </Button>
        </div>
      </section>
    </Layout>
  );
}
