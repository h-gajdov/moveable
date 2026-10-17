import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProfileCode } from '../api/types';
import { useAnnounce } from '../components/Announcer';
import { Layout } from '../components/Layout';
import { ProfilePicker } from '../components/NeedsEditor';
import { Button, Checkbox, RadioGroup, Select } from '../components/ui';
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
      <h1 className="text-3xl font-bold">{t('settings.title')}</h1>
      <p className="mt-2 text-ink-soft">{t('settings.intro')}</p>

      <section aria-labelledby="disp-h" className="mt-8 flex flex-col gap-4">
        <h2 id="disp-h" className="text-2xl font-bold">{t('settings.display')}</h2>
        <RadioGroup<InterfaceSettings['theme']> legend={t('settings.theme')} name="theme" value={ui.theme}
          onChange={(v) => updateUi({ theme: v })}
          options={(['system', 'light', 'dark', 'contrast'] as const).map((v) => ({ value: v, label: t(`settings.themes.${v}`) }))} />
        <RadioGroup<string> legend={t('settings.textSize')} name="textScale" value={String(ui.textScale)}
          onChange={(v) => updateUi({ textScale: Number(v) as InterfaceSettings['textScale'] })}
          options={['1', '1.25', '1.5', '2'].map((v) => ({ value: v, label: `${Math.round(Number(v) * 100)} %` }))} />
        <Checkbox label={t('settings.spacing')} checked={ui.wideSpacing} onChange={(v) => updateUi({ wideSpacing: v })} />
        <RadioGroup<InterfaceSettings['motion']> legend={t('settings.motion')} name="motion" value={ui.motion}
          onChange={(v) => updateUi({ motion: v })}
          options={(['system', 'reduce'] as const).map((v) => ({ value: v, label: t(`settings.motions.${v}`) }))} />
        <Checkbox label={t('settings.showMap')} hint={t('settings.showMapHint')} checked={ui.showMap}
          onChange={(v) => updateUi({ showMap: v })} />
      </section>

      <section aria-labelledby="guide-h" className="mt-8 flex flex-col gap-4">
        <h2 id="guide-h" className="text-2xl font-bold">{t('settings.guidance')}</h2>
        <RadioGroup<InterfaceSettings['instructionDetail']> legend={t('settings.detail')} name="detail" value={ui.instructionDetail}
          onChange={(v) => updateUi({ instructionDetail: v })}
          options={(['detailed', 'simple'] as const).map((v) => ({ value: v, label: t(`settings.details.${v}`) }))} />
        <Checkbox label={t('settings.speech')} hint={speechSupported() ? t('settings.speechHint') : t('nav2.speechUnavailable')}
          checked={ui.speech} onChange={(v) => updateUi({ speech: v })} />
        {ui.speech && speechSupported() && (
          <div className="flex flex-col gap-2">
            <Select label={t('settings.speechRate')} value={String(ui.speechRate)} onChange={(v) => updateUi({ speechRate: Number(v) })}
              options={['0.7', '0.85', '1', '1.2', '1.4'].map((v) => ({ value: v, label: `${v}×` }))} />
            <div>
              <Button onClick={() => {
                speak(t('settings.testSpeechText'), lang, ui.speechRate);
                setVoiceNote(hasVoiceFor(lang) ? null : t('settings.noVoice'));
              }}>{t('settings.testSpeech')}</Button>
            </div>
            {voiceNote && <p role="status" className="text-sm">{voiceNote}</p>}
          </div>
        )}
        <Checkbox label={t('settings.vibration')} hint={vibrationSupported() ? t('settings.vibrationHint') : t('settings.noVibration')}
          checked={ui.vibration} onChange={(v) => updateUi({ vibration: v })} />
        {ui.vibration && vibrationSupported() && (
          <div><Button onClick={() => vibrate(VIBRATION.step)}>{t('settings.testVibration')}</Button></div>
        )}
      </section>

      <section aria-labelledby="route-h" className="mt-8 flex flex-col gap-2">
        <h2 id="route-h" className="text-2xl font-bold">{t('settings.routing')}</h2>
        <p className="text-ink-soft">{t('settings.routingHint')}</p>
        <ProfilePicker value={settings.routing.profile} onChange={(p: ProfileCode) => updateRouting({ profile: p, overrides: {} })} />
      </section>

      <section aria-labelledby="priv-h" className="mt-8 flex flex-col gap-2">
        <h2 id="priv-h" className="text-2xl font-bold">{t('settings.privacy')}</h2>
        <div>
          <Button variant="danger" onClick={() => { reset(); announce(t('settings.cleared')); }}>{t('settings.clear')}</Button>
        </div>
      </section>
    </Layout>
  );
}
