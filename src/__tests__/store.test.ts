import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLinguiniStore } from '../store';
import { LinguiniConfig } from '../types';

describe('LinguiniStore', () => {
  let mockLoader: any;
  let config: LinguiniConfig;

  beforeEach(() => {
    mockLoader = vi.fn().mockImplementation(async (lang, ns, _options) => {
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
    globalThis.navigator = { languages: ['fr-FR'] };
    
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

  describe('version-aware loading and setVersions', () => {
    it('refetches when version changes, deduplicates matching versions, and prevents stale overwrites', async () => {
      let resolveV1!: (data: Record<string, any>) => void;
      let resolveV2!: (data: Record<string, any>) => void;

      const versionedLoader = vi.fn().mockImplementation((_lang, _ns, options) => {
        if (options?.version === '1.0.0') {
          return new Promise<Record<string, any>>((res) => {
            resolveV1 = res;
          });
        }
        if (options?.version === '2.0.0') {
          return new Promise<Record<string, any>>((res) => {
            resolveV2 = res;
          });
        }
        return Promise.resolve({ title: `v-${options?.version}` });
      });

      const store = createLinguiniStore({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        versions: { common: '1.0.0' },
        loader: versionedLoader,
      });

      const p1 = store.loadNamespace('en', 'common');
      const p1Dup = store.loadNamespace('en', 'common');
      expect(p1).toBe(p1Dup);

      // Bump version while v1 is still in flight
      store.setVersions({ common: '2.0.0' });
      const p2 = store.loadNamespace('en', 'common');
      expect(p2).not.toBe(p1);
      expect(versionedLoader).toHaveBeenCalledTimes(2);

      // Resolve v2 first, then v1 out-of-order
      resolveV2({ title: 'Title v2' });
      await p2;
      expect(store.getState().translations.en?.common).toEqual({ title: 'Title v2' });
      expect(store.getState().versions.en?.common).toBe('2.0.0');

      resolveV1({ title: 'Stale v1' });
      await p1;
      // Stale v1 must not overwrite newer v2
      expect(store.getState().translations.en?.common).toEqual({ title: 'Title v2' });
      expect(store.getState().versions.en?.common).toBe('2.0.0');

      // Calling loadNamespace again at v2 is a no-op
      await store.loadNamespace('en', 'common');
      expect(versionedLoader).toHaveBeenCalledTimes(2);
    });

    it('tracks partial prefix versions and supports setVersions merge & replace without clearing translations', async () => {
      const partialLoader = vi.fn().mockImplementation(async (_lang, _ns, options) => {
        const out: Record<string, any> = {};
        for (const prefix of options?.keyPrefixes || []) {
          out[prefix] = { label: `${prefix}@${options?.version}` };
        }
        return out;
      });

      const store = createLinguiniStore({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        namespaces: {
          dashboard: { partial: true, partialMergeStrategy: 'subtree' },
        },
        loader: partialLoader,
      });

      store.setVersions({ dashboard: '1.0' });
      await store.loadNamespace('en', 'dashboard', { keyPrefix: 'row1' });
      expect(store.translate('dashboard', 'row1.label')).toBe('row1@1.0');
      expect(store.getState().partialVersions.en?.dashboard?.row1).toBe('1.0');

      // Same version -> deduplicated
      await store.loadNamespace('en', 'dashboard', { keyPrefix: 'row1' });
      expect(partialLoader).toHaveBeenCalledTimes(1);

      // No-op setVersions does not notify listeners
      const listener = vi.fn();
      const unsub = store.subscribe(listener);
      store.setVersions({ dashboard: '1.0' });
      expect(listener).not.toHaveBeenCalled();

      // Update version -> preserves old translation until refetched
      store.setVersions({ dashboard: '2.0', other: '3.0' });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(store.translate('dashboard', 'row1.label')).toBe('row1@1.0');

      await store.loadNamespace('en', 'dashboard', { keyPrefix: 'row1' });
      expect(partialLoader).toHaveBeenCalledTimes(2);
      expect(store.translate('dashboard', 'row1.label')).toBe('row1@2.0');
      expect(store.getState().partialVersions.en?.dashboard?.row1).toBe('2.0');

      // Replace option drops omitted keys
      store.setVersions({ other: '4.0' }, { replace: true });
      expect(store.getState().targetVersions).toEqual({ other: '4.0' });
      unsub();
    });
  });

  describe('defaultValue and missingKeyFallback', () => {
    it('supports string and object defaultValue with interpolation and missingKeyFallback', async () => {
      const store = createLinguiniStore({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        missingKeyFallback: (ns, key) => `[${ns}/${key}]`,
        loader: async () => ({ existing: 'Found {name}' }),
      });

      await store.loadNamespace('en', 'common');

      expect(store.translate('common', 'existing', 'Fallback', { name: 'Ada' })).toBe('Found Ada');
      expect(store.translate('common', 'missing', 'Default Text')).toBe('Default Text');
      expect(store.translate('common', 'missing', 'Hello {name}', { name: 'Bob' })).toBe('Hello Bob');
      expect(store.translate('common', 'missing', { defaultValue: 'From opts {n}', n: 5 })).toBe('From opts 5');
      expect(store.translate('common', 'missing', '')).toBe('');
      expect(store.translate('common', 'missing')).toBe('[common/missing]');

      const emptyFallbackStore = createLinguiniStore({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        missingKeyFallback: '',
        loader: async () => ({}),
      });
      expect(emptyFallbackStore.translate('common', 'nope')).toBe('');
    });
  });

  describe('retry configuration', () => {
    it('retries transient failures for full and partial loads and respects retryDelay', async () => {
      let fullAttempts = 0;
      const fullLoader = vi.fn().mockImplementation(async () => {
        fullAttempts++;
        if (fullAttempts < 3) {
          throw new Error(`Transient ${fullAttempts}`);
        }
        return { ok: 'Recovered' };
      });

      let partialAttempts = 0;
      const partialLoader = vi.fn().mockImplementation(async () => {
        partialAttempts++;
        if (partialAttempts < 2) {
          throw new Error('Partial transient');
        }
        return { card: { title: 'Partial OK' } };
      });

      const delayFn = vi.fn().mockReturnValue(0);

      const store = createLinguiniStore({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        retry: { maxRetries: 2, retryDelay: delayFn },
        namespaces: {
          common: { loader: fullLoader },
          dashboard: {
            partial: true,
            loader: partialLoader,
            retry: { maxRetries: 1, retryDelay: 0 },
          },
          alwaysFails: {
            loader: vi.fn().mockRejectedValue(new Error('Permanent')),
            retry: { maxRetries: 2, retryDelay: 0 },
          },
        },
      });

      await store.loadNamespace('en', 'common');
      expect(fullAttempts).toBe(3);
      expect(delayFn).toHaveBeenCalledTimes(2);
      expect(store.translate('common', 'ok')).toBe('Recovered');

      await store.loadNamespace('en', 'dashboard', { keyPrefix: 'card' });
      expect(partialAttempts).toBe(2);
      expect(store.translate('dashboard', 'card.title')).toBe('Partial OK');

      await expect(store.loadNamespace('en', 'alwaysFails')).rejects.toThrow('Permanent');
      expect(store.getState().loadingStates.en?.alwaysFails).toBe('error');
    });

    it('does not retry when no loader is configured', async () => {
      const store = createLinguiniStore({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        retry: { maxRetries: 3, retryDelay: 0 },
      });

      await expect(store.loadNamespace('en', 'missingLoader')).rejects.toThrow(
        'Linguini: No loader configured for namespace "missingLoader"'
      );
      expect(store.getState().loadingStates.en?.missingLoader).toBe('error');
    });

    it('respects shouldRetry predicate (e.g. skips 404 while retrying 500)', async () => {
      const shouldRetry = vi.fn((err: unknown) => {
        return (err as { status?: number })?.status !== 404;
      });

      const notFoundLoader = vi.fn().mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
      let serverAttempts = 0;
      const serverErrLoader = vi.fn().mockImplementation(async () => {
        serverAttempts++;
        if (serverAttempts < 2) {
          throw Object.assign(new Error('Server Error'), { status: 500 });
        }
        return { msg: 'Recovered 500' };
      });

      const store = createLinguiniStore({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        retry: { maxRetries: 3, retryDelay: 0, shouldRetry },
        namespaces: {
          notFound: { loader: notFoundLoader },
          transient500: { loader: serverErrLoader },
        },
      });

      await expect(store.loadNamespace('en', 'notFound')).rejects.toThrow('Not Found');
      expect(notFoundLoader).toHaveBeenCalledTimes(1);
      expect(shouldRetry).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }), 1);

      await store.loadNamespace('en', 'transient500');
      expect(serverErrLoader).toHaveBeenCalledTimes(2);
      expect(store.translate('transient500', 'msg')).toBe('Recovered 500');
    });
  });

  describe('root partial merge stale-response protection', () => {
    it('prevents an older out-of-order root batch from overwriting newer prefixes', async () => {
      let resolveV1!: (data: Record<string, any>) => void;
      let resolveV2!: (data: Record<string, any>) => void;

      const rootLoader = vi.fn().mockImplementation((_lang, _ns, options) => {
        if (options?.version === 'v1') {
          return new Promise<Record<string, any>>((res) => {
            resolveV1 = res;
          });
        }
        return new Promise<Record<string, any>>((res) => {
          resolveV2 = res;
        });
      });

      const store = createLinguiniStore({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        versions: { rootNs: 'v1' },
        namespaces: {
          rootNs: { partial: true, partialMergeStrategy: 'root' },
        },
        loader: rootLoader,
      });

      const p1a = store.loadNamespace('en', 'rootNs', { keyPrefix: 'a' });
      const p1b = store.loadNamespace('en', 'rootNs', { keyPrefix: 'b' });
      const p1Theme = store.loadNamespace('en', 'rootNs', { keyPrefix: 'settings.theme' });
      const p1Lang = store.loadNamespace('en', 'rootNs', { keyPrefix: 'settings.lang' });

      // Allow batch 1 microtask to flush so loader is in flight
      await Promise.resolve();

      // Bump version and request only 'a' and 'settings.theme' at v2
      store.setVersions({ rootNs: 'v2' });
      const p2a = store.loadNamespace('en', 'rootNs', { keyPrefix: 'a' });
      const p2Theme = store.loadNamespace('en', 'rootNs', { keyPrefix: 'settings.theme' });
      await Promise.resolve();

      // Batch 2 resolves first
      resolveV2({
        a: { text: 'a-v2' },
        settings: { theme: 'dark-v2' },
      });
      await Promise.all([p2a, p2Theme]);

      expect(store.translate('rootNs', 'a.text')).toBe('a-v2');
      expect(store.translate('rootNs', 'settings.theme')).toBe('dark-v2');

      // Batch 1 resolves last (out-of-order)
      resolveV1({
        a: { text: 'a-v1' },
        b: { text: 'b-v1' },
        settings: { theme: 'light-v1', lang: 'en-v1' },
      });
      await Promise.all([p1a, p1b, p1Theme, p1Lang]);

      // Newer v2 prefixes stay intact; non-superseded v1 prefixes are merged
      expect(store.translate('rootNs', 'a.text')).toBe('a-v2');
      expect(store.translate('rootNs', 'settings.theme')).toBe('dark-v2');
      expect(store.translate('rootNs', 'b.text')).toBe('b-v1');
      expect(store.translate('rootNs', 'settings.lang')).toBe('en-v1');

      expect(store.getState().partialVersions.en?.rootNs?.a).toBe('v2');
      expect(store.getState().partialVersions.en?.rootNs?.['settings.theme']).toBe('v2');
      expect(store.getState().partialVersions.en?.rootNs?.b).toBe('v1');
      expect(store.getState().partialVersions.en?.rootNs?.['settings.lang']).toBe('v1');
    });
  });
});
