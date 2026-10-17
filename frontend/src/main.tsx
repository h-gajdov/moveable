import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './i18n';
import { applyToDocument, loadSettings } from './settings/SettingsContext';
import './styles/index.css';

// Apply theme and text size before first paint to avoid a flash of the wrong theme.
applyToDocument(loadSettings().ui);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}
