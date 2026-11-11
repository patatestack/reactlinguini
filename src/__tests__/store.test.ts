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
});
