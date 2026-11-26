import {
  LinguiniConfig,
  LinguiniLoader,
  LinguiniState,
  LinguiniStore,
  LoadNamespaceOptions,
  NamespaceLoadingStatus,
  RefreshNamespaceOptions,
  RetryConfig,
  SetVersionsOptions,
  TranslateParams,
} from './types';
import {
  getNestedValue,
  interpolate,
  detectBrowserLanguage,
  deepMerge,
  setNestedValues,
} from './utils';

interface PendingBatch {
  lang: string;
  ns: string;
  version: string | undefined;
  prefixes: Map<string, number>;
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: any) => void;
}

export function createLinguiniStore(config: LinguiniConfig<any>): LinguiniStore {
  // Determine initial language: use detected browser language or default
  const initialLang = detectBrowserLanguage(config.supportedLanguages, config.defaultLanguage);

  const initialTargetVersions: Record<string, string> = { ...(config.versions || {}) };
  if (config.namespaces) {
    for (const ns of Object.keys(config.namespaces)) {
      const nsVersion = config.namespaces[ns]?.version;
      if (nsVersion !== undefined) {
        initialTargetVersions[ns] = nsVersion;
      }
    }
  }

  let state: LinguiniState = {
    language: initialLang,
    translations: {},
    loadingStates: {},
    partialLoadingStates: {},
    versions: {},
    partialVersions: {},
    targetVersions: initialTargetVersions,
  };

  const listeners = new Set<() => void>();
  const activePromises = new Map<string, Promise<void>>(); // key: "lang\0ns\0version"
  const activePartialPromises = new Map<string, Promise<void>>(); // key: "lang\0ns\0prefix\0version"
  const pendingBatches = new Map<string, PendingBatch>(); // key: "lang\0ns\0version"
  const fullRequestSeq = new Map<string, number>(); // key: "lang\0ns"
  const partialRequestSeq = new Map<string, number>(); // key: "lang\0ns\0prefix"

  function updateState(newState: Partial<LinguiniState>) {
    state = { ...state, ...newState };
    listeners.forEach((listener) => listener());
  }

  function resolveVersion(ns: string, overrideVersion?: string): string | undefined {
    return overrideVersion ?? state.targetVersions[ns] ?? config.defaultVersion;
  }

  function resolveLoader(ns: string): LinguiniLoader {
    const loader = config.namespaces?.[ns]?.loader ?? config.loader;
    if (!loader) {
      throw new Error(`Linguini: No loader configured for namespace "${ns}"`);
    }
    return loader;
  }

  function resolveRetryConfig(ns: string): RetryConfig | undefined {
    const raw = config.namespaces?.[ns]?.retry ?? config.retry;
    if (raw === undefined || raw === 0) return undefined;
    if (typeof raw === 'number') {
      return raw > 0 ? { maxRetries: raw } : undefined;
    }
    return raw.maxRetries > 0 ? raw : undefined;
  }

  async function executeWithRetry<T>(
    fn: () => Promise<T>,
    retryConfig?: RetryConfig
  ): Promise<T> {
    const maxRetries = retryConfig?.maxRetries ?? 0;
    let attempt = 0;

    while (true) {
      try {
        return await fn();
      } catch (error) {
        if (attempt >= maxRetries) {
          throw error;
        }
        attempt++;
        const delay =
          typeof retryConfig?.retryDelay === 'function'
            ? retryConfig.retryDelay(attempt, error)
            : (retryConfig?.retryDelay ?? 300) * Math.pow(2, attempt - 1);
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
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
    const versionStr = version ?? '';
    const keyPrefixes = Array.from(prefixes.keys());

    try {
      const loader = resolveLoader(ns);
      const retryConfig = resolveRetryConfig(ns);
      const data = await executeWithRetry(
        () => loader(lang, ns, { version, keyPrefixes }),
        retryConfig
      );

      const currentPrefixes = keyPrefixes.filter(
        (prefix) => partialRequestSeq.get(`${lang}\0${ns}\0${prefix}`) === prefixes.get(prefix)
      );

      if (currentPrefixes.length > 0) {
        const strategy =
          config.namespaces?.[ns]?.partialMergeStrategy ??
          config.partialMergeStrategy ??
          'root';

        let mergedTranslations: Record<string, any>;
        if (strategy === 'subtree') {
          let filteredData: Record<string, any>;
          if (currentPrefixes.length === keyPrefixes.length) {
            filteredData = data || {};
          } else {
            filteredData = {};
            const currentSet = new Set(currentPrefixes);
            for (const [k, v] of Object.entries(data || {})) {
              if (currentSet.has(k)) {
                filteredData[k] = v;
              }
            }
          }
          mergedTranslations = setNestedValues(state.translations[lang]?.[ns], filteredData);
        } else {
          mergedTranslations = deepMerge(state.translations[lang]?.[ns], data || {});
        }

        const langPartialStates = state.partialLoadingStates[lang] || {};
        const nsPartialStates = { ...(langPartialStates[ns] || {}) };
        const langPartialVersions = state.partialVersions[lang] || {};
        const nsPartialVersions = { ...(langPartialVersions[ns] || {}) };

        for (const prefix of currentPrefixes) {
          nsPartialStates[prefix] = 'loaded';
          nsPartialVersions[prefix] = versionStr;
        }

        const nextState: Partial<LinguiniState> = {
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
          partialVersions: {
            ...state.partialVersions,
            [lang]: {
              ...langPartialVersions,
              [ns]: nsPartialVersions,
            },
          },
        };

        // Keep full loadingStates/versions consistent if a full load occurred at an older version
        if (
          state.loadingStates[lang]?.[ns] === 'loaded' &&
          state.versions[lang]?.[ns] !== versionStr
        ) {
          nextState.loadingStates = {
            ...state.loadingStates,
            [lang]: {
              ...(state.loadingStates[lang] || {}),
              [ns]: 'idle',
            },
          };
          nextState.versions = {
            ...state.versions,
            [lang]: {
              ...(state.versions[lang] || {}),
              [ns]: versionStr,
            },
          };
        } else if (state.loadingStates[lang]?.[ns] !== 'loaded') {
          nextState.versions = {
            ...state.versions,
            [lang]: {
              ...(state.versions[lang] || {}),
              [ns]: versionStr,
            },
          };
        }

        updateState(nextState);
      }

      for (const prefix of keyPrefixes) {
        const prefixKey = `${lang}\0${ns}\0${prefix}\0${versionStr}`;
        if (activePartialPromises.get(prefixKey) === promise) {
          activePartialPromises.delete(prefixKey);
        }
      }
      resolve();
    } catch (error) {
      const currentPrefixes = keyPrefixes.filter(
        (prefix) => partialRequestSeq.get(`${lang}\0${ns}\0${prefix}`) === prefixes.get(prefix)
      );
      updatePartialLoadingStates(lang, ns, currentPrefixes, 'error');
      for (const prefix of keyPrefixes) {
        const prefixKey = `${lang}\0${ns}\0${prefix}\0${versionStr}`;
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

    setVersions(versions: Record<string, string>, options?: SetVersionsOptions) {
      const nextTargetVersions = options?.replace
        ? { ...versions }
        : { ...state.targetVersions, ...versions };

      const prevKeys = Object.keys(state.targetVersions);
      const nextKeys = Object.keys(nextTargetVersions);
      const changed =
        prevKeys.length !== nextKeys.length ||
        nextKeys.some((k) => state.targetVersions[k] !== nextTargetVersions[k]);

      if (!changed) return;
      updateState({ targetVersions: nextTargetVersions });
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
      const version = resolveVersion(ns, options?.version);
      const versionStr = version ?? '';

      if (!isPartial) {
        const key = `${lang}\0${ns}\0${versionStr}`;
        const status = state.loadingStates[lang]?.[ns] || 'idle';
        const loadedVersion = state.versions[lang]?.[ns];

        if (status === 'loaded' && loadedVersion === versionStr && !force) {
          return Promise.resolve();
        }

        const existingPromise = activePromises.get(key);
        if (existingPromise && !force) {
          return existingPromise;
        }

        const seqKey = `${lang}\0${ns}`;
        const mySeq = (fullRequestSeq.get(seqKey) ?? 0) + 1;
        fullRequestSeq.set(seqKey, mySeq);

        let promise!: Promise<void>;
        promise = (async () => {
          updateLoadingState(lang, ns, 'loading');
          try {
            const loader = resolveLoader(ns);
            const retryConfig = resolveRetryConfig(ns);
            const data = await executeWithRetry(
              () => loader(lang, ns, { version }),
              retryConfig
            );

            if (fullRequestSeq.get(seqKey) !== mySeq) {
              return;
            }

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
                  [ns]: versionStr,
                },
              },
            });
          } catch (error) {
            if (fullRequestSeq.get(seqKey) === mySeq) {
              updateLoadingState(lang, ns, 'error');
            }
            throw error;
          } finally {
            if (activePromises.get(key) === promise) {
              activePromises.delete(key);
            }
          }
        })();

        activePromises.set(key, promise);
        return promise;
      }

      // Partial load path
      if (
        !force &&
        state.loadingStates[lang]?.[ns] === 'loaded' &&
        state.versions[lang]?.[ns] === versionStr
      ) {
        return Promise.resolve();
      }

      const nsPartialStates = state.partialLoadingStates[lang]?.[ns];
      const nsPartialVersions = state.partialVersions[lang]?.[ns];
      const pendingPrefixes = force
        ? requestedPrefixes
        : requestedPrefixes.filter(
            (prefix) =>
              nsPartialStates?.[prefix] !== 'loaded' ||
              nsPartialVersions?.[prefix] !== versionStr
          );

      if (pendingPrefixes.length === 0) {
        return Promise.resolve();
      }

      const existingPromises: Promise<void>[] = [];
      const seenExisting = new Set<Promise<void>>();
      const toQueue: string[] = [];

      for (const prefix of pendingPrefixes) {
        const prefixKey = `${lang}\0${ns}\0${prefix}\0${versionStr}`;
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

      const bucketKey = `${lang}\0${ns}\0${versionStr}`;
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
          prefixes: new Map<string, number>(),
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
        const seqKey = `${lang}\0${ns}\0${prefix}`;
        const nextSeq = (partialRequestSeq.get(seqKey) ?? 0) + 1;
        partialRequestSeq.set(seqKey, nextSeq);
        batch.prefixes.set(prefix, nextSeq);
        activePartialPromises.set(`${lang}\0${ns}\0${prefix}\0${versionStr}`, batch.promise);
      }

      if (existingPromises.length === 0) {
        return batch.promise;
      }
      return Promise.all([...existingPromises, batch.promise]).then(() => {});
    },

    async refreshNamespace(ns: string, options?: RefreshNamespaceOptions) {
      if (options?.version !== undefined && state.targetVersions[ns] !== options.version) {
        updateState({
          targetVersions: {
            ...state.targetVersions,
            [ns]: options.version,
          },
        });
      }

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

    translate(
      ns: string,
      key: string,
      paramsOrDefault?: TranslateParams | string,
      maybeParams?: Record<string, any>
    ): string {
      let defaultValue: string | undefined;
      let params: Record<string, any> | undefined;

      if (typeof paramsOrDefault === 'string') {
        defaultValue = paramsOrDefault;
        params = maybeParams;
      } else {
        params = paramsOrDefault;
        defaultValue = paramsOrDefault?.defaultValue;
      }

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

      if (val === undefined) {
        if (defaultValue !== undefined) {
          return interpolate(defaultValue, params);
        }
        if (typeof config.missingKeyFallback === 'function') {
          return config.missingKeyFallback(ns, key);
        }
        if (typeof config.missingKeyFallback === 'string') {
          return config.missingKeyFallback;
        }
        return `${ns}:${key}`;
      }

      return interpolate(val, params);
    },
  };

  return store;
}
