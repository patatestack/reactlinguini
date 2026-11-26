import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLinguiniStore } from '../store';
import { LinguiniConfig } from '../types';

describe('LinguiniStore', () => {
  let mockLoader: any;
  let config: LinguiniConfig;

  beforeEach(() => {
    mockLoader = vi.fn().mockImplementation(async (lang, ns, options) => {
      if (lang === 'en' && ns === 'common') {
        return { welcome: 'Welcome {name}', fallbackOnly: 'English Fallback' };
      }
      if (lang === 'fr' && ns === 'common') {
        return { welcome: 'Bienvenue {name}' };
      }
      throw new Error(`Mock loader failed for ${lang}/${ns}`);
    });

    config = {
      supportedLanguages: ['en', 'fr'],
      defaultLanguage: 'en',
      loader: mockLoader,
    };
  });

  it('initializes with default state', () => {
    // Force browser language
    // @ts-ignore
    global.navigator = { languages: ['fr-FR'] };
    
    const store = createLinguiniStore(config);
    const state = store.getState();
    
    expect(state.language).toBe('fr');
    expect(state.translations).toEqual({});
    expect(state.loadingStates).toEqual({});
  });

  it('subscribes to state updates and allows unsubscribing', () => {
    const store = createLinguiniStore(config);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.setLanguage('en');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.setLanguage('fr');
    expect(listener).toHaveBeenCalledTimes(1); // Not called again after unsubscribe
  });

  it('loads namespace and updates loading state', async () => {
    const store = createLinguiniStore(config);
    
    const loadPromise = store.loadNamespace('en', 'common');
    expect(store.getState().loadingStates.en?.common).toBe('loading');

    await loadPromise;
    const state = store.getState();
    expect(state.loadingStates.en?.common).toBe('loaded');
    expect(state.translations.en?.common).toEqual({
      welcome: 'Welcome {name}',
      fallbackOnly: 'English Fallback',
    });
    expect(mockLoader).toHaveBeenCalledWith('en', 'common', { version: undefined });
  });

  it('shares active loading promises to prevent redundant requests', () => {
    const store = createLinguiniStore(config);
    
    const p1 = store.loadNamespace('en', 'common');
    const p2 = store.loadNamespace('en', 'common');
    
    expect(p1).toBe(p2); // Same promise instance
  });

  it('handles loader errors', async () => {
    const store = createLinguiniStore(config);
    
    await expect(store.loadNamespace('en', 'unknown')).rejects.toThrow();
    expect(store.getState().loadingStates.en?.unknown).toBe('error');
  });

  it('translates values with fallback resolving', async () => {
    const store = createLinguiniStore(config);
    store.setLanguage('fr');
    
    // Load en and fr namespaces
    await store.loadNamespace('fr', 'common');
    await store.loadNamespace('en', 'common');

    // 1. Exact translation in active language (fr)
    expect(store.translate('common', 'welcome', { name: 'Lucas' })).toBe('Bienvenue Lucas');

    // 2. Fallback translation in default language (en) since 'fallbackOnly' is missing in 'fr'
    expect(store.translate('common', 'fallbackOnly')).toBe('English Fallback');

    // 3. Key formatting when translation is missing in both
    expect(store.translate('common', 'missing')).toBe('common:missing');
  });

  it('refreshes namespace and triggers loader with version options', async () => {
    const store = createLinguiniStore(config);
    store.setLanguage('fr');

    await store.loadNamespace('fr', 'common');
    await store.loadNamespace('en', 'common'); // default/fallback loaded as well
    
    mockLoader.mockClear();

    // Trigger refresh
    await store.refreshNamespace('common', { version: 'v2' });

    // Ensure it re-loaded BOTH the active ('fr') and the loaded default ('en')
    expect(mockLoader).toHaveBeenCalledTimes(2);
    expect(mockLoader).toHaveBeenCalledWith('fr', 'common', { version: 'v2' });
    expect(mockLoader).toHaveBeenCalledWith('en', 'common', { version: 'v2' });
  });

  it('respects namespace-specific versions in config', async () => {
    config.versions = { common: '2.5.1' };
    const store = createLinguiniStore(config);

    await store.loadNamespace('en', 'common');
    expect(mockLoader).toHaveBeenCalledWith('en', 'common', { version: '2.5.1' });
  });

  describe('partial namespace loading', () => {
    it('ignores keyPrefix on non-partial namespaces and loads the full namespace', async () => {
      const store = createLinguiniStore(config);
      await store.loadNamespace('en', 'common', { keyPrefix: 'welcome' });

      expect(mockLoader).toHaveBeenCalledTimes(1);
      expect(mockLoader).toHaveBeenCalledWith('en', 'common', { version: undefined });
      expect(store.getState().loadingStates.en?.common).toBe('loaded');
    });

    it('batches concurrent partial loads within the same microtask into one loader call', async () => {
      const partialLoader = vi.fn().mockImplementation(async (lang, ns, options) => {
        expect(lang).toBe('en');
        expect(ns).toBe('dashboard');
        expect(options?.keyPrefixes).toEqual(['header', 'settings']);
        return {
          header: { title: 'Dashboard' },
          settings: { theme: 'Dark' },
        };
      });

      const store = createLinguiniStore({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        namespaces: {
          dashboard: { partial: true },
        },
        loader: partialLoader,
      });

      const p1 = store.loadNamespace('en', 'dashboard', { keyPrefix: 'header' });
      const p2 = store.loadNamespace('en', 'dashboard', { keyPrefix: 'settings' });
      const p3 = store.loadNamespace('en', 'dashboard', { keyPrefix: 'header' });

      expect(store.getState().partialLoadingStates.en?.dashboard?.header).toBe('loading');
      expect(store.getState().partialLoadingStates.en?.dashboard?.settings).toBe('loading');

      await Promise.all([p1, p2, p3]);

      expect(partialLoader).toHaveBeenCalledTimes(1);
      expect(store.getState().partialLoadingStates.en?.dashboard?.header).toBe('loaded');
      expect(store.getState().partialLoadingStates.en?.dashboard?.settings).toBe('loaded');
      expect(store.translate('dashboard', 'header.title')).toBe('Dashboard');
      expect(store.translate('dashboard', 'settings.theme')).toBe('Dark');
    });

    it('deduplicates already-loaded prefixes and short-circuits if full namespace is loaded', async () => {
      const partialLoader = vi.fn().mockImplementation(async (_lang, _ns, options) => {
        if (options?.keyPrefixes) {
          return { header: { title: 'Header' } };
        }
        return { header: { title: 'Full Header' }, sidebar: { home: 'Home' } };
      });

      const store = createLinguiniStore({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        namespaces: { dashboard: { partial: true } },
        loader: partialLoader,
      });

      await store.loadNamespace('en', 'dashboard', { keyPrefix: 'header' });
      await store.loadNamespace('en', 'dashboard', { keyPrefix: 'header' });
      expect(partialLoader).toHaveBeenCalledTimes(1);

      // Load full namespace
      await store.loadNamespace('en', 'dashboard');
      expect(partialLoader).toHaveBeenCalledTimes(2);
      expect(store.getState().loadingStates.en?.dashboard).toBe('loaded');

      // Subsequent partial prefix should resolve without calling loader
      await store.loadNamespace('en', 'dashboard', { keyPrefix: 'sidebar' });
      expect(partialLoader).toHaveBeenCalledTimes(2);
      expect(store.translate('dashboard', 'sidebar.home')).toBe('Home');
    });

    it('supports partialMergeStrategy "root" (deep merge) and "subtree"', async () => {
      // 1. 'root' strategy (default)
      const rootLoader = vi
        .fn()
        .mockResolvedValueOnce({ settings: { theme: 'Dark' } })
        .mockResolvedValueOnce({ settings: { language: 'English' } });

      const rootStore = createLinguiniStore({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        namespaces: { dashboard: { partial: true } },
        loader: rootLoader,
      });

      await rootStore.loadNamespace('en', 'dashboard', { keyPrefix: 'settings.theme' });
      await rootStore.loadNamespace('en', 'dashboard', { keyPrefix: 'settings.language' });

      expect(rootStore.getState().translations.en?.dashboard).toEqual({
        settings: { theme: 'Dark', language: 'English' },
      });

      // 2. 'subtree' strategy (per-namespace overrides global)
      const subtreeLoader = vi.fn().mockImplementation(async (_lang, _ns, options) => {
        const result: Record<string, any> = {};
        for (const prefix of options?.keyPrefixes || []) {
          if (prefix === 'header') result[prefix] = { title: 'Subtree Title' };
          if (prefix === 'user.profile') result[prefix] = { name: 'Alice' };
        }
        return result;
      });

      const subtreeStore = createLinguiniStore({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        partialMergeStrategy: 'root',
        namespaces: {
          dashboard: { partial: true, partialMergeStrategy: 'subtree' },
        },
        loader: subtreeLoader,
      });

      await Promise.all([
        subtreeStore.loadNamespace('en', 'dashboard', { keyPrefix: 'header' }),
        subtreeStore.loadNamespace('en', 'dashboard', { keyPrefix: 'user.profile' }),
      ]);

      expect(subtreeStore.getState().translations.en?.dashboard).toEqual({
        header: { title: 'Subtree Title' },
        user: { profile: { name: 'Alice' } },
      });
      expect(subtreeStore.translate('dashboard', 'user.profile.name')).toBe('Alice');
    });

    it('marks batched prefixes as error and rejects callers when loader fails', async () => {
      const failingLoader = vi.fn().mockRejectedValue(new Error('Network error'));
      const store = createLinguiniStore({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        namespaces: { dashboard: { partial: true } },
        loader: failingLoader,
      });

      const p1 = store.loadNamespace('en', 'dashboard', { keyPrefix: 'header' });
      const p2 = store.loadNamespace('en', 'dashboard', { keyPrefix: 'footer' });

      await expect(p1).rejects.toThrow('Network error');
      await expect(p2).rejects.toThrow('Network error');
      expect(store.getState().partialLoadingStates.en?.dashboard?.header).toBe('error');
      expect(store.getState().partialLoadingStates.en?.dashboard?.footer).toBe('error');
    });

    it('refreshes explicit or previously loaded partial prefixes and respects version precedence', async () => {
      const partialLoader = vi.fn().mockImplementation(async (lang, _ns, options) => {
        if (options?.keyPrefixes?.includes('header')) {
          return { header: { title: `${lang}-v${options.version}` } };
        }
        return { footer: { copy: `${lang}-footer-v${options?.version}` } };
      });

      const store = createLinguiniStore({
        supportedLanguages: ['en', 'fr'],
        defaultLanguage: 'en',
        defaultVersion: '1.0.0',
        versions: { dashboard: '1.1.0' },
        namespaces: {
          dashboard: { partial: true, version: '2.0.0' },
        },
        loader: partialLoader,
      });
      store.setLanguage('fr');

      await Promise.all([
        store.loadNamespace('fr', 'dashboard', { keyPrefix: 'header' }),
        store.loadNamespace('en', 'dashboard', { keyPrefix: 'header' }),
      ]);
      expect(partialLoader).toHaveBeenCalledWith('fr', 'dashboard', {
        version: '2.0.0',
        keyPrefixes: ['header'],
      });

      partialLoader.mockClear();

      // Refresh without explicit keyPrefix refreshes tracked partial prefixes
      await store.refreshNamespace('dashboard', { version: '3.0.0' });
      expect(partialLoader).toHaveBeenCalledTimes(2);
      expect(partialLoader).toHaveBeenCalledWith('fr', 'dashboard', {
        version: '3.0.0',
        keyPrefixes: ['header'],
      });
      expect(partialLoader).toHaveBeenCalledWith('en', 'dashboard', {
        version: '3.0.0',
        keyPrefixes: ['header'],
      });
      expect(store.translate('dashboard', 'header.title')).toBe('fr-v3.0.0');

      partialLoader.mockClear();

      // Refresh with explicit keyPrefix
      await store.refreshNamespace('dashboard', { keyPrefix: 'footer', version: '4.0.0' });
      expect(partialLoader).toHaveBeenCalledWith('fr', 'dashboard', {
        version: '4.0.0',
        keyPrefixes: ['footer'],
      });
      expect(store.translate('dashboard', 'footer.copy')).toBe('fr-footer-v4.0.0');
    });
  });

  describe('per-namespace loaders', () => {
    it('uses namespace-specific loader instead of global loader for full and partial loads', async () => {
      const globalLoader = vi.fn().mockResolvedValue({ from: 'global' });
      const catalogLoader = vi.fn().mockResolvedValue({ item: 'Widget' });
      const dashboardLoader = vi.fn().mockResolvedValue({ header: { title: 'Dash' } });

      const store = createLinguiniStore({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        loader: globalLoader,
        namespaces: {
          catalog: { loader: catalogLoader },
          dashboard: { partial: true, loader: dashboardLoader },
        },
      });

      await store.loadNamespace('en', 'common');
      await store.loadNamespace('en', 'catalog');
      await store.loadNamespace('en', 'dashboard', { keyPrefix: 'header' });

      expect(globalLoader).toHaveBeenCalledTimes(1);
      expect(globalLoader).toHaveBeenCalledWith('en', 'common', { version: undefined });
      expect(catalogLoader).toHaveBeenCalledWith('en', 'catalog', { version: undefined });
      expect(dashboardLoader).toHaveBeenCalledWith('en', 'dashboard', {
        version: undefined,
        keyPrefixes: ['header'],
      });
      expect(store.translate('catalog', 'item')).toBe('Widget');
      expect(store.translate('dashboard', 'header.title')).toBe('Dash');
    });

    it('works without a global loader when namespace defines its own loader', async () => {
      const authLoader = vi.fn().mockResolvedValue({ login: 'Sign In' });
      const store = createLinguiniStore({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        namespaces: {
          auth: { loader: authLoader },
        },
      });

      await store.loadNamespace('en', 'auth');
      expect(authLoader).toHaveBeenCalledWith('en', 'auth', { version: undefined });
      expect(store.translate('auth', 'login')).toBe('Sign In');
    });

    it('rejects and sets error status when neither namespace nor global loader is configured', async () => {
      const store = createLinguiniStore({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        namespaces: {
          dashboard: { partial: true },
        },
      });

      await expect(store.loadNamespace('en', 'common')).rejects.toThrow(
        'Linguini: No loader configured for namespace "common"'
      );
      expect(store.getState().loadingStates.en?.common).toBe('error');

      await expect(
        store.loadNamespace('en', 'dashboard', { keyPrefix: 'header' })
      ).rejects.toThrow('Linguini: No loader configured for namespace "dashboard"');
      expect(store.getState().partialLoadingStates.en?.dashboard?.header).toBe('error');
    });
  });
});
