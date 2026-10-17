import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProfileCode, RoutingPreferences } from '../api/types';

/**
 * Interface settings are separate from routing needs. Both stay on this device
 * (localStorage). Nothing here is sent to the server except the routing
 * preferences included in a route request.
 */
export interface InterfaceSettings {
  theme: 'system' | 'light' | 'dark' | 'contrast';
  textScale: 1 | 1.25 | 1.5 | 2;
  wideSpacing: boolean;
  motion: 'system' | 'reduce';
  showMap: boolean;
  /** Show mapped disabled parking on the plan map and as a list. */
  showParking: boolean;
  instructionDetail: 'detailed' | 'simple';
  speech: boolean;
  speechRate: number;
  vibration: boolean;
}

export interface RoutingSettings {
  profile: ProfileCode;
  /** Overrides on top of the profile defaults (only fields the user changed). */
  overrides: RoutingPreferences;
}

export interface Settings {
  ui: InterfaceSettings;
  routing: RoutingSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  ui: {
    theme: 'system',
    textScale: 1,
    wideSpacing: false,
    motion: 'system',
    showMap: true,
    showParking: false,
    instructionDetail: 'detailed',
    speech: false,
    speechRate: 1,
    vibration: false,
  },
  routing: { profile: 'STANDARD', overrides: {} },
};

const KEY = 'accessible-skopje:settings:v1';

export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ui: { ...DEFAULT_SETTINGS.ui, ...(parsed.ui ?? {}) },
      routing: { ...DEFAULT_SETTINGS.routing, ...(parsed.routing ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: Settings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode, blocked): settings last for this visit only */
  }
}

export function clearStoredSettings() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

interface Ctx {
  settings: Settings;
  updateUi: (patch: Partial<InterfaceSettings>) => void;
  updateRouting: (patch: Partial<RoutingSettings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<Ctx | null>(null);

export function applyToDocument(ui: InterfaceSettings) {
  const root = document.documentElement;
  root.dataset.theme = ui.theme;
  root.dataset.spacing = ui.wideSpacing ? 'wide' : 'normal';
  root.dataset.motion = ui.motion;
  root.style.setProperty('--text-scale', String(ui.textScale));
}

export function SettingsProvider({ children, initial }: { children: ReactNode; initial?: Settings }) {
  const [settings, setSettings] = useState<Settings>(() => initial ?? loadSettings());

  useEffect(() => {
    applyToDocument(settings.ui);
    saveSettings(settings);
  }, [settings]);

  const updateUi = useCallback((patch: Partial<InterfaceSettings>) =>
    setSettings((s) => ({ ...s, ui: { ...s.ui, ...patch } })), []);
  const updateRouting = useCallback((patch: Partial<RoutingSettings>) =>
    setSettings((s) => ({ ...s, routing: { ...s.routing, ...patch } })), []);
  const reset = useCallback(() => {
    clearStoredSettings();
    setSettings(DEFAULT_SETTINGS);
  }, []);

  const value = useMemo(() => ({ settings, updateUi, updateRouting, reset }), [settings, updateUi, updateRouting, reset]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings outside SettingsProvider');
  return ctx;
}

export function prefersReducedMotion(ui: InterfaceSettings) {
  if (ui.motion === 'reduce') return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
