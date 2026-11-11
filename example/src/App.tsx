import React, { useState, useEffect } from 'react';
import {
  createLinguini,
  useTranslation,
  useLanguage,
  useNamespaceStatus,
  useLinguini,
  LinguiniState,
} from 'linguini';

// ----------------------------------------------------
// Mock Data and Logging
// ----------------------------------------------------
const translationsData: Record<string, Record<string, Record<string, any>>> = {
  en: {
    common: {
      title: "Linguini Showcase",
      description: "Lightweight, headless internationalization for React applications.",
      welcome: "Welcome back, {name}!",
      lang_selector: "Select Language",
      refresh_namespace: "Refresh Namespace",
      missing_fallback_key: "This text is only in English (Fallback)",
      status: "Status",
      loaded_version: "Loaded Version"
    },
    dashboard: {
      stats: {
        visits: "Visits",
        revenue: "Revenue",
        users: "Active Users"
      },
      billing_alert: "Your billing cycle ends in {days} days.",
      update_profile: "Update Profile"
    }
  },
  fr: {
    common: {
      title: "Démonstration de Linguini",
      description: "Internationalisation légère et sans tête pour les applications React.",
      welcome: "Bienvenue, {name} !",
      lang_selector: "Sélectionner la langue",
      refresh_namespace: "Actualiser le namespace",
      status: "Statut",
      loaded_version: "Version chargée"
      // missing_fallback_key is missing - triggers defaultLanguage fallback
    },
    dashboard: {
      stats: {
        visits: "Visites",
        revenue: "Revenu",
        users: "Utilisateurs actifs"
      },
      billing_alert: "Votre cycle de facturation se termine dans {days} jours.",
      update_profile: "Modifier le profil"
    }
  },
  es: {
    common: {
      title: "Demostración de Linguini",
      description: "Internacionalización ligera y sin cabeza para aplicaciones React.",
      welcome: "¡Bienvenido, {name}!",
      lang_selector: "Seleccionar idioma",
      refresh_namespace: "Actualizar espacio de nombres",
      status: "Estado",
      loaded_version: "Versión cargada"
      // missing_fallback_key is missing - triggers defaultLanguage fallback
    },
    dashboard: {
      stats: {
        visits: "Visitas",
        revenue: "Ingresos",
        users: "Usuarios activos"
      },
      billing_alert: "Su ciclo de facturation termina en {days} días.",
      update_profile: "Actualizar perfil"
    }
  },
  pirate: {
    common: {
      title: "Linguini Shipyard 🏴‍☠️",
      description: "Featherweight tongue-translator for React vessel apps, ahoy!",
      welcome: "Ahoy, Captain {name}! Welcome to the deck!",
      lang_selector: "Steer Tongue",
      refresh_namespace: "Scuttle Namespace",
      status: "Vessel Status",
      loaded_version: "Plundered Version"
    },
    dashboard: {
      stats: {
        visits: "Booty Hunters",
        revenue: "Gold Chests",
        users: "Lively Crew"
      },
      billing_alert: "Yer gold subscription scuttles in {days} suns!",
      update_profile: "Hoist Flag"
    }
  },
  linguini: {
    common: {
      title: "Pasta Kingdom 🍝",
      description: "Very saucy, al dente headless translation spaghetti for React plates.",
      welcome: "Mamma Mia, {name}! Your pasta is ready!",
      lang_selector: "Choose Sauce",
      refresh_namespace: "Boil Spaghetti",
      status: "Noodle Quality",
      loaded_version: "Al Dente Level"
    },
    dashboard: {
      stats: {
        visits: "Fork Twirls",
        revenue: "Pounds of Cheese",
        users: "Meatball Lovers"
      },
      billing_alert: "Spaghetti boils over in {days} minutes!",
      update_profile: "Add Meatballs"
    }
  }
};

let currentLatency = 1000; // default 1 second latency
const logListeners = new Set<() => void>();
const logs: { id: string; time: string; msg: string; type: 'info' | 'success' | 'warn' }[] = [];

function addLog(msg: string, type: 'info' | 'success' | 'warn' = 'info') {
  logs.unshift({
    id: Math.random().toString(36).substring(7),
    time: new Date().toLocaleTimeString(),
    msg,
    type,
  });
  logListeners.forEach((l) => l());
}

// Custom hook to subscribe to logs in components
function useLogs() {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const update = () => forceUpdate((c) => c + 1);
    logListeners.add(update);
    return () => {
      logListeners.delete(update);
    };
  }, []);
  return logs;
}

// ----------------------------------------------------
// Configure Linguini Instance
// ----------------------------------------------------
const mockLoader = async (lang: string, ns: string, options?: { version?: string }) => {
  const verSuffix = options?.version ? `?v=${options.version}` : '';
  addLog(`🔄 Fetching: /locales/${lang}/${ns}.json${verSuffix}`, 'info');

  if (currentLatency > 0) {
    await new Promise((resolve) => setTimeout(resolve, currentLatency));
  }

  const data = translationsData[lang]?.[ns];
  if (!data) {
    addLog(`❌ Failed loading: /locales/${lang}/${ns}.json${verSuffix} (Not Found)`, 'warn');
    throw new Error(`Namespace ${ns} for language ${lang} not found`);
  }

  addLog(`✅ Loaded: /locales/${lang}/${ns}.json${verSuffix}`, 'success');
  return data;
};

type AppSchema = typeof translationsData['en'];

const linguini = createLinguini<AppSchema>({
  supportedLanguages: ['en', 'fr', 'es', 'pirate', 'linguini'],
  defaultLanguage: 'en',
  loader: mockLoader,
  defaultVersion: '1.0.0',
});

// ----------------------------------------------------
// Main App Component
// ----------------------------------------------------
export default function App() {
  return (
    <linguini.LinguiniProvider>
      <DashboardWrapper />
    </linguini.LinguiniProvider>
  );
}

function DashboardWrapper() {
  const { language, setLanguage, supportedLanguages } = useLanguage();
  const { refreshNamespace, state } = useLinguini();
  const [activeTab, setActiveTab] = useState<'playground' | 'docs'>('playground');
  const [nameInput, setNameInput] = useState('Chef');
  const [daysCount, setDaysCount] = useState(12);
  const [latencyVal, setLatencyVal] = useState(1000);
  const [refreshVer, setRefreshVer] = useState('1.0.0');
  const appLogs = useLogs();

  useEffect(() => {
    currentLatency = latencyVal;
  }, [latencyVal]);

  const handleLatencyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLatencyVal(Number(e.target.value));
  };

  const handleLanguageChange = (lang: string) => {
    addLog(`🌐 Language switched to: "${lang}"`, 'info');
    setLanguage(lang);
  };

  const handleRefresh = (ns: string) => {
    const nextVer = (parseFloat(refreshVer) + 0.1).toFixed(1);
    setRefreshVer(nextVer);
    addLog(`⚡ Force reloading namespace: "${ns}" with version "${nextVer}"`, 'info');
    refreshNamespace(ns, { version: nextVer });
  };

  return (
    <div className="container">
      {/* HEADER */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '2.5rem' }}>🍝</span>
          <div>
            <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.02em', background: 'linear-gradient(135deg, #a5b4fc, #c084fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Linguini
            </h1>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Headless I18n for React</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span className="badge badge-loaded">Zero Dependencies</span>
          <span className="badge badge-loaded">Code Split</span>
        </div>
      </header>

      {/* TAB SELECTOR */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '32px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '16px' }}>
        <button
          className={activeTab === 'playground' ? 'primary' : ''}
          onClick={() => setActiveTab('playground')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          ✨ Live Playground
        </button>
        <button
          className={activeTab === 'docs' ? 'primary' : ''}
          onClick={() => setActiveTab('docs')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          📖 Code Snippets & Docs
        </button>
      </div>

      {activeTab === 'playground' ? (
        /* DASHBOARD GRID */
        <div className="grid">
        
        {/* PANEL 1: CONTROL PANEL */}
        <section className="glass-panel">
          <h2 style={{ marginTop: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            ⚙️ Control Panel
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px' }}>
            Modify active configurations to see Linguini adapt and update state hooks dynamically.
          </p>

          {/* Lang switcher */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600 }}>
              🌐 SELECT LANGUAGE
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {supportedLanguages.map((lang: string) => (
                <button
                  key={lang}
                  className={language === lang ? 'primary' : ''}
                  onClick={() => handleLanguageChange(lang)}
                  style={{ textTransform: 'uppercase' }}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>

          {/* Latency slider */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              <label>⏱️ ARTIFICIAL LATENCY</label>
              <span style={{ color: 'var(--color-primary)' }}>{latencyVal}ms</span>
            </div>
            <input
              type="range"
              min="0"
              max="5000"
              step="500"
              value={latencyVal}
              onChange={handleLatencyChange}
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Increase latency to inspect skeleton screens and loading states.
            </span>
          </div>

          {/* Refresh buttons */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600 }}>
              ⚡ FORCE REFRESH (CACHE BUSTING)
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={() => handleRefresh('common')}>
                🔄 Refresh 'common'
              </button>
              <button onClick={() => handleRefresh('dashboard')}>
                🔄 Refresh 'dashboard'
              </button>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px', margin: 0 }}>
              Appends cache busters. Increments versions dynamically (Current next: <code style={{ color: 'var(--color-secondary)' }}>{refreshVer}</code>).
            </p>
          </div>
        </section>

        {/* PANEL 2: LOADER LOGS */}
        <section className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
          <h2 style={{ marginTop: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            📟 Network & Loader Logs
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
            Real-time feed of loader queries triggered by React lifecycle components.
          </p>
          
          <div className="log-console" style={{ flexGrow: 1, minHeight: '150px' }}>
            {appLogs.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', paddingTop: '40px' }}>
                No operations logged yet.
              </div>
            ) : (
              appLogs.map((log) => (
                <div key={log.id} className="log-entry" style={{
                  color: log.type === 'success' ? 'var(--color-success)' :
                         log.type === 'warn' ? 'var(--color-error)' : '#a5b4fc'
                }}>
                  <span className="log-time">[{log.time}]</span>
                  <span>{log.msg}</span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* TRANSLATION BLOCKS: VISUAL TESTBED */}
        <div className="grid-full" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '32px', marginTop: '16px' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '24px' }}>
            ✨ Live Translation Consumers
          </h2>
        </div>

        {/* CARD 1: COMMON NAMESPACE CARD */}
        <CommonTranslationCard nameInput={nameInput} setNameInput={setNameInput} state={state} />

        {/* CARD 2: DASHBOARD NAMESPACE CARD */}
        <DashboardTranslationCard daysCount={daysCount} setDaysCount={setDaysCount} state={state} />

        {/* CARD 3: FALLBACK DEMO CARD */}
        <FallbackDemoCard state={state} />
        
          {/* CARD 4: MULTI NAMESPACE CARD */}
          <MultiNamespaceCard nameInput={nameInput} state={state} />

        </div>
      ) : (
        <DeveloperDocs />
      )}
    </div>
  );
}

// ----------------------------------------------------
// Card Sub-components
// ----------------------------------------------------

interface CardProps {
  state: LinguiniState;
}

const CardSkeleton = () => (
  <div className="glass-panel" style={{ minHeight: '260px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div className="skeleton skeleton-avatar"></div>
      <div className="skeleton" style={{ width: '80px', height: '24px', borderRadius: '12px' }}></div>
    </div>
    <div className="skeleton skeleton-title" style={{ width: '50%' }}></div>
    <div className="skeleton skeleton-text" style={{ width: '100%' }}></div>
    <div className="skeleton skeleton-text" style={{ width: '85%' }}></div>
    <div className="skeleton skeleton-btn" style={{ marginTop: 'auto' }}></div>
  </div>
);

function CommonTranslationCard({
  nameInput,
  setNameInput,
  state
}: {
  nameInput: string;
  setNameInput: (s: string) => void;
  state: LinguiniState;
}) {
  const { t, ready } = useTranslation('common');
  const nsStatus = useNamespaceStatus('common');
  const loadedVer = state.versions[state.language]?.['common'] || '1.0.0';

  if (!ready) {
    return <CardSkeleton />;
  }

  return (
    <div className="glass-panel" style={{ minHeight: '260px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ fontSize: '1.5rem' }}>🏡</span>
          <span className={`badge badge-${nsStatus}`}>{nsStatus}</span>
        </div>
        
        <h3 style={{ margin: '0 0 8px 0', fontSize: '1.25rem' }}>{t('title')}</h3>
        <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          {t('description')}
        </p>

        <p style={{ margin: '0 0 16px 0', fontWeight: 600, color: 'var(--color-primary)' }}>
          {t('welcome', { name: nameInput })}
        </p>
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px', marginTop: '12px' }}>
        <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>
          ENTER NAME (INTERPOLATION MOCK)
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            style={{
              flexGrow: 1,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '6px',
              padding: '6px 12px',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
            Ver: <code style={{ color: 'var(--color-secondary)' }}>{loadedVer}</code>
          </span>
        </div>
      </div>
    </div>
  );
}

function DashboardTranslationCard({
  daysCount,
  setDaysCount,
  state
}: {
  daysCount: number;
  setDaysCount: (n: number) => void;
  state: LinguiniState;
}) {
  const { t, ready } = useTranslation('dashboard');
  const nsStatus = useNamespaceStatus('dashboard');
  const loadedVer = state.versions[state.language]?.['dashboard'] || '1.0.0';

  if (!ready) {
    return <CardSkeleton />;
  }

  return (
    <div className="glass-panel" style={{ minHeight: '260px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ fontSize: '1.5rem' }}>📊</span>
          <span className={`badge badge-${nsStatus}`}>{nsStatus}</span>
        </div>

        <h3 style={{ margin: '0 0 12px 0', fontSize: '1.25rem' }}>Dashboard Statistics</h3>
        
        {/* Simulated Stats Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '16px' }}>
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('stats.visits')}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>45.2K</div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('stats.revenue')}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-success)' }}>$12.4K</div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('stats.users')}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>1,840</div>
          </div>
        </div>

        <p style={{ margin: '0', fontSize: '0.85rem', color: 'var(--color-warning)' }}>
          ⚠️ {t('billing_alert', { days: daysCount })}
        </p>
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px', marginTop: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={() => setDaysCount(Math.max(1, daysCount - 1))} style={{ padding: '4px 8px', fontSize: '0.75rem' }}>-</button>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{daysCount} Days</span>
            <button onClick={() => setDaysCount(daysCount + 1)} style={{ padding: '4px 8px', fontSize: '0.75rem' }}>+</button>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Ver: <code style={{ color: 'var(--color-secondary)' }}>{loadedVer}</code>
          </span>
        </div>
      </div>
    </div>
  );
}

function FallbackDemoCard({ state }: CardProps) {
  const { t, ready } = useTranslation('common');
  const activeLang = state.language;

  if (!ready) {
    return <CardSkeleton />;
  }

  const isFallbackActive = activeLang !== 'en';

  return (
    <div className="glass-panel" style={{ minHeight: '260px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ fontSize: '1.5rem' }}>🛟</span>
          {isFallbackActive ? (
            <span className="badge badge-loaded" style={{ background: 'rgba(99, 102, 241, 0.15)', color: 'var(--color-primary)', borderColor: 'rgba(99, 102, 241, 0.3)' }}>
              Fallback Triggered
            </span>
          ) : (
            <span className="badge badge-idle">Default Language</span>
          )}
        </div>

        <h3 style={{ margin: '0 0 8px 0', fontSize: '1.25rem' }}>Language Fallback Demo</h3>
        <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          This card demonstrates English fallback. The key below does not exist in French or Spanish translation files.
        </p>

        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px', borderLeft: '3px solid var(--color-primary)' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
            Resolved Translation Text
          </div>
          <div style={{ fontWeight: 500, fontSize: '0.95rem' }}>
            {t('missing_fallback_key')}
          </div>
        </div>
      </div>

      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px', marginTop: '12px' }}>
        <span>Active Language: </span>
        <code style={{ textTransform: 'uppercase', color: 'var(--color-primary)' }}>{activeLang}</code>
        <span style={{ margin: '0 8px' }}>|</span>
        <span>Fallback: </span>
        <code style={{ color: 'var(--text-secondary)' }}>en</code>
      </div>
    </div>
  );
}

function MultiNamespaceCard({
  nameInput,
}: {
  nameInput: string;
  state: LinguiniState;
}) {
  // Pass array of namespaces!
  const { t, ready } = useTranslation(['dashboard', 'common']);

  if (!ready) {
    return <CardSkeleton />;
  }

  return (
    <div className="glass-panel" style={{ minHeight: '260px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ fontSize: '1.5rem' }}>🖇️</span>
          <span className="badge badge-loaded">Multi-Namespace</span>
        </div>

        <h3 style={{ margin: '0 0 8px 0', fontSize: '1.25rem' }}>Multi-Namespace Hook</h3>
        <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          This card calls <code>useTranslation(['dashboard', 'common'])</code>. It resolves keys across both namespaces, with <code>dashboard</code> taking precedence.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Resolves 'update_profile' (dashboard):</span>
            <span style={{ fontWeight: 600, color: 'var(--color-secondary)' }}>{t('update_profile')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Resolves 'welcome' (common):</span>
            <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{t('welcome', { name: nameInput })}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Explicit prefix namespace 'common:title':</span>
            <span style={{ fontWeight: 600 }}>{t('common:title')}</span>
          </div>
        </div>
      </div>

      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px', marginTop: '12px' }}>
        <span>Bound namespaces: </span>
        <code style={{ color: 'var(--color-secondary)' }}>['dashboard', 'common']</code>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// Developer Docs Component
// ----------------------------------------------------
function DeveloperDocs() {
  const [selectedDoc, setSelectedDoc] = useState<'init' | 'provider' | 'hooks' | 'refresh'>('init');

  const docSnippets = {
    init: {
      title: "1. Setup & Config",
      desc: "Initialize Linguini once in your app config. Provide the supported languages, fallback defaults, and your custom promise-based loader (e.g., fetch, static imports, or filesystem loaders).",
      code: `// i18n.ts
import { createLinguini } from 'linguini';

export const { LinguiniProvider, store } = createLinguini({
  supportedLanguages: ['en', 'fr', 'es'],
  defaultLanguage: 'en', // Cascades key lookup here if missing in active
  defaultVersion: '1.0.0', // Optional default loader version
  
  // Define loader once: must return a Promise of flat/nested translations
  loader: async (lang, ns, options) => {
    const version = options?.version ? \`?v=\${options.version}\` : '';
    const response = await fetch(\`/locales/\${lang}/\${ns}.json\${version}\`);
    if (!response.ok) throw new Error('Failed to load translations');
    return response.json();
  }
});`
    },
    provider: {
      title: "2. App Bootstrapping",
      desc: "Wrap your application root with the generated LinguiniProvider. All hooks down the tree will now have access to translation stores and active languages.",
      code: `// main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { LinguiniProvider } from './i18n';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LinguiniProvider>
      <App />
    </LinguiniProvider>
  </React.StrictMode>
);`
    },
    hooks: {
      title: "3. Translating Keys & Skeletons",
      desc: "Use the useTranslation hook in your components. It automatically triggers lazy loading of the requested namespace for the active language. Use the 'ready' flag to show skeletons.",
      code: `// ProfileCard.tsx
import React from 'react';
import { useTranslation, useLanguage } from 'linguini';

export function ProfileCard() {
  // Triggers loading of 'dashboard' namespace
  const { t, ready } = useTranslation('dashboard');
  const { language } = useLanguage();

  if (!ready) {
    // Render loading state or skeletons
    return <CardSkeleton />;
  }

  return (
    <div className="card">
      <h3>{t('stats.visits')}</h3>
      {/* Dynamic values are easily interpolated using variables */}
      <p>{t('billing_alert', { days: 12 })}</p>
    </div>
  );
}`
    },
    refresh: {
      title: "4. Dynamic Refreshing",
      desc: "Linguini provides a refreshNamespace action to force dynamic updates. Perfect for hot-reloading translations on user actions or version checking without reloading the entire page.",
      code: `// SettingsPanel.tsx
import React from 'react';
import { useLinguini } from 'linguini';

export function SettingsPanel() {
  const { refreshNamespace, state } = useLinguini();

  const handleUpdateCheck = async () => {
    const newVersion = '1.1.0'; // Or timestamp: Date.now().toString()
    
    // Triggers loader again for 'common' with the new version context
    await refreshNamespace('common', { version: newVersion });
  };

  return (
    <div>
      <button onClick={handleUpdateCheck}>Update Translations</button>
      <p>Loaded version: {state.versions[state.language]?.['common']}</p>
    </div>
  );
}`
    }
  };

  const current = docSnippets[selectedDoc];

  return (
    <div className="glass-panel grid-full" style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: '24px', padding: '24px' }}>
      {/* Sidebar navigation */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRight: '1px solid rgba(255,255,255,0.06)', paddingRight: '16px' }}>
        {(Object.keys(docSnippets) as Array<keyof typeof docSnippets>).map((key) => (
          <button
            key={key}
            onClick={() => setSelectedDoc(key)}
            style={{
              justifyContent: 'flex-start',
              background: selectedDoc === key ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
              borderColor: selectedDoc === key ? 'var(--color-primary)' : 'transparent',
              textAlign: 'left',
              padding: '10px 16px',
              fontSize: '0.9rem',
              width: '100%'
            }}
          >
            {docSnippets[key].title}
          </button>
        ))}
      </div>

      {/* Main Snippet Viewer */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'left' }}>
        <h3 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-primary)' }}>
          {current.title}
        </h3>
        <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
          {current.desc}
        </p>

        {/* Code editor pane */}
        <div style={{
          background: '#07080b',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: '10px',
          padding: '20px',
          fontFamily: 'monospace',
          fontSize: '0.85rem',
          lineHeight: '1.5',
          overflowX: 'auto',
          whiteSpace: 'pre',
          color: '#e2e8f0',
          position: 'relative'
        }}>
          {/* Editor indicators */}
          <div style={{ display: 'flex', gap: '6px', position: 'absolute', top: '12px', right: '12px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ff5f56' }}></span>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ffbd2e' }}></span>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#27c93f' }}></span>
          </div>
          <code>{current.code}</code>
        </div>
      </div>
    </div>
  );
}
