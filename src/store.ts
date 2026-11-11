import { LinguiniConfig, LinguiniState, LinguiniStore, NamespaceLoadingStatus } from './types';
import { getNestedValue, interpolate, detectBrowserLanguage } from './utils';

export function createLinguiniStore(config: LinguiniConfig): LinguiniStore {
  // Determine initial language: use detected browser language or default
  const initialLang = detectBrowserLanguage(config.supportedLanguages, config.defaultLanguage);

  let state: LinguiniState = {
    language: initialLang,
    translations: {},
    loadingStates: {},
    versions: {},
  };

  const listeners = new Set<() => void>();
  const activePromises = new Map<string, Promise<void>>(); // key: "lang:ns"

  function updateState(newState: Partial<LinguiniState>) {
    state = { ...state, ...newState };
    listeners.forEach((listener) => listener());
  }

  function updateLoadingState(lang: string, ns: string, status: NamespaceLoadingStatus) {
    const langStates = state.loadingStates[lang] || {};
    updateState({
      loadingStates: {
        ...state.loadingStates,
        [lang]: {
          ...langStates,
          [ns]: status,
        },
      },
    });
  }

  const store: LinguiniStore = {
    config,
    
    getState() {
      return state;
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setLanguage(lang: string) {
      if (state.language === lang) return;
      if (!config.supportedLanguages.includes(lang)) {
        console.warn(`Linguini: language "${lang}" is not in supportedLanguages list.`);
      }
      updateState({ language: lang });
    },

    loadNamespace(lang: string, ns: string, options?: { version?: string; forceRefresh?: boolean }): Promise<void> {
      const key = `${lang}:${ns}`;
      const force = options?.forceRefresh;
      const status = state.loadingStates[lang]?.[ns] || 'idle';

      if (status === 'loaded' && !force) {
        return Promise.resolve();
      }

      const existingPromise = activePromises.get(key);
      if (existingPromise && !force) {
        return existingPromise;
      }

      const promise = (async () => {
        updateLoadingState(lang, ns, 'loading');
        try {
          const version = options?.version || config.versions?.[ns] || config.defaultVersion;
          const data = await config.loader(lang, ns, { version });
          
          updateState({
            translations: {
              ...state.translations,
              [lang]: {
                ...(state.translations[lang] || {}),
                [ns]: data,
              },
            },
            loadingStates: {
              ...state.loadingStates,
              [lang]: {
                ...(state.loadingStates[lang] || {}),
                [ns]: 'loaded',
              },
            },
            versions: {
              ...state.versions,
              [lang]: {
                ...(state.versions[lang] || {}),
                [ns]: version || '',
              },
            },
          });
        } catch (error) {
          updateLoadingState(lang, ns, 'error');
          throw error;
        } finally {
          activePromises.delete(key);
        }
      })();

      activePromises.set(key, promise);
      return promise;
    },

    async refreshNamespace(ns: string, options?: { version?: string }) {
      const activeLang = state.language;
      const defaultLang = config.defaultLanguage;
      const fallbackLang = config.fallbackLanguage;

      const promises: Promise<any>[] = [];

      // 1. Refresh active language
      promises.push(
        store.loadNamespace(activeLang, ns, {
          version: options?.version,
          forceRefresh: true,
        }).catch((err) => {
          console.error(`Linguini: Failed to refresh namespace "${ns}" for language "${activeLang}"`, err);
        })
      );

      // 2. Refresh default language (if loaded/loading and different from active)
      if (defaultLang !== activeLang && state.loadingStates[defaultLang]?.[ns]) {
        promises.push(
          store.loadNamespace(defaultLang, ns, {
            version: options?.version,
            forceRefresh: true,
          }).catch((err) => {
            console.error(`Linguini: Failed to refresh fallback namespace "${ns}" for default language "${defaultLang}"`, err);
          })
        );
      }

      // 3. Refresh fallback language (if loaded/loading and different from active & default)
      if (fallbackLang && fallbackLang !== activeLang && fallbackLang !== defaultLang && state.loadingStates[fallbackLang]?.[ns]) {
        promises.push(
          store.loadNamespace(fallbackLang, ns, {
            version: options?.version,
            forceRefresh: true,
          }).catch((err) => {
            console.error(`Linguini: Failed to refresh fallback namespace "${ns}" for language "${fallbackLang}"`, err);
          })
        );
      }

      await Promise.all(promises);
    },

    translate(ns: string, key: string, params?: Record<string, any>): string {
      const activeLang = state.language;
      const defaultLang = config.defaultLanguage;
      const fallbackLang = config.fallbackLanguage;

      // Try 1: Active Language
      let val = getNestedValue(state.translations[activeLang]?.[ns], key);

      // Try 2: Default Language
      if (val === undefined && activeLang !== defaultLang) {
        val = getNestedValue(state.translations[defaultLang]?.[ns], key);
      }

      // Try 3: Fallback Language
      if (val === undefined && fallbackLang && activeLang !== fallbackLang && defaultLang !== fallbackLang) {
        val = getNestedValue(state.translations[fallbackLang]?.[ns], key);
      }

      // If not found, return missing key format
      if (val === undefined) {
        return `${ns}:${key}`;
      }

      return interpolate(val, params);
    },
  };

  return store;
}
