import React, { createContext, useContext, useEffect, useSyncExternalStore, useCallback } from 'react';
import {
  LinguiniStore,
  NamespaceLoadingStatus,
  UseTranslationOptions,
  UseTranslationResult,
  KeyOfNamespace,
  DefaultLinguiniSchema,
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
 * Hook to translate keys within specific namespaces.
 * Automatically triggers namespace loading when mounted or language changes.
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
  const state = useSyncExternalStore(store.subscribe, store.getState);
  
  const nsList = (Array.isArray(namespaces) ? namespaces : [namespaces]) as string[];
  const nsKey = nsList.join(',');
  const activeLang = state.language;
  const keyPrefix = options?.keyPrefix || undefined;

  // Trigger loading of namespaces for active, default, and fallback languages
  useEffect(() => {
    const defaultLang = store.config.defaultLanguage;
    const fallbackLang = store.config.fallbackLanguage;

    nsList.forEach((ns) => {
      const loadOptions =
        store.config.namespaces?.[ns]?.partial && keyPrefix
          ? { keyPrefix }
          : undefined;

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
    });
  }, [store, activeLang, nsKey, keyPrefix]);

  // Determine readiness and loading status
  let ready = true;
  let status: NamespaceLoadingStatus = 'loaded';
  let error: Error | undefined = undefined;

  for (const ns of nsList) {
    const isPartial = Boolean(store.config.namespaces?.[ns]?.partial && keyPrefix);
    const nsStatus = isPartial
      ? state.loadingStates[activeLang]?.[ns] === 'loaded'
        ? 'loaded'
        : state.partialLoadingStates[activeLang]?.[ns]?.[keyPrefix!] || 'idle'
      : state.loadingStates[activeLang]?.[ns] || 'idle';
    
    if (nsStatus === 'error') {
      status = 'error';
      ready = false;
      error = new Error(`Linguini: Failed to load namespace "${ns}"`);
      break;
    } else if (nsStatus === 'loading') {
      status = 'loading';
      ready = false;
    } else if (nsStatus === 'idle') {
      if (status !== 'loading') {
        status = 'idle';
      }
      ready = false;
    }
  }

  // Translation function t
  const t = useCallback((key: string, params?: Record<string, any>): string => {
    let resolvedNs = nsList[0];
    let lookupKey = key;

    if (key.includes(':')) {
      const index = key.indexOf(':');
      resolvedNs = key.slice(0, index);
      lookupKey = key.slice(index + 1);
    } else {
      if (keyPrefix) {
        lookupKey = key ? `${keyPrefix}.${key}` : keyPrefix;
      }

      // If multiple namespaces are provided, find the first one that has this key
      for (const ns of nsList) {
        const defaultLang = store.config.defaultLanguage;
        const fallbackLang = store.config.fallbackLanguage;

        const hasKey =
          getNestedValue(state.translations[activeLang]?.[ns], lookupKey) !== undefined ||
          getNestedValue(state.translations[defaultLang]?.[ns], lookupKey) !== undefined ||
          (fallbackLang && getNestedValue(state.translations[fallbackLang]?.[ns], lookupKey) !== undefined);

        if (hasKey) {
          resolvedNs = ns;
          break;
        }
      }
    }

    return store.translate(resolvedNs, lookupKey, params);
  }, [store, nsKey, activeLang, keyPrefix, state.translations]);

  return { t, ready, status, error };
}

/**
 * Hook to access and manage the active language.
 */
export function useLanguage() {
  const store = useLinguiniStore();
  const state = useSyncExternalStore(store.subscribe, store.getState);

  const setLanguage = useCallback((lang: string) => {
    store.setLanguage(lang);
  }, [store]);

  return {
    language: state.language,
    setLanguage,
    supportedLanguages: store.config.supportedLanguages,
  };
}

/**
 * Hook to query loading status of a specific namespace (or a keyPrefix within a partial namespace).
 */
export function useNamespaceStatus(ns: string, keyPrefix?: string): NamespaceLoadingStatus {
  const store = useLinguiniStore();
  const state = useSyncExternalStore(store.subscribe, store.getState);
  if (keyPrefix && store.config.namespaces?.[ns]?.partial) {
    if (state.loadingStates[state.language]?.[ns] === 'loaded') {
      return 'loaded';
    }
    return state.partialLoadingStates[state.language]?.[ns]?.[keyPrefix] || 'idle';
  }
  return state.loadingStates[state.language]?.[ns] || 'idle';
}

/**
 * Hook to directly access store states and methods, like refreshNamespace.
 */
export function useLinguini() {
  const store = useLinguiniStore();
  const state = useSyncExternalStore(store.subscribe, store.getState);

  return {
    state,
    setLanguage: store.setLanguage,
    refreshNamespace: store.refreshNamespace,
    config: store.config,
  };
}
