import {
  LinguiniConfig,
  LinguiniState,
  LinguiniStore,
  LoadNamespaceOptions,
  NamespaceLoadingStatus,
  RefreshNamespaceOptions,
} from './types';
import { getNestedValue, interpolate, detectBrowserLanguage, deepMerge, setNestedValue } from './utils';

interface PendingBatch {
  lang: string;
  ns: string;
  version: string | undefined;
  prefixes: Set<string>;
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: any) => void;
}

export function createLinguiniStore(config: LinguiniConfig<any>): LinguiniStore {
  // Determine initial language: use detected browser language or default
  const initialLang = detectBrowserLanguage(config.supportedLanguages, config.defaultLanguage);

  let state: LinguiniState = {
    language: initialLang,
    translations: {},
    loadingStates: {},
    partialLoadingStates: {},
    versions: {},
  };

  const listeners = new Set<() => void>();
  const activePromises = new Map<string, Promise<void>>(); // key: "lang:ns"
  const activePartialPromises = new Map<string, Promise<void>>(); // key: "lang\0ns\0prefix"
  const pendingBatches = new Map<string, PendingBatch>(); // key: "lang\0ns\0version"

  function updateState(newState: Partial<LinguiniState>) {
    state = { ...state, ...newState };
    listeners.forEach((listener) => listener());
  }

  function resolveVersion(ns: string, overrideVersion?: string): string | undefined {
    return overrideVersion ?? config.namespaces?.[ns]?.version ?? config.versions?.[ns] ?? config.defaultVersion;
  }

  function resolveLoader(ns: string) {
    const loader = config.namespaces?.[ns]?.loader ?? config.loader;
    if (!loader) {
      throw new Error(`Linguini: No loader configured for namespace "${ns}"`);
    }
    return loader;
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

  function updatePartialLoadingStates(
    lang: string,
    ns: string,
    prefixes: string[],
    status: NamespaceLoadingStatus
  ) {
    if (prefixes.length === 0) return;
    const langPartialStates = state.partialLoadingStates[lang] || {};
    const nsPartialStates = { ...(langPartialStates[ns] || {}) };
    for (const prefix of prefixes) {
      nsPartialStates[prefix] = status;
    }
    updateState({
      partialLoadingStates: {
        ...state.partialLoadingStates,
        [lang]: {
          ...langPartialStates,
          [ns]: nsPartialStates,
        },
      },
    });
  }

  async function flushBatch(bucketKey: string) {
    const batch = pendingBatches.get(bucketKey);
    if (!batch) return;
    pendingBatches.delete(bucketKey);

    const { lang, ns, version, prefixes, promise, resolve, reject } = batch;
    const keyPrefixes = Array.from(prefixes);

    try {
      const loader = resolveLoader(ns);
      const data = await loader(lang, ns, { version, keyPrefixes });
      const strategy =
        config.namespaces?.[ns]?.partialMergeStrategy ??
        config.partialMergeStrategy ??
        'root';

      let mergedTranslations: Record<string, any>;
      if (strategy === 'subtree') {
        mergedTranslations = state.translations[lang]?.[ns] || {};
        for (const [prefix, val] of Object.entries(data || {})) {
          mergedTranslations = setNestedValue(mergedTranslations, prefix, val);
        }
      } else {
        mergedTranslations = deepMerge(state.translations[lang]?.[ns], data || {});
      }

      const langPartialStates = state.partialLoadingStates[lang] || {};
      const nsPartialStates = { ...(langPartialStates[ns] || {}) };
      for (const prefix of keyPrefixes) {
        nsPartialStates[prefix] = 'loaded';
      }

      updateState({
        translations: {
          ...state.translations,
          [lang]: {
            ...(state.translations[lang] || {}),
            [ns]: mergedTranslations,
          },
        },
        partialLoadingStates: {
          ...state.partialLoadingStates,
          [lang]: {
            ...langPartialStates,
            [ns]: nsPartialStates,
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

      for (const prefix of keyPrefixes) {
        const prefixKey = `${lang}\0${ns}\0${prefix}`;
        if (activePartialPromises.get(prefixKey) === promise) {
          activePartialPromises.delete(prefixKey);
        }
      }
      resolve();
    } catch (error) {
      updatePartialLoadingStates(lang, ns, keyPrefixes, 'error');
      for (const prefix of keyPrefixes) {
        const prefixKey = `${lang}\0${ns}\0${prefix}`;
        if (activePartialPromises.get(prefixKey) === promise) {
          activePartialPromises.delete(prefixKey);
        }
      }
      reject(error);
    }
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

    loadNamespace(lang: string, ns: string, options?: LoadNamespaceOptions): Promise<void> {
      const requestedPrefixesSet = new Set<string>();
      if (options?.keyPrefixes) {
        for (const p of options.keyPrefixes) {
          if (p) requestedPrefixesSet.add(p);
        }
      }
      if (options?.keyPrefix) {
        requestedPrefixesSet.add(options.keyPrefix);
      }
      const requestedPrefixes = Array.from(requestedPrefixesSet);
      const isPartial = Boolean(config.namespaces?.[ns]?.partial && requestedPrefixes.length > 0);
      const force = options?.forceRefresh;

      if (!isPartial) {
        const key = `${lang}:${ns}`;
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
            const version = resolveVersion(ns, options?.version);
            const loader = resolveLoader(ns);
            const data = await loader(lang, ns, { version });
            
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
      }

      // Partial load path
      if (!force && state.loadingStates[lang]?.[ns] === 'loaded') {
        return Promise.resolve();
      }

      const nsPartialStates = state.partialLoadingStates[lang]?.[ns];
      const pendingPrefixes = force
        ? requestedPrefixes
        : requestedPrefixes.filter((prefix) => nsPartialStates?.[prefix] !== 'loaded');

      if (pendingPrefixes.length === 0) {
        return Promise.resolve();
      }

      const existingPromises: Promise<void>[] = [];
      const seenExisting = new Set<Promise<void>>();
      const toQueue: string[] = [];

      for (const prefix of pendingPrefixes) {
        const prefixKey = `${lang}\0${ns}\0${prefix}`;
        const inFlight = !force ? activePartialPromises.get(prefixKey) : undefined;
        if (inFlight) {
          if (!seenExisting.has(inFlight)) {
            seenExisting.add(inFlight);
            existingPromises.push(inFlight);
          }
        } else {
          toQueue.push(prefix);
        }
      }

      if (toQueue.length === 0) {
        return existingPromises.length === 1
          ? existingPromises[0]
          : Promise.all(existingPromises).then(() => {});
      }

      updatePartialLoadingStates(lang, ns, toQueue, 'loading');

      const version = resolveVersion(ns, options?.version);
      const bucketKey = `${lang}\0${ns}\0${version ?? ''}`;
      let batch = pendingBatches.get(bucketKey);

      if (!batch) {
        let resolve!: () => void;
        let reject!: (err: any) => void;
        const promise = new Promise<void>((res, rej) => {
          resolve = res;
          reject = rej;
        });

        batch = {
          lang,
          ns,
          version,
          prefixes: new Set<string>(),
          promise,
          resolve,
          reject,
        };
        pendingBatches.set(bucketKey, batch);
        queueMicrotask(() => {
          void flushBatch(bucketKey);
        });
      }

      for (const prefix of toQueue) {
        batch.prefixes.add(prefix);
        activePartialPromises.set(`${lang}\0${ns}\0${prefix}`, batch.promise);
      }

      if (existingPromises.length === 0) {
        return batch.promise;
      }
      return Promise.all([...existingPromises, batch.promise]).then(() => {});
    },

    async refreshNamespace(ns: string, options?: RefreshNamespaceOptions) {
      const activeLang = state.language;
      const defaultLang = config.defaultLanguage;
      const fallbackLang = config.fallbackLanguage;

      const hasExplicitPrefixes = Boolean(
        options?.keyPrefix || (options?.keyPrefixes && options.keyPrefixes.length > 0)
      );
      const isPartialNs = Boolean(config.namespaces?.[ns]?.partial);

      const getRefreshOptions = (lang: string): LoadNamespaceOptions => {
        if (hasExplicitPrefixes) {
          return {
            version: options?.version,
            forceRefresh: true,
            keyPrefix: options?.keyPrefix,
            keyPrefixes: options?.keyPrefixes,
          };
        }

        if (isPartialNs && state.loadingStates[lang]?.[ns] !== 'loaded') {
          const loadedPrefixes = Object.keys(state.partialLoadingStates[lang]?.[ns] || {});
          if (loadedPrefixes.length > 0) {
            return {
              version: options?.version,
              forceRefresh: true,
              keyPrefixes: loadedPrefixes,
            };
          }
        }

        return {
          version: options?.version,
          forceRefresh: true,
        };
      };

      const isLangTracked = (lang: string) =>
        Boolean(
          state.loadingStates[lang]?.[ns] ||
            (state.partialLoadingStates[lang]?.[ns] &&
              Object.keys(state.partialLoadingStates[lang][ns]).length > 0)
        );

      const promises: Promise<any>[] = [];

      // 1. Refresh active language
      promises.push(
        store.loadNamespace(activeLang, ns, getRefreshOptions(activeLang)).catch((err) => {
          console.error(`Linguini: Failed to refresh namespace "${ns}" for language "${activeLang}"`, err);
        })
      );

      // 2. Refresh default language (if loaded/loading and different from active)
      if (defaultLang !== activeLang && isLangTracked(defaultLang)) {
        promises.push(
          store.loadNamespace(defaultLang, ns, getRefreshOptions(defaultLang)).catch((err) => {
            console.error(`Linguini: Failed to refresh fallback namespace "${ns}" for default language "${defaultLang}"`, err);
          })
        );
      }

      // 3. Refresh fallback language (if loaded/loading and different from active & default)
      if (fallbackLang && fallbackLang !== activeLang && fallbackLang !== defaultLang && isLangTracked(fallbackLang)) {
        promises.push(
          store.loadNamespace(fallbackLang, ns, getRefreshOptions(fallbackLang)).catch((err) => {
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
