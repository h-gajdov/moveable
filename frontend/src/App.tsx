import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AnnouncerProvider } from './components/Announcer';
import { Layout } from './components/Layout';
import { PlanPage } from './pages/PlanPage';
import { SettingsProvider } from './settings/SettingsContext';
import { TripProvider } from './settings/TripContext';

const NavigatePage = lazy(() => import('./pages/NavigatePage').then((m) => ({ default: m.NavigatePage })));
const ReportPage = lazy(() => import('./pages/ReportPage').then((m) => ({ default: m.ReportPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const HelpPage = lazy(() => import('./pages/HelpPage').then((m) => ({ default: m.HelpPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

function NotFound() {
  const { t } = useTranslation();
  return (
    <Layout title={t('notFound.title')}>
      <h1 className="text-3xl font-bold">{t('notFound.title')}</h1>
      <p className="mt-2">{t('notFound.body')}</p>
    </Layout>
  );
}

function Loading() {
  const { t } = useTranslation();
  return <p role="status" className="p-6">{t('common.loading')}</p>;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<PlanPage />} />
        <Route path="/navigate" element={<NavigatePage />} />
        <Route path="/report" element={<ReportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <TripProvider>
          <AnnouncerProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </AnnouncerProvider>
        </TripProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
