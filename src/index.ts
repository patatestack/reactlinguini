import {
  LinguiniConfig,
  NamespaceConfig,
  ResolveLinguiniSchema,
  KeyOfNamespace,
  UseTranslationOptions,
  UseTranslationResult,
} from './types';
import { createLinguiniStore } from './store';
import { LinguiniProvider, useTranslation } from './context';
import React from 'react';

export * from './types';
export { getNestedValue, interpolate, detectBrowserLanguage, deepMerge, setNestedValue, setNestedValues } from './utils';
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
  Schema extends Record<string, Record<string, any>> | undefined = undefined,
  Namespaces extends Record<string, NamespaceConfig> = Record<string, NamespaceConfig>
>(config: LinguiniConfig<Namespaces>) {
  const store = createLinguiniStore(config);
  type ResolvedSchema = ResolveLinguiniSchema<Schema, Namespaces>;
  
  const BoundLinguiniProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return React.createElement(LinguiniProvider, { store, children });
  };

  const useTranslationBound = <
    NS extends (keyof ResolvedSchema & string) | (string & {}),
    KP extends string | undefined = undefined
  >(
    namespaces: NS | NS[],
    options?: UseTranslationOptions<KP>
  ): UseTranslationResult<KeyOfNamespace<ResolvedSchema, NS, KP>> => {
    return useTranslation<ResolvedSchema, NS, KP>(namespaces, options);
  };

  return {
    store,
    LinguiniProvider: BoundLinguiniProvider,
    useTranslation: useTranslationBound,
  };
}
export default createLinguini;
