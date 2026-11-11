export interface LinguiniConfig {
  /**
   * The list of supported language codes.
   */
  supportedLanguages: string[];
  
  /**
   * The default language to fall back to if keys are missing in the current language.
   */
  defaultLanguage: string;
  
  /**
   * An optional fallback language if defaultLanguage is not desired for fallback.
   */
  fallbackLanguage?: string;
  
  /**
   * The function that loads the translation JSON object for a given language and namespace.
   * Can accept version strings for cache-busting or versioning.
   */
  loader: (lang: string, ns: string, options?: { version?: string }) => Promise<Record<string, any>>;
  
  /**
   * Initial version used for loading namespaces if no specific version is requested.
   */
  defaultVersion?: string;

  /**
   * Initial versions map for specific namespaces. E.g. { common: '1.2.0', profile: '2.0.0' }
   */
  versions?: Record<string, string>;
}

export type NamespaceLoadingStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface LinguiniState {
  language: string;
  // lang -> ns -> flat or nested keys
  translations: Record<string, Record<string, Record<string, any>>>;
  // lang -> ns -> status
  loadingStates: Record<string, Record<string, NamespaceLoadingStatus>>;
  // lang -> ns -> version-string
  versions: Record<string, Record<string, string>>;
}

export interface LinguiniStore {
  getState: () => LinguiniState;
  subscribe: (listener: () => void) => () => void;
  setLanguage: (lang: string) => void;
  loadNamespace: (lang: string, ns: string, options?: { version?: string; forceRefresh?: boolean }) => Promise<void>;
  refreshNamespace: (ns: string, options?: { version?: string }) => Promise<void>;
  translate: (ns: string, key: string, params?: Record<string, any>) => string;
  config: LinguiniConfig;
}

// Recursive type to resolve nested keys using dot notation
export type PathsToStringProps<T> = T extends string
  ? ""
  : T extends Record<string, any>
  ? {
      [K in keyof T & string]: T[K] extends string
        ? K
        : T[K] extends Record<string, any>
        ? `${K}.${PathsToStringProps<T[K]>}` | K
        : K;
    }[keyof T & string]
  : string;

// Helper to extract translation keys for a given namespace or namespaces union
export type KeyOfNamespace<
  Schema extends Record<string, any>,
  NS extends keyof Schema
> = Schema[NS] extends Record<string, any>
  ? PathsToStringProps<Schema[NS]>
  : string;

// Key | (string & {}) allows TS autocomplete suggestions while permitting arbitrary strings
export type TranslateFunction<Key extends string = string> = (
  key: Key | (string & {}),
  params?: Record<string, any>
) => string;

export interface UseTranslationResult<Key extends string = string> {
  /**
   * Translation function. Resolves keys within the bound namespace(s).
   */
  t: TranslateFunction<Key>;
  
  /**
   * True if the namespace translations have been loaded successfully.
   */
  ready: boolean;
  
  /**
   * Current loading status of the namespace ('idle' | 'loading' | 'loaded' | 'error').
   */
  status: NamespaceLoadingStatus;
  
  /**
   * Error object if loading failed, otherwise undefined.
   */
  error?: Error;
}
