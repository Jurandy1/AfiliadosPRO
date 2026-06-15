import { Suspense, useCallback, useEffect, useState } from "react";
import AppProviders from "./providers";
import { ROUTES } from "./routes";
import {
  isKnownRoute,
  pathFromRoute,
  readRouteFromLocation,
  syncCanonicalUrl,
} from "./routePaths";
import Sidebar from "../components/layout/Sidebar";
import Topbar from "../components/layout/Topbar";
import { PageToolbarProvider } from "../components/layout/PageToolbarContext";
import LoadingSpinner from "../components/layout/LoadingSpinner";
import { getAlertas } from "../services/repositories/alertsRepository";

function normalizeRouteKey(next) {
  const key = next === "traffic" ? "traffic_overview" : next;
  return isKnownRoute(key) ? key : "dashboard";
}

export default function App() {
  const [route, setRoute] = useState(readRouteFromLocation);
  const [alertCount, setAlertCount] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const refreshAlerts = () => getAlertas().then((a) => setAlertCount(a.length)).catch(() => {});

  useEffect(() => {
    const initial = readRouteFromLocation();
    setRoute(initial);
    syncCanonicalUrl(initial);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const next = readRouteFromLocation();
      setRoute(next);
      syncCanonicalUrl(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    refreshAlerts();
  }, [route]);

  const current = ROUTES[route] || ROUTES.dashboard;
  const Page = current.Page;
  const subtitle =
    route === "audit" ? `${alertCount} pendentes` : current.sub;

  const navigate = useCallback((next) => {
    const normalized = normalizeRouteKey(next);
    setRoute(normalized);
    const path = pathFromRoute(normalized);
    if (window.location.pathname !== path) {
      window.history.pushState({ route: normalized }, "", path);
    }
    setMobileMenuOpen(false);
  }, []);

  return (
    <AppProviders>
      <PageToolbarProvider>
      <div className="flex min-h-screen">
        <div className="hidden md:block sticky top-0 h-screen">
          <Sidebar activeRoute={route} alertCount={alertCount} onNavigate={navigate} />
        </div>
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50">
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Fechar menu"
            />
            <div className="absolute left-0 top-0 h-full w-[260px] shadow-xl">
              <Sidebar
                activeRoute={route}
                alertCount={alertCount}
                onNavigate={navigate}
                onCloseMobile={() => setMobileMenuOpen(false)}
              />
            </div>
          </div>
        )}
        <main className="flex-1 min-w-0 page-main overflow-x-hidden">
          <Topbar
            title={current.title}
            heroTitle={current.heroTitle}
            subtitle={subtitle}
            mobileMenuOpen={mobileMenuOpen}
            onToggleMenu={() => setMobileMenuOpen((v) => !v)}
            onOpenFirestoreDiagnostics={() => navigate("settings")}
          />
          <div className="w-full min-w-0 px-4 sm:px-5 md:px-6 pt-3 pb-5 max-w-[1680px] mx-auto">
            <Suspense fallback={<LoadingSpinner label="Carregando página…" className="py-12" />}>
              {route === "imports" ? (
                <Page onImportDone={refreshAlerts} />
              ) : current.section ? (
                <Page section={current.section} activeRoute={route} onNavigate={navigate} />
              ) : current.needsNavigate ? (
                <Page onNavigate={navigate} />
              ) : (
                <Page />
              )}
            </Suspense>
          </div>
        </main>
      </div>
      </PageToolbarProvider>
    </AppProviders>
  );
}
