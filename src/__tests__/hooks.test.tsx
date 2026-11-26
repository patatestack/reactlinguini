import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLinguini, useTranslation, useLanguage, useNamespaceStatus, useLinguini } from '../index';

describe('React Integration Hooks', () => {
  let mockLoader: any;
  let linguini: ReturnType<typeof createLinguini>;

  beforeEach(() => {
    mockLoader = vi.fn().mockImplementation(async (lang, ns) => {
      // Simulate delay
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (lang === 'en' && ns === 'common') {
        return { hello: 'Hello {name}!', defaultOnly: 'Default English' };
      }
      if (lang === 'fr' && ns === 'common') {
        return { hello: 'Bonjour {name}!' };
      }
      return {};
    });

    // Make sure navigator is mocked to 'fr'
    // @ts-ignore
    global.navigator = { languages: ['fr-FR'] };

    linguini = createLinguini({
      supportedLanguages: ['en', 'fr'],
      defaultLanguage: 'en',
      loader: mockLoader,
    });
  });

  it('renders children with LinguiniProvider and loads namespace', async () => {
    const TestComponent = () => {
      const { t, ready, status } = useTranslation('common');
      
      if (!ready) {
        return <div data-testid="status">Loading ({status})</div>;
      }
      
      return (
        <div>
          <div data-testid="status">Loaded</div>
          <div data-testid="translation">{t('hello', { name: 'Alice' })}</div>
        </div>
      );
    };

    render(
      <linguini.LinguiniProvider>
        <TestComponent />
      </linguini.LinguiniProvider>
    );

    // Initial render shows loading
    expect(screen.getByTestId('status').textContent).toBe('Loading (loading)');

    // Wait for the loader to resolve and language to be loaded
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('Loaded');
    });

    expect(screen.getByTestId('translation').textContent).toBe('Bonjour Alice!');
    
    // Verifies it loaded both the active ('fr') and the default ('en') for fallback support
    expect(mockLoader).toHaveBeenCalledWith('fr', 'common', { version: undefined });
    expect(mockLoader).toHaveBeenCalledWith('en', 'common', { version: undefined });
  });

  it('supports active language switching and updates translations', async () => {
    const TestComponent = () => {
      const { t, ready } = useTranslation('common');
      const { language, setLanguage } = useLanguage();
      
      return (
        <div>
          <div data-testid="lang">{language}</div>
          <button data-testid="btn-en" onClick={() => setLanguage('en')}>Set EN</button>
          <div data-testid="content">{ready ? t('hello', { name: 'Bob' }) : 'Loading...'}</div>
        </div>
      );
    };

    render(
      <linguini.LinguiniProvider>
        <TestComponent />
      </linguini.LinguiniProvider>
    );

    // Wait for initial load (fr)
    await waitFor(() => {
      expect(screen.getByTestId('content').textContent).toBe('Bonjour Bob!');
    });

    // Switch language to 'en'
    fireEvent.click(screen.getByTestId('btn-en'));
    
    await waitFor(() => {
      expect(screen.getByTestId('lang').textContent).toBe('en');
    });

    // Should immediately show EN translation (since EN was pre-loaded as the default language!)
    expect(screen.getByTestId('content').textContent).toBe('Hello Bob!');
  });

  it('supports fallback lookup when keys are missing in active language', async () => {
    const TestComponent = () => {
      const { t, ready } = useTranslation('common');
      return <div data-testid="content">{ready ? t('defaultOnly') : 'Loading...'}</div>;
    };

    render(
      <linguini.LinguiniProvider>
        <TestComponent />
      </linguini.LinguiniProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('content').textContent).toBe('Default English');
    });
  });

  it('exposes namespace status hook', async () => {
    const TestComponent = () => {
      useTranslation('common'); // Trigger load
      const status = useNamespaceStatus('common');
      return <div data-testid="status">{status}</div>;
    };

    render(
      <linguini.LinguiniProvider>
        <TestComponent />
      </linguini.LinguiniProvider>
    );

    expect(screen.getByTestId('status').textContent).toBe('loading');

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('loaded');
    });
  });

  it('exposes refresh actions through useLinguini hook', async () => {
    const TestComponent = () => {
      const { refreshNamespace } = useLinguini();
      return (
        <button data-testid="refresh-btn" onClick={() => refreshNamespace('common', { version: '1.2.3' })}>
          Refresh
        </button>
      );
    };

    render(
      <linguini.LinguiniProvider>
        <TestComponent />
      </linguini.LinguiniProvider>
    );

    // Click refresh
    fireEvent.click(screen.getByTestId('refresh-btn'));

    // Verify loader was triggered with the custom version
    await waitFor(() => {
      expect(mockLoader).toHaveBeenCalledWith('fr', 'common', { version: '1.2.3' });
    });
  });

  describe('partial namespace loading and keyPrefix scoping', () => {
    it('batches keyPrefixes across sibling/mapped child components into a single loader call per language', async () => {
      const partialLoader = vi.fn().mockImplementation(async (lang, _ns, options) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (lang === 'en') {
          return {
            header: { title: 'Dashboard EN' },
            settings: { theme: 'Theme EN' },
          };
        }
        if (lang === 'fr') {
          const out: Record<string, any> = {};
          if (options?.keyPrefixes?.includes('header')) {
            out.header = { title: 'Tableau de bord' };
          }
          if (options?.keyPrefixes?.includes('settings')) {
            out.settings = { theme: 'Thème' };
          }
          return out;
        }
        return {};
      });

      const partialLinguini = createLinguini<{
        dashboard: {
          header: { title: string };
          settings: { theme: string };
        };
      }>({
        supportedLanguages: ['en', 'fr'],
        defaultLanguage: 'en',
        namespaces: {
          dashboard: { partial: true },
        },
        loader: partialLoader,
      });

      const Header = () => {
        const { t, ready } = partialLinguini.useTranslation('dashboard', { keyPrefix: 'header' });
        const status = useNamespaceStatus('dashboard', 'header');
        if (!ready) return <div data-testid="header">loading-{status}</div>;
        return <div data-testid="header">{t('title')} ({status})</div>;
      };

      const Settings = () => {
        const { t, ready } = partialLinguini.useTranslation('dashboard', { keyPrefix: 'settings' });
        if (!ready) return <div data-testid="settings">loading</div>;
        return <div data-testid="settings">{t('theme')}</div>;
      };

      const SharedCard = ({ idx }: { idx: number }) => {
        const { t, ready } = partialLinguini.useTranslation('dashboard', { keyPrefix: 'settings' });
        return <div data-testid={`card-${idx}`}>{ready ? t('theme') : 'loading'}</div>;
      };

      render(
        <partialLinguini.LinguiniProvider>
          <Header />
          <Settings />
          {[1, 2].map((idx) => (
            <SharedCard key={idx} idx={idx} />
          ))}
        </partialLinguini.LinguiniProvider>
      );

      expect(screen.getByTestId('header').textContent).toBe('loading-loading');
      expect(screen.getByTestId('settings').textContent).toBe('loading');

      await waitFor(() => {
        expect(screen.getByTestId('header').textContent).toBe('Tableau de bord (loaded)');
      });

      expect(screen.getByTestId('settings').textContent).toBe('Thème');
      // Check exact loader calls: 1 call for 'fr' and 1 call for 'en', both batched with ['header', 'settings']
      expect(partialLoader).toHaveBeenCalledTimes(2);
      expect(partialLoader).toHaveBeenCalledWith('fr', 'dashboard', {
        version: undefined,
        keyPrefixes: ['header', 'settings'],
      });
      expect(partialLoader).toHaveBeenCalledWith('en', 'dashboard', {
        version: undefined,
        keyPrefixes: ['header', 'settings'],
      });
      expect(screen.getByTestId('card-1').textContent).toBe('Thème');
      expect(screen.getByTestId('card-2').textContent).toBe('Thème');
    });

    it('scopes t() with keyPrefix on non-partial namespaces while loading full namespace', async () => {
      const fullLoader = vi.fn().mockImplementation(async (lang) => {
        if (lang === 'fr') return { profile: { greeting: 'Bonjour {name}' } };
        return { profile: { greeting: 'Hello {name}' } };
      });

      const fullLinguini = createLinguini<{
        common: { profile: { greeting: string } };
      }>({
        supportedLanguages: ['en', 'fr'],
        defaultLanguage: 'en',
        loader: fullLoader,
      });

      const Profile = () => {
        const { t, ready } = fullLinguini.useTranslation('common', { keyPrefix: 'profile' });
        if (!ready) return <div data-testid="profile">loading</div>;
        return <div data-testid="profile">{t('greeting', { name: 'Claire' })}</div>;
      };

      render(
        <fullLinguini.LinguiniProvider>
          <Profile />
        </fullLinguini.LinguiniProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('profile').textContent).toBe('Bonjour Claire');
      });

      expect(fullLoader).toHaveBeenCalledWith('fr', 'common', { version: undefined });
      expect(fullLoader).toHaveBeenCalledWith('en', 'common', { version: undefined });
    });
  });
});
