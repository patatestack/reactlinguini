import { LinguiniConfig, KeyOfNamespace, UseTranslationResult } from './types';
import { createLinguiniStore } from './store';
import { LinguiniProvider, useTranslation } from './context';
import React from 'react';

export * from './types';
export { getNestedValue, interpolate, detectBrowserLanguage } from './utils';
export { createLinguiniStore } from './store';
export {
  LinguiniProvider,
  useTranslation,
  useLanguage,
  useNamespaceStatus,
  useLinguini,
} from './context';

/**
 * Convenience builder to create a Linguini instance.
 * Returns the store, a pre-configured provider, and bound hooks.
 */
export function createLinguini<
  Schema extends Record<string, Record<string, any>> = Record<string, Record<string, any>>
>(config: LinguiniConfig) {
  const store = createLinguiniStore(config);
  
  const BoundLinguiniProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return React.createElement(LinguiniProvider, { store, children });
  };

  const useTranslationBound = <NS extends keyof Schema>(
    namespaces: NS | NS[]
  ): UseTranslationResult<KeyOfNamespace<Schema, NS>> => {
    return useTranslation<Schema, NS>(namespaces);
  };

  return {
    store,
    LinguiniProvider: BoundLinguiniProvider,
    useTranslation: useTranslationBound,
  };
}
export default createLinguini;
