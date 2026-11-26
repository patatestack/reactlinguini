import React, {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  LinguiniState,
  LinguiniStore,
  NamespaceLoadingStatus,
  UseTranslationOptions,
  UseTranslationResult,
  KeyOfNamespace,
  DefaultLinguiniSchema,
  TranslateFunction,
  TranslateParams,
} from './types';
import { getNestedValue } from './utils';

const LinguiniContext = createContext<LinguiniStore | null>(null);

export interface LinguiniProviderProps {
  store: LinguiniStore;
  children: React.ReactNode;
}

export const LinguiniProvider: React.FC<LinguiniProviderProps> = ({ store, children }) => {
  return (
    <LinguiniContext.Provider value={store}>
      {children}
    </LinguiniContext.Provider>
  );
};

export function useLinguiniStore(): LinguiniStore {
  const store = useContext(LinguiniContext);
  if (!store) {
    throw new Error('Linguini: hooks must be used within a LinguiniProvider');
  }
  return store;
}

/**
 * Zero-dependency selector hook built on useSyncExternalStore with memoized snapshot caching.
 */
function useStoreSelector<T>(
  store: LinguiniStore,
  selector: (state: LinguiniState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is
): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const isEqualRef = useRef(isEqual);
  isEqualRef.current = isEqual;

  const cacheRef = useRef<{ hasValue: boolean; value: T }>({
    hasValue: false,
    value: undefined as T,
  });

  const getSnapshot = useCallback(() => {
    const next = selectorRef.current(store.getState());
    if (cacheRef.current.hasValue && isEqualRef.current(cacheRef.current.value, next)) {
      return cacheRef.current.value;
    }
    cacheRef.current.hasValue = true;
    cacheRef.current.value = next;
    return next;
  }, [store]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

interface NamespaceEntrySnapshot {
  status: NamespaceLoadingStatus;
  hasData: boolean;
  targetVersion: string | undefined;
  activeSlice: any;
  defaultSlice: any;
  fallbackSlice: any;
}

interface TranslationSnapshot {
  language: string;
  entries: NamespaceEntrySnapshot[];
}

function areTranslationSnapshotsEqual(a: TranslationSnapshot, b: TranslationSnapshot): boolean {
  if (a.language !== b.language) return false;
  if (a.entries.length !== b.entries.length) return false;
  for (let i = 0; i < a.entries.length; i++) {
    const ea = a.entries[i];
    const eb = b.entries[i];
    if (
      ea.status !== eb.status ||
      ea.hasData !== eb.hasData ||
      ea.targetVersion !== eb.targetVersion ||
      !Object.is(ea.activeSlice, eb.activeSlice) ||
      !Object.is(ea.defaultSlice, eb.defaultSlice) ||
      !Object.is(ea.fallbackSlice, eb.fallbackSlice)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Hook to translate keys within specific namespaces.
 * Automatically triggers namespace loading when mounted, language changes, or target versions update.
 * Subscribes only to the scoped slices/statuses for the requested namespaces (and keyPrefix).
 *
 * @param namespaces A single namespace name or an array of namespace names.
 */
export function useTranslation<
  Schema extends Record<string, Record<string, any>> = DefaultLinguiniSchema,
  NS extends (keyof Schema & string) | (string & {}) = keyof Schema & string,
  KP extends string | undefined = undefined
>(
  namespaces: NS | NS[],
  options?: UseTranslationOptions<KP>
): UseTranslationResult<KeyOfNamespace<Schema, NS, KP>> {
  const store = useLinguiniStore();
  const nsList = (Array.isArray(namespaces) ? namespaces : [namespaces]) as string[];
  const nsKey = nsList.join(',');
  const keyPrefix = options?.keyPrefix || undefined;

  const snapshot = useStoreSelector(
    store,
    (state) => {
      const activeLang = state.language;
      const defaultLang = store.config.defaultLanguage;
      const fallbackLang = store.config.fallbackLanguage;

      const entries: NamespaceEntrySnapshot[] = nsList.map((ns) => {
        const isPartial = Boolean(store.config.namespaces?.[ns]?.partial && keyPrefix);
        const targetVersion = state.targetVersions[ns] ?? store.config.defaultVersion;
        const targetVersionStr = targetVersion ?? '';

        let status: NamespaceLoadingStatus;
        let hasData = false;

        if (isPartial) {
          const fullStatus = state.loadingStates[activeLang]?.[ns];
          const fullVersion = state.versions[activeLang]?.[ns];
          if (fullStatus === 'loaded' && fullVersion === targetVersionStr) {
            status = 'loaded';
            hasData = true;
          } else {
            const pStatus = state.partialLoadingStates[activeLang]?.[ns]?.[keyPrefix!] || 'idle';
            const pVersion = state.partialVersions[activeLang]?.[ns]?.[keyPrefix!];
            status =
              pStatus === 'loaded' && pVersion !== targetVersionStr ? 'idle' : pStatus;
            hasData =
              pVersion !== undefined ||
              (fullStatus === 'loaded' && fullVersion !== undefined);
          }
        } else {
          const fStatus = state.loadingStates[activeLang]?.[ns] || 'idle';
          const fVersion = state.versions[activeLang]?.[ns];
          status =
            fStatus === 'loaded' && fVersion !== targetVersionStr ? 'idle' : fStatus;
          hasData = fVersion !== undefined;
        }

        const getSlice = (lang: string | undefined) => {
          if (!lang) return undefined;
          const nsObj = state.translations[lang]?.[ns];
          return isPartial ? getNestedValue(nsObj, keyPrefix!) : nsObj;
        };

        return {
          status,
          hasData,
          targetVersion,
          activeSlice: getSlice(activeLang),
          defaultSlice: activeLang !== defaultLang ? getSlice(defaultLang) : undefined,
          fallbackSlice:
            fallbackLang && fallbackLang !== activeLang && fallbackLang !== defaultLang
              ? getSlice(fallbackLang)
              : undefined,
        };
      });

      return { language: activeLang, entries };
    },
    areTranslationSnapshotsEqual
  );

  const activeLang = snapshot.language;
  const targetVersionKey = snapshot.entries.map((e) => e.targetVersion ?? '').join('\0');

  // Trigger loading of namespaces according to fallbackLoadStrategy and current target versions
  useEffect(() => {
    const defaultLang = store.config.defaultLanguage;
    const fallbackLang = store.config.fallbackLanguage;

    nsList.forEach((ns) => {
      const nsConfig = store.config.namespaces?.[ns];
      const strategy =
        nsConfig?.fallbackLoadStrategy ?? store.config.fallbackLoadStrategy ?? 'eager';
      const loadOptions = nsConfig?.partial && keyPrefix ? { keyPrefix } : undefined;

      if (strategy === 'eager') {
        // 1. Load active language
        store.loadNamespace(activeLang, ns, loadOptions).catch(() => {});

        // 2. Load default language (if different)
        if (activeLang !== defaultLang) {
          store.loadNamespace(defaultLang, ns, loadOptions).catch(() => {});
        }

        // 3. Load fallback language (if different and configured)
        if (fallbackLang && activeLang !== fallbackLang && defaultLang !== fallbackLang) {
          store.loadNamespace(fallbackLang, ns, loadOptions).catch(() => {});
        }
      } else {
        // 'onError' or 'onMissing': load only active language initially
        store.loadNamespace(activeLang, ns, loadOptions).catch(() => {
          if (activeLang !== defaultLang) {
            store.loadNamespace(defaultLang, ns, loadOptions).catch(() => {
              if (fallbackLang && activeLang !== fallbackLang && defaultLang !== fallbackLang) {
                store.loadNamespace(fallbackLang, ns, loadOptions).catch(() => {});
              }
            });
          } else if (fallbackLang && activeLang !== fallbackLang) {
            store.loadNamespace(fallbackLang, ns, loadOptions).catch(() => {});
          }
        });
      }
    });
  }, [store, activeLang, nsKey, keyPrefix, targetVersionKey]);

  // Determine readiness, loading status, and error (preserving ready=true during stale-while-revalidate)
  const { ready, status, error } = useMemo(() => {
    let isReady = true;
    let aggStatus: NamespaceLoadingStatus = 'loaded';
    let firstError: Error | undefined = undefined;

    for (let i = 0; i < nsList.length; i++) {
      const ns = nsList[i];
      const { status: nsStatus, hasData } = snapshot.entries[i];

      if (!hasData && nsStatus !== 'loaded') {
        isReady = false;
      }

      if (nsStatus === 'error') {
        if (aggStatus !== 'error') {
          aggStatus = 'error';
          firstError = new Error(`Linguini: Failed to load namespace "${ns}"`);
        }
      } else if (nsStatus === 'loading') {
        if (aggStatus !== 'error') {
          aggStatus = 'loading';
        }
      } else if (nsStatus === 'idle') {
        if (aggStatus === 'loaded') {
          aggStatus = 'idle';
        }
      }
    }

    return { ready: isReady, status: aggStatus, error: firstError };
  }, [nsKey, snapshot]);

  // Translation function t — keeps stable identity across unrelated store updates
  const t = useCallback(
    (
      key: string,
      paramsOrDefault?: TranslateParams | string,
      maybeParams?: Record<string, any>
    ): string => {
      const nsSeparator = store.config.nsSeparator === undefined ? ':' : store.config.nsSeparator;
      let resolvedNs = nsList[0];
      let lookupKey = key;
      let explicitNs = false;

      if (nsSeparator !== false && nsSeparator !== '' && key.includes(nsSeparator)) {
        const index = key.indexOf(nsSeparator);
        resolvedNs = key.slice(0, index);
        lookupKey = key.slice(index + nsSeparator.length);
        explicitNs = true;
      } else {
        if (keyPrefix) {
          lookupKey = key ? `${keyPrefix}.${key}` : keyPrefix;
        }

        if (nsList.length > 1) {
          const currentTranslations = store.getState().translations;
          const defaultLang = store.config.defaultLanguage;
          const fallbackLang = store.config.fallbackLanguage;

          for (const ns of nsList) {
            const hasKey =
              getNestedValue(currentTranslations[activeLang]?.[ns], lookupKey) !== undefined ||
              getNestedValue(currentTranslations[defaultLang]?.[ns], lookupKey) !== undefined ||
              (fallbackLang &&
                getNestedValue(currentTranslations[fallbackLang]?.[ns], lookupKey) !== undefined);

            if (hasKey) {
              resolvedNs = ns;
              break;
            }
          }
        }
      }

      const nsConfig = store.config.namespaces?.[resolvedNs];
      const strategy =
        nsConfig?.fallbackLoadStrategy ?? store.config.fallbackLoadStrategy ?? 'eager';

      if (strategy === 'onMissing') {
        const currentState = store.getState();
        const activeVal = getNestedValue(currentState.translations[activeLang]?.[resolvedNs], lookupKey);

        if (activeVal === undefined) {
          const defaultLang = store.config.defaultLanguage;
          const fallbackLang = store.config.fallbackLanguage;
          const targetVersionStr =
            (currentState.targetVersions[resolvedNs] ?? store.config.defaultVersion) ?? '';
          const isPartial = Boolean(nsConfig?.partial && !explicitNs && keyPrefix);
          const loadOptions = isPartial ? { keyPrefix } : undefined;

          const getLangStatus = (lang: string): { status: NamespaceLoadingStatus; fresh: boolean } => {
            if (
              currentState.loadingStates[lang]?.[resolvedNs] === 'loaded' &&
              currentState.versions[lang]?.[resolvedNs] === targetVersionStr
            ) {
              return { status: 'loaded', fresh: true };
            }
            if (isPartial) {
              const pStatus = currentState.partialLoadingStates[lang]?.[resolvedNs]?.[keyPrefix!] || 'idle';
              const pVer = currentState.partialVersions[lang]?.[resolvedNs]?.[keyPrefix!];
              return {
                status: pStatus,
                fresh: pStatus === 'loaded' && pVer === targetVersionStr,
              };
            }
            const fStatus = currentState.loadingStates[lang]?.[resolvedNs] || 'idle';
            const fVer = currentState.versions[lang]?.[resolvedNs];
            return {
              status: fStatus,
              fresh: fStatus === 'loaded' && fVer === targetVersionStr,
            };
          };

          const activeInfo = getLangStatus(activeLang);
          if (activeInfo.status === 'loaded' || activeInfo.status === 'error') {
            if (activeLang !== defaultLang) {
              const defInfo = getLangStatus(defaultLang);
              if (!defInfo.fresh && defInfo.status !== 'loading' && defInfo.status !== 'error') {
                queueMicrotask(() => {
                  store.loadNamespace(defaultLang, resolvedNs, loadOptions).catch(() => {});
                });
              } else if (
                defInfo.status === 'error' ||
                (defInfo.fresh &&
                  getNestedValue(currentState.translations[defaultLang]?.[resolvedNs], lookupKey) === undefined)
              ) {
                if (fallbackLang && fallbackLang !== activeLang && fallbackLang !== defaultLang) {
                  const fbInfo = getLangStatus(fallbackLang);
                  if (!fbInfo.fresh && fbInfo.status !== 'loading' && fbInfo.status !== 'error') {
                    queueMicrotask(() => {
                      store.loadNamespace(fallbackLang, resolvedNs, loadOptions).catch(() => {});
                    });
                  }
                }
              }
            } else if (fallbackLang && fallbackLang !== activeLang) {
              const fbInfo = getLangStatus(fallbackLang);
              if (!fbInfo.fresh && fbInfo.status !== 'loading' && fbInfo.status !== 'error') {
                queueMicrotask(() => {
                  store.loadNamespace(fallbackLang, resolvedNs, loadOptions).catch(() => {});
                });
              }
            }
          }
        }
      }

      return store.translate(resolvedNs, lookupKey, paramsOrDefault as any, maybeParams);
    },
    [store, nsKey, activeLang, keyPrefix, snapshot]
  ) as TranslateFunction<KeyOfNamespace<Schema, NS, KP>>;

  return { t, ready, status, error };
}

/**
 * Hook to access and manage the active language.
 * Only re-renders when the active language changes.
 */
export function useLanguage() {
  const store = useLinguiniStore();
  const language = useStoreSelector(store, (state) => state.language);

  const setLanguage = useCallback((lang: string) => {
    store.setLanguage(lang);
  }, [store]);

  return {
    language,
    setLanguage,
    supportedLanguages: store.config.supportedLanguages,
  };
}

/**
 * Hook to query loading status of a specific namespace (or a keyPrefix within a partial namespace).
 * Only re-renders when the status of the queried namespace/prefix changes.
 */
export function useNamespaceStatus(ns: string, keyPrefix?: string): NamespaceLoadingStatus {
  const store = useLinguiniStore();
  return useStoreSelector(store, (state) => {
    const lang = state.language;
    const targetVersionStr = (state.targetVersions[ns] ?? store.config.defaultVersion) ?? '';

    if (keyPrefix && store.config.namespaces?.[ns]?.partial) {
      if (
        state.loadingStates[lang]?.[ns] === 'loaded' &&
        state.versions[lang]?.[ns] === targetVersionStr
      ) {
        return 'loaded';
      }
      const pStatus = state.partialLoadingStates[lang]?.[ns]?.[keyPrefix] || 'idle';
      const pVer = state.partialVersions[lang]?.[ns]?.[keyPrefix];
      return pStatus === 'loaded' && pVersionDiffers(pVer, targetVersionStr) ? 'idle' : pStatus;
    }

    const fStatus = state.loadingStates[lang]?.[ns] || 'idle';
    const fVer = state.versions[lang]?.[ns];
    return fStatus === 'loaded' && pVersionDiffers(fVer, targetVersionStr) ? 'idle' : fStatus;
  });
}

function pVersionDiffers(loadedVersion: string | undefined, targetVersionStr: string): boolean {
  return loadedVersion !== undefined && loadedVersion !== targetVersionStr;
}

/**
 * Hook to directly access store states and methods, like refreshNamespace and setVersions.
 */
export function useLinguini() {
  const store = useLinguiniStore();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  return {
    state,
    setLanguage: store.setLanguage,
    setVersions: store.setVersions,
    refreshNamespace: store.refreshNamespace,
    config: store.config,
  };
}
