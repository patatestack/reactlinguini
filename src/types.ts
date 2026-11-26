export type PartialMergeStrategy = 'root' | 'subtree';

export interface LoaderOptions {
  version?: string;
  keyPrefixes?: string[];
}

export type LinguiniLoader = (
  lang: string,
  ns: string,
  options?: LoaderOptions
) => Promise<Record<string, any>>;

export interface NamespaceConfig {
  /**
   * Namespace-specific version string.
   */
  version?: string;

  /**
   * Enable partial loading for this namespace (default: false).
   */
  partial?: boolean;

  /**
   * How partial loader responses are merged into state.translations[lang][ns]:
   * - 'root' (default): deep-merge response directly at the namespace root.
   * - 'subtree': each top-level key in response is treated as a requested prefix
   *   and merged at that nested path in the namespace.
   */
  partialMergeStrategy?: PartialMergeStrategy;

  /**
   * Optional namespace-specific loader. Overrides the top-level `loader`.
   */
  loader?: LinguiniLoader;
}

export interface LoadNamespaceOptions {
  version?: string;
  forceRefresh?: boolean;
  keyPrefix?: string;
  keyPrefixes?: string[];
}

export interface RefreshNamespaceOptions {
  version?: string;
  keyPrefix?: string;
  keyPrefixes?: string[];
}

export interface UseTranslationOptions<
  KeyPrefix extends string | undefined = string | undefined
> {
  keyPrefix?: KeyPrefix;
}

export interface LinguiniConfig<
  Namespaces extends Record<string, NamespaceConfig> = Record<string, NamespaceConfig>
> {
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
   * Default fallback loader used when a namespace does not define its own `loader`.
   * Can accept version strings for cache-busting or versioning, and keyPrefixes for partial loads.
   */
  loader?: LinguiniLoader;
  
  /**
   * Initial version used for loading namespaces if no specific version is requested.
   */
  defaultVersion?: string;

  /**
   * Initial versions map for specific namespaces. E.g. { common: '1.2.0', profile: '2.0.0' }
   */
  versions?: Record<string, string>;

  /**
   * Per-namespace configuration, such as partial loading opt-in, merge strategy, and versions.
   */
  namespaces?: Namespaces;

  /**
   * Global default merge strategy for partial namespace loads (default: 'root').
   */
  partialMergeStrategy?: PartialMergeStrategy;
}

/**
 * Augmentable interface for registering per-namespace translation types via TypeScript
 * module augmentation (`declare module 'reactlinguini' { interface LinguiniNamespaces { ... } }`).
 */
export interface LinguiniNamespaces {}

export type DefaultLinguiniSchema = keyof LinguiniNamespaces extends never
  ? Record<string, Record<string, any>>
  : LinguiniNamespaces;

export type InferNamespaceSchema<NSConfig> = NSConfig extends {
  loader: (...args: any[]) => Promise<infer Data>;
}
  ? 0 extends 1 & Data
    ? Record<string, any>
    : Data extends Record<string, any>
    ? Data
    : Record<string, any>
  : Record<string, any>;

export type InferSchemaFromNamespaces<
  Namespaces extends Record<string, NamespaceConfig>
> = {
  [K in keyof Namespaces]: InferNamespaceSchema<Namespaces[K]>;
};

type MergeInferredWithAugmented<Inferred extends Record<string, any>> =
  keyof LinguiniNamespaces extends never
    ? keyof Inferred extends never
      ? Record<string, Record<string, any>>
      : Inferred
    : Omit<Inferred, keyof LinguiniNamespaces> & LinguiniNamespaces;

export type ResolveLinguiniSchema<
  ExplicitSchema extends Record<string, Record<string, any>> | undefined,
  Namespaces extends Record<string, NamespaceConfig>
> = [ExplicitSchema] extends [undefined]
  ? MergeInferredWithAugmented<
      string extends keyof Namespaces ? {} : InferSchemaFromNamespaces<Namespaces>
    >
  : Exclude<ExplicitSchema, undefined>;

export type NamespaceLoadingStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface LinguiniState {
  language: string;
  // lang -> ns -> flat or nested keys
  translations: Record<string, Record<string, Record<string, any>>>;
  // lang -> ns -> status
  loadingStates: Record<string, Record<string, NamespaceLoadingStatus>>;
  // lang -> ns -> prefix -> status
  partialLoadingStates: Record<string, Record<string, Record<string, NamespaceLoadingStatus>>>;
  // lang -> ns -> version-string
  versions: Record<string, Record<string, string>>;
}

export interface LinguiniStore {
  getState: () => LinguiniState;
  subscribe: (listener: () => void) => () => void;
  setLanguage: (lang: string) => void;
  loadNamespace: (lang: string, ns: string, options?: LoadNamespaceOptions) => Promise<void>;
  refreshNamespace: (ns: string, options?: RefreshNamespaceOptions) => Promise<void>;
  translate: (ns: string, key: string, params?: Record<string, any>) => string;
  config: LinguiniConfig;
}

// Recursive type to resolve nested keys using dot notation
export type PathsToStringProps<T> = 0 extends 1 & T
  ? string
  : T extends string
  ? ""
  : T extends readonly (infer Item)[]
  ? 0 extends 1 & Item
    ? `${number}`
    : Item extends string
    ? `${number}`
    : Item extends readonly any[] | Record<string, any>
    ? `${number}.${PathsToStringProps<Item>}` | `${number}`
    : `${number}`
  : T extends Record<string, any>
  ? {
      [K in keyof T & string]: 0 extends 1 & T[K]
        ? K
        : T[K] extends string
        ? K
        : T[K] extends readonly (infer Item)[]
        ? 0 extends 1 & Item
          ? `${K}.${number}` | K
          : Item extends string
          ? `${K}.${number}` | K
          : Item extends readonly any[] | Record<string, any>
          ? `${K}.${number}.${PathsToStringProps<Item>}` | `${K}.${number}` | K
          : `${K}.${number}` | K
        : T[K] extends Record<string, any>
        ? `${K}.${PathsToStringProps<T[K]>}` | K
        : K;
    }[keyof T & string]
  : string;

// Resolves the nested sub-schema at a dot-notated path
export type NestedValueAtPath<T, Path extends string> = 0 extends 1 & T
  ? Record<string, any>
  : Path extends ''
  ? T
  : Path extends `${infer Head}.${infer Tail}`
  ? Head extends keyof T
    ? NestedValueAtPath<T[Head], Tail>
    : T extends readonly (infer Item)[]
    ? Head extends `${number}`
      ? NestedValueAtPath<Item, Tail>
      : Record<string, any>
    : Record<string, any>
  : Path extends keyof T
  ? T[Path]
  : T extends readonly (infer Item)[]
  ? Path extends `${number}`
    ? Item
    : Record<string, any>
  : Record<string, any>;

// Helper to extract translation keys for a given namespace or namespaces union
export type KeyOfNamespace<
  Schema extends Record<string, any>,
  NS extends string,
  KeyPrefix extends string | undefined = undefined
> = NS extends keyof Schema
  ? Schema[NS] extends Record<string, any>
    ? [KeyPrefix] extends [string]
      ? KeyPrefix extends ''
        ? PathsToStringProps<Schema[NS]>
        : PathsToStringProps<NestedValueAtPath<Schema[NS], KeyPrefix>>
      : PathsToStringProps<Schema[NS]>
    : string
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
