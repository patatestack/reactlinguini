# React Linguini 🍝

A lightweight (~1.8 KB gzipped), zero-dependency, headless internationalization (i18n) library for React with dynamic promise-based namespace loading, fetching states for skeletons, language fallbacks, and optional TypeScript key autocomplete.

## Features

- **Zero Runtime Dependencies**: Built natively on React 18/19's `useSyncExternalStore`.
- **Dynamic Namespace Loading**: Load translations on demand via any promise-based source (`fetch`, dynamic `import()`, IndexedDB, etc.) with automatic request deduplication.
- **Loading States for Skeletons**: Track `ready` and `status` (`idle` | `loading` | `loaded` | `error`) per namespace.
- **Default & Fallback Languages**: Automatically cascades missing keys to your `defaultLanguage` (and optional `fallbackLanguage`).
- **Browser Language Detection**: 3-level regional dialect matching (e.g., `fr-CA` -> `fr` -> `fr-FR` -> `defaultLanguage`) with manual override support.
- **Namespace Versioning & Cache Busting**: Configure per-namespace versions and dynamically force-refresh namespaces at runtime.
- **Optional TypeScript Intellisense**: Pass your translation schema generic for full dot-notation key autocomplete while still allowing dynamic string keys.

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
await store.refreshNamespace('common', { version: '2.0.0' });
```

## License

MIT
