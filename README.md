# reactlinguini

**reactlinguini** is a React library for managing internationalization (i18n) in your applications. It provides a flexible way to load and use translations, with a focus on Promise-based asynchronous loading.

## Features

*   **Namespace-based organization:** Organize your translations into logical namespaces.
*   **Asynchronous loading:** Load translations asynchronously using your own loader functions (e.g., fetching from an API).
*   **React Hooks:** Easy-to-use `useTranslations` hook to access translations and automatically re-render components on language changes or translation updates.
*   **Language Switching:** Dynamically change the application's language.
*   **TypeScript Support:** Written in TypeScript for better type safety.

## Core Concepts

*   **`TranslationClient`:** The central class for managing translation namespaces, language settings, and loading translations. You typically initialize this once in your application.
*   **Namespaces:** Translations are grouped into namespaces. Each namespace has a name, an optional version key, and a loader function.
*   **`loaderFn`:** A function you provide to load the actual translation data for a given namespace, language, and version. This function should return a Promise that resolves to your translation object.
*   **`useTranslations` Hook:** A React hook that allows your components to subscribe to a specific translation namespace. It returns the translation function (`t`) and loading/error states, and ensures your component re-renders when necessary.

## Getting Started (Conceptual)

1.  **Installation:** (Details would go here - e.g., `npm install reactlinguini` or `yarn add reactlinguini`)
2.  **Initialize `TranslationClient`:**
    ```typescript
    // Example: src/i18n/client.ts
    import { TranslationClient } from 'reactlinguini'; // Adjust path as needed

    // Define your loader function
    async function myTranslationLoader(namespaceName: string, language: string, versionKey?: string) {
      // Example: fetch translations from a JSON file or an API
      const response = await fetch(`/i18n/${language}/${namespaceName}.json?v=${versionKey || ''}`);
      if (!response.ok) {
        throw new Error(`Failed to load translations for ${namespaceName} (${language})`);
      }
      return response.json();
    }

    const translationClient = new TranslationClient('en', [ // Default language 'en'
      { namespaceName: 'common', loaderFn: myTranslationLoader },
      { namespaceName: 'home', loaderFn: myTranslationLoader, versionKey: 'v1.0' },
      // ... other namespaces
    ]);

    export default translationClient;
    ```
3.  **Provide the Client (React Context):**
    Use `TranslationClientProvider` (assuming this component exists or would be created as part of the library, based on `src/Components/TranslationClientProvider.tsx`).
    ```typescript
    // Example: src/App.tsx
    import React from 'react';
    import translationClient from './i18n/client';
    import { TranslationClientProvider } from 'reactlinguini'; // Adjust path
    import YourMainAppComponent from './YourMainAppComponent';

    function App() {
      return (
        <TranslationClientProvider client={translationClient}>
          <YourMainAppComponent />
        </TranslationClientProvider>
      );
    }

    export default App;
    ```
4.  **Use Translations in Components:**
    ```typescript
    // Example: src/components/MyComponent.tsx
    import React from 'react';
    import { useTranslations } from 'reactlinguini'; // Adjust path

    function MyComponent() {
      const { t, isLoading, error, isReady } = useTranslations('common');

      if (isLoading) {
        return <div>Loading translations...</div>;
      }

      if (error) {
        return <div>Error loading translations: {error.message}</div>;
      }

      if (!isReady) {
        return <div>Translations not ready yet.</div>;
      }

      return (
        <div>
          <h1>{t('welcomeMessage', 'Welcome!')}</h1>
          <p>{t('greeting', 'Hello, user')}</p>
        </div>
      );
    }

    export default MyComponent;
    ```

## Scripts

Standard Create React App scripts are available:

*   `npm start` or `yarn start`: Runs the app in development mode.
*   `npm test` or `yarn test`: Launches the test runner.
*   `npm run build` or `yarn build`: Builds the app for production.

## Author

Patate Stack

## License

ISC
