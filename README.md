# React Linguini 🍝

A lightweight (~5 KB gzipped), zero-dependency, headless internationalization (i18n) library for React built around **component-driven translation splitting** — load namespaces and even partial namespace slices only where components mount, with per-namespace loaders, skeleton-ready states, language fallbacks, and scoped TypeScript autocomplete.

## Why React Linguini?

- **Component-Driven Translation Splitting**: Unlike i18n setups that eagerly download monolithic locale bundles upfront, React Linguini fetches each namespace—and optionally only the `keyPrefix` slice a component actually renders—on demand when components mount.
- **Scoped Subscriptions & Stable `t`**: `useTranslation`, `useLanguage`, and `useNamespaceStatus` subscribe only to their own namespace/prefix slices and statuses, preventing unrelated re-renders and preserving `t` function identity across other namespace loads.
- **Automatic Batching & Deduplication**: Multiple sibling or `.map()` child components requesting different `keyPrefix` values from a partial namespace in the same render pass are automatically batched into a single `loader` call, while shared prefixes are deduplicated.
- **Per-Namespace Loaders**: Point different namespaces at completely different sources (e.g., static JSON/dynamic `import()` for `common`, a CMS or REST endpoint for `catalog`, an authenticated API for `admin`) without writing a monolithic `switch (ns)` inside one global loader.
- **Built for Skeletons (`ready` & `status`)**: Every `useTranslation` call exposes `ready`, `status` (`idle` | `loading` | `loaded` | `error`), and `error` scoped to the exact namespace(s) or `keyPrefix` the component depends on.
- **Zero Runtime Dependencies**: Built natively on React 18/19's `useSyncExternalStore`.
- **Configurable Fallback Loading (`fallbackLoadStrategy`)**: Choose `'eager'` (default), `'onError'` (only load default/fallback if active fails), or `'onMissing'` (lazily load fallback only when a rendered key is missing in the active language).
- **Default Values & Missing Key Fallbacks**: Pass `defaultValue` inline (`t('key', 'Fallback')` or `t('key', { defaultValue: 'Fallback' })`), configure global `missingKeyFallback`, and optionally disable `:` namespace splitting via `nsSeparator: false`.
- **Browser Language Detection**: 3-level regional dialect matching (e.g., `fr-CA` -> `fr` -> `fr-FR` -> `defaultLanguage`) with manual override support.
- **Version-Aware Caching & `setVersions()`**: Versioned caching (including per-prefix partial tracking), race protection, automatic retries (`retry`), and `store.setVersions()` with stale-while-revalidate refetching for mounted components.
- **Scoped TypeScript Intellisense**: Pass your translation schema generic for dot-notation key autocomplete, automatically narrowed to the active `keyPrefix` subtree when provided.

## Installation

```bash
npm install reactlinguini
# or
pnpm add reactlinguini
# or
yarn add reactlinguini
```

## Quick Start

### 1. Create your Linguini instance

```ts
// i18n.ts
import { createLinguini } from 'reactlinguini';
import type enCommon from './locales/en/common.json';

// Optional: Define your schema for TypeScript autocomplete
type TranslationSchema = {
  common: typeof enCommon;
};

export const { LinguiniProvider, useTranslation, store } = createLinguini<TranslationSchema>({
  supportedLanguages: ['en', 'fr', 'es'],
  defaultLanguage: 'en',
  defaultVersion: '1.0.0',
  versions: {
    common: '1.2.0', // Optional per-namespace version
  },
  loader: async (lang, ns, options) => {
    const query = options?.version ? `?v=${options.version}` : '';
    const res = await fetch(`/locales/${lang}/${ns}.json${query}`);
    if (!res.ok) throw new Error(`Failed to load ${lang}/${ns}`);
    return res.json();
  },
});
```

### 2. Wrap your application

```tsx
// main.tsx
import { LinguiniProvider } from './i18n';
import App from './App';

export function Root() {
  return (
    <LinguiniProvider>
      <App />
    </LinguiniProvider>
  );
}
```

### 3. Translate in components & show skeletons

```tsx
import { useLanguage, useLinguini } from 'reactlinguini';
import { useTranslation } from './i18n';

export function ProfileCard({ userName }: { userName: string }) {
  const { t, ready } = useTranslation('common');
  const { language, setLanguage, supportedLanguages } = useLanguage();
  const { refreshNamespace } = useLinguini();

  if (!ready) {
    return <div className="skeleton">Loading translations...</div>;
  }

  return (
    <div>
      <h1>{t('title')}</h1>
      <p>{t('welcome', { name: userName })}</p>

      <select value={language} onChange={(e) => setLanguage(e.target.value)}>
        {supportedLanguages.map((lang) => (
          <option key={lang} value={lang}>
            {lang.toUpperCase()}
          </option>
        ))}
      </select>

      <button onClick={() => refreshNamespace('common', { version: '1.2.1' })}>
        Refresh Translations
      </button>
    </div>
  );
}
```

### External Store Control (e.g. Zustand / Redux / Router)

Because `store` is returned directly from `createLinguini`, you can read or change languages outside of React components:

```ts
import { store } from './i18n';

store.setLanguage('fr');
// Update target versions dynamically (e.g., from an API manifest):
// mounted hooks refetch stale namespaces while keeping old translations visible
store.setVersions({ common: '2.0.0', catalog: '1.4.0' });
await store.refreshNamespace('common', { version: '2.0.1' });
```

### Runtime Options: Fallbacks, Default Values, Separators & Retries

```ts
createLinguini({
  supportedLanguages: ['en', 'fr'],
  defaultLanguage: 'en',
  fallbackLoadStrategy: 'onMissing', // 'eager' (default) | 'onError' | 'onMissing'
  missingKeyFallback: '',            // string or (ns, key) => string
  nsSeparator: false,                // allow ':' inside translation keys
  retry: { maxRetries: 2, retryDelay: (attempt) => attempt * 200 },
  loader,
});

// Inline default values with optional interpolation
t('greeting', 'Hello {name}', { name: 'Ada' });
t('greeting', { defaultValue: 'Hello {name}', name: 'Ada' });
```

### Per-Namespace Loaders & Partial Namespace Loading (Optional)

You can configure individual namespaces under `namespaces` with their own `loader`, `version`, and `partial` settings. A namespace-specific `loader` overrides the top-level `loader` (which becomes an optional default fallback), making it easy to mix static JSON files with API-backed or CMS-backed namespaces.

For large namespaces, setting `partial: true` lets components pass `keyPrefix` to `useTranslation`, and concurrent prefix requests in the same render pass are automatically batched into a single `loader` call (`options.keyPrefixes`).

#### 1. Configure per-namespace loaders and partial loading

```ts
export const { LinguiniProvider, useTranslation } = createLinguini<TranslationSchema>({
  supportedLanguages: ['en', 'fr'],
  defaultLanguage: 'en',
  // Optional default loader for namespaces without a custom loader
  loader: async (lang, ns, { version }) => {
    const query = version ? `?v=${version}` : '';
    const res = await fetch(`/locales/${lang}/${ns}.json${query}`);
    return res.json();
  },
  namespaces: {
    // Static bundle with its own dynamic import() loader
    marketing: {
      loader: (lang) => import(`./locales/${lang}/marketing.json`).then((m) => m.default),
    },
    // Partial API-backed namespace with its own endpoint
    dashboard: {
      partial: true,
      version: '1.2.0',
      // 'root' (default): loader returns a root-shaped partial object { settings: { ... } }
      // 'subtree': loader returns { [prefix]: subtreeValue } and Linguini merges each at its prefix path
      partialMergeStrategy: 'root',
      loader: async (lang, ns, { version, keyPrefixes }) => {
        const params = new URLSearchParams();
        if (version) params.set('v', version);
        if (keyPrefixes?.length) params.set('prefixes', keyPrefixes.join(','));
        const res = await fetch(`/api/locales/${lang}/${ns}?${params}`);
        return res.json();
      },
    },
  },
});
```

If you store split static JSON files (e.g. `/locales/en/dashboard/header.json`), set `partialMergeStrategy: 'subtree'` and fetch each prefix in parallel inside `loader`:

```ts
loader: async (lang, ns, { keyPrefixes }) => {
  if (!keyPrefixes?.length) {
    const res = await fetch(`/locales/${lang}/${ns}.json`);
    return res.json();
  }
  const entries = await Promise.all(
    keyPrefixes.map(async (prefix) => {
      const res = await fetch(`/locales/${lang}/${ns}/${prefix}.json`);
      return [prefix, await res.json()] as const;
    })
  );
  return Object.fromEntries(entries);
}
```

#### 2. Use `keyPrefix` in components (and mapped children)

`useTranslation` scopes both loading and `t()` lookups to `keyPrefix` (and narrows TypeScript autocomplete to that subtree). When rendering lists with `.map()`, give each item its own child component so each child calls `useTranslation` with its `keyPrefix` — Linguini automatically deduplicates shared prefixes and batches distinct ones:

```tsx
function SettingsPanel() {
  const { t, ready } = useTranslation('dashboard', { keyPrefix: 'settings' });
  if (!ready) return <div className="skeleton">Loading settings...</div>;
  return <h2>{t('title')}</h2>; // Resolves "settings.title"
}

function DashboardCard({ section }: { section: 'stats' | 'activity' }) {
  const { t, ready } = useTranslation('dashboard', { keyPrefix: section });
  if (!ready) return <div className="skeleton" />;
  return <div>{t('heading')}</div>;
}

export function Dashboard() {
  const sections = ['stats', 'activity'] as const;
  return (
    <>
      <SettingsPanel />
      {sections.map((section) => (
        <DashboardCard key={section} section={section} />
      ))}
    </>
  );
}
// All three prefixes ('settings', 'stats', 'activity') are batched into one loader call!
```

### TypeScript: Per-Namespace Types

You can type translations in three ways—and even combine them:

1. **Automatic inference from per-namespace `loader`s** (zero extra type boilerplate when using dynamic `import()`):
   ```ts
   export const { useTranslation } = createLinguini({
     supportedLanguages: ['en', 'fr'],
     defaultLanguage: 'en',
     namespaces: {
       marketing: {
         loader: (lang) => import(`./locales/${lang}/marketing.json`).then((m) => m.default),
       },
     },
   });

   // `t` automatically autocompletes keys from marketing.json!
   const { t } = useTranslation('marketing', { keyPrefix: 'hero' });
   ```

2. **Decentralized module augmentation (`LinguiniNamespaces`)** (ideal for feature-sliced apps or `fetch()`-based loaders):
   ```ts
   // features/dashboard/i18n.d.ts
   import type enDashboard from './locales/en/dashboard.json';

   declare module 'reactlinguini' {
     interface LinguiniNamespaces {
       dashboard: typeof enDashboard;
     }
   }
   ```
   Each feature folder registers its own namespace type locally without importing everything into a central `i18n.ts`, and augmented types merge with any typed per-namespace loaders.

3. **Central `TranslationSchema` generic**:
   Pass `createLinguini<TranslationSchema>(...)` if you prefer keeping all namespace types in one place.

## License

MIT
