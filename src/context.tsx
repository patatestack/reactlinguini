import React, { createContext, useContext, useEffect, useSyncExternalStore, useCallback } from 'react';
import { LinguiniStore, NamespaceLoadingStatus, UseTranslationResult, KeyOfNamespace } from './types';
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
  Schema extends Record<string, Record<string, any>> = Record<string, Record<string, any>>,
  NS extends keyof Schema = keyof Schema
>(
  namespaces: NS | NS[]
): UseTranslationResult<KeyOfNamespace<Schema, NS>> {
  const store = useLinguiniStore();
  const state = useSyncExternalStore(store.subscribe, store.getState);
  
  const nsList = (Array.isArray(namespaces) ? namespaces : [namespaces]) as string[];
  const nsKey = nsList.join(',');
  const activeLang = state.language;

  // Trigger loading of namespaces for active, default, and fallback languages
  useEffect(() => {
    const defaultLang = store.config.defaultLanguage;
    const fallbackLang = store.config.fallbackLanguage;

    nsList.forEach((ns) => {
      // 1. Load active language
      store.loadNamespace(activeLang, ns).catch(() => {});
      
      // 2. Load default language (if different)
      if (activeLang !== defaultLang) {
        store.loadNamespace(defaultLang, ns).catch(() => {});
      }
      
      // 3. Load fallback language (if different and configured)
      if (fallbackLang && activeLang !== fallbackLang && defaultLang !== fallbackLang) {
        store.loadNamespace(fallbackLang, ns).catch(() => {});
      }
    });
  }, [store, activeLang, nsKey]);

  // Determine readiness and loading status
  let ready = true;
  let status: NamespaceLoadingStatus = 'loaded';
  let error: Error | undefined = undefined;

  for (const ns of nsList) {
    const nsStatus = state.loadingStates[activeLang]?.[ns] || 'idle';
    
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
  }, [store, nsKey, activeLang, state.translations]);

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
 * Hook to query loading status of a specific namespace.
 */
export function useNamespaceStatus(ns: string): NamespaceLoadingStatus {
  const store = useLinguiniStore();
  const state = useSyncExternalStore(store.subscribe, store.getState);
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
