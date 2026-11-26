import { useRef } from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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
    globalThis.navigator = { languages: ['fr-FR'] };

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

  describe('scoped re-renders and stable t identity', () => {
    it('does not re-render components or change t identity when unrelated namespaces or partial prefixes load', async () => {
      const loader = vi.fn().mockImplementation(async (_lang, ns, options) => {
        if (ns === 'nsA') return { greeting: 'Hello A' };
        if (ns === 'nsB') return { greeting: 'Hello B' };
        if (ns === 'partialNs') {
          const out: Record<string, any> = {};
          for (const prefix of options?.keyPrefixes || []) {
            out[prefix] = { text: `Text for ${prefix}` };
          }
          return out;
        }
        return {};
      });

      const scopedLinguini = createLinguini({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        namespaces: {
          partialNs: { partial: true, partialMergeStrategy: 'subtree' },
        },
        loader,
      });

      const nsARenders = { count: 0 };
      const nsATRefs: any[] = [];
      const langRenders = { count: 0 };
      const statusRenders = { count: 0 };
      const prefixARenders = { count: 0 };
      const prefixATRefs: any[] = [];

      const CompA = () => {
        nsARenders.count++;
        const { t, ready } = scopedLinguini.useTranslation('nsA');
        nsATRefs.push(t);
        return <div data-testid="compA">{ready ? t('greeting') : 'loading'}</div>;
      };

      const LangViewer = () => {
        langRenders.count++;
        const { language } = useLanguage();
        return <div data-testid="lang">{language}</div>;
      };

      const StatusViewer = () => {
        statusRenders.count++;
        const status = useNamespaceStatus('nsA');
        return <div data-testid="statusA">{status}</div>;
      };

      const PrefixAComp = () => {
        prefixARenders.count++;
        const { t, ready } = scopedLinguini.useTranslation('partialNs', { keyPrefix: 'alpha' });
        prefixATRefs.push(t);
        return <div data-testid="prefixA">{ready ? t('text') : 'loading'}</div>;
      };

      render(
        <scopedLinguini.LinguiniProvider>
          <CompA />
          <LangViewer />
          <StatusViewer />
          <PrefixAComp />
        </scopedLinguini.LinguiniProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('compA').textContent).toBe('Hello A');
        expect(screen.getByTestId('prefixA').textContent).toBe('Text for alpha');
        expect(screen.getByTestId('statusA').textContent).toBe('loaded');
      });

      const rendersBeforeB = {
        nsA: nsARenders.count,
        lang: langRenders.count,
        statusA: statusRenders.count,
        prefixA: prefixARenders.count,
      };
      const tABefore = nsATRefs[nsATRefs.length - 1];
      const tPrefixABefore = prefixATRefs[prefixATRefs.length - 1];

      // Load unrelated namespace nsB and unrelated partial prefix beta
      await act(async () => {
        await scopedLinguini.store.loadNamespace('en', 'nsB');
        await scopedLinguini.store.loadNamespace('en', 'partialNs', { keyPrefix: 'beta' });
      });

      expect(nsARenders.count).toBe(rendersBeforeB.nsA);
      expect(langRenders.count).toBe(rendersBeforeB.lang);
      expect(statusRenders.count).toBe(rendersBeforeB.statusA);
      expect(prefixARenders.count).toBe(rendersBeforeB.prefixA);
      expect(nsATRefs[nsATRefs.length - 1]).toBe(tABefore);
      expect(prefixATRefs[prefixATRefs.length - 1]).toBe(tPrefixABefore);
    });
  });

  describe('setVersions stale-while-revalidate', () => {
    it('automatically refetches mounted namespaces and keeps old translations ready until new version resolves', async () => {
      let resolveV2Full!: (val: Record<string, any>) => void;
      let resolveV2Partial!: (val: Record<string, any>) => void;

      const versionedLoader = vi.fn().mockImplementation((_lang, ns, options) => {
        if (ns === 'common') {
          if (options?.version === '1.0') return Promise.resolve({ title: 'Title v1' });
          return new Promise<Record<string, any>>((res) => {
            resolveV2Full = res;
          });
        }
        if (ns === 'items') {
          if (options?.version === '1.0') return Promise.resolve({ row1: { text: 'Row1 v1' } });
          return new Promise<Record<string, any>>((res) => {
            resolveV2Partial = res;
          });
        }
        return Promise.resolve({});
      });

      const vLinguini = createLinguini({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        versions: { common: '1.0', items: '1.0' },
        namespaces: {
          items: { partial: true, partialMergeStrategy: 'subtree' },
        },
        loader: versionedLoader,
      });

      const Page = () => {
        const common = vLinguini.useTranslation('common');
        const row1 = vLinguini.useTranslation('items', { keyPrefix: 'row1' });
        return (
          <div>
            <div data-testid="common-ready">{String(common.ready)}</div>
            <div data-testid="common-status">{common.status}</div>
            <div data-testid="common-text">{common.ready ? common.t('title') : 'loading'}</div>
            <div data-testid="row1-ready">{String(row1.ready)}</div>
            <div data-testid="row1-text">{row1.ready ? row1.t('text') : 'loading'}</div>
          </div>
        );
      };

      render(
        <vLinguini.LinguiniProvider>
          <Page />
        </vLinguini.LinguiniProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('common-text').textContent).toBe('Title v1');
        expect(screen.getByTestId('row1-text').textContent).toBe('Row1 v1');
      });

      // Update versions dynamically (like after api/translationversions arrives)
      act(() => {
        vLinguini.store.setVersions({ common: '2.0', items: '2.0' });
      });

      // Stale-while-revalidate: status becomes 'loading', but ready remains true and v1 text stays visible
      await waitFor(() => {
        expect(screen.getByTestId('common-status').textContent).toBe('loading');
      });
      expect(screen.getByTestId('common-ready').textContent).toBe('true');
      expect(screen.getByTestId('common-text').textContent).toBe('Title v1');
      expect(screen.getByTestId('row1-ready').textContent).toBe('true');
      expect(screen.getByTestId('row1-text').textContent).toBe('Row1 v1');

      await act(async () => {
        resolveV2Full({ title: 'Title v2' });
        resolveV2Partial({ row1: { text: 'Row1 v2' } });
      });

      await waitFor(() => {
        expect(screen.getByTestId('common-status').textContent).toBe('loaded');
        expect(screen.getByTestId('common-text').textContent).toBe('Title v2');
        expect(screen.getByTestId('row1-text').textContent).toBe('Row1 v2');
      });
    });
  });

  describe('fallbackLoadStrategy', () => {
    it('onError skips defaultLanguage when active language succeeds and falls back when active fails', async () => {
      // @ts-ignore
      globalThis.navigator = { languages: ['fr-FR'] };

      const loader = vi.fn().mockImplementation(async (lang, ns) => {
        if (ns === 'okNs' && lang === 'fr') return { msg: 'Salut' };
        if (ns === 'failNs' && lang === 'fr') throw new Error('FR missing');
        if (ns === 'failNs' && lang === 'en') return { msg: 'English Fallback' };
        if (ns === 'doubleFail' && (lang === 'fr' || lang === 'en')) throw new Error('Both missing');
        if (ns === 'doubleFail' && lang === 'es') return { msg: 'Hola Fallback' };
        return {};
      });

      const onErrorLinguini = createLinguini({
        supportedLanguages: ['en', 'fr', 'es'],
        defaultLanguage: 'en',
        fallbackLanguage: 'es',
        fallbackLoadStrategy: 'onError',
        loader,
      });

      const Comp = () => {
        const ok = onErrorLinguini.useTranslation('okNs');
        const fail = onErrorLinguini.useTranslation('failNs');
        const dbl = onErrorLinguini.useTranslation('doubleFail');
        return (
          <div>
            <div data-testid="ok">{ok.ready ? ok.t('msg') : 'loading'}</div>
            <div data-testid="fail">{fail.t('msg')}</div>
            <div data-testid="dbl">{dbl.t('msg')}</div>
          </div>
        );
      };

      render(
        <onErrorLinguini.LinguiniProvider>
          <Comp />
        </onErrorLinguini.LinguiniProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('ok').textContent).toBe('Salut');
        expect(screen.getByTestId('fail').textContent).toBe('English Fallback');
        expect(screen.getByTestId('dbl').textContent).toBe('Hola Fallback');
      });

      // okNs only loaded 'fr', never 'en' or 'es'
      expect(loader).not.toHaveBeenCalledWith('en', 'okNs', expect.anything());
      expect(loader).not.toHaveBeenCalledWith('es', 'okNs', expect.anything());
    });

    it('onMissing loads defaultLanguage lazily (including partial keyPrefix) only when a key is missing in active language', async () => {
      // @ts-ignore
      globalThis.navigator = { languages: ['fr-FR'] };

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const loader = vi.fn().mockImplementation(async (lang, _ns, options) => {
        await new Promise((res) => setTimeout(res, 10));
        if (lang === 'fr') {
          return {
            row1: { text: 'Ligne 1', onlyEn: undefined },
          };
        }
        if (lang === 'en') {
          if (options?.keyPrefixes?.includes('row1')) {
            return { row1: { text: 'Row 1 EN', fallbackKey: 'Only in English' } };
          }
        }
        return {};
      });

      const onMissingLinguini = createLinguini({
        supportedLanguages: ['en', 'fr'],
        defaultLanguage: 'en',
        fallbackLoadStrategy: 'onMissing',
        namespaces: {
          reasons: { partial: true, partialMergeStrategy: 'subtree' },
        },
        loader,
      });

      const Row = ({ showMissing }: { showMissing: boolean }) => {
        const { t, ready } = onMissingLinguini.useTranslation('reasons', { keyPrefix: 'row1' });
        if (!ready) return <div data-testid="row">loading</div>;
        return (
          <div data-testid="row">
            {showMissing ? t('fallbackKey') : t('text')}
          </div>
        );
      };

      const { rerender } = render(
        <onMissingLinguini.LinguiniProvider>
          <Row showMissing={false} />
        </onMissingLinguini.LinguiniProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('row').textContent).toBe('Ligne 1');
      });

      // No English request was made when all rendered keys existed in French
      expect(loader).toHaveBeenCalledTimes(1);
      expect(loader).toHaveBeenCalledWith('fr', 'reasons', {
        version: undefined,
        keyPrefixes: ['row1'],
      });

      // Render a key missing in French -> triggers lazy scoped fallback fetch for 'en'
      rerender(
        <onMissingLinguini.LinguiniProvider>
          <Row showMissing={true} />
        </onMissingLinguini.LinguiniProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('row').textContent).toBe('Only in English');
      });

      expect(loader).toHaveBeenCalledTimes(2);
      expect(loader).toHaveBeenCalledWith('en', 'reasons', {
        version: undefined,
        keyPrefixes: ['row1'],
      });
      // Ensure no React render-phase setState warnings occurred
      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('defaultValue and nsSeparator options', () => {
    it('supports defaultValue and configurable nsSeparator (false and custom string)', async () => {
      const loader = vi.fn().mockImplementation(async (_lang, ns) => {
        if (ns === 'common') {
          return {
            'http:status': 'HTTP OK',
            'time:12:00': 'Noon',
            greeting: 'Hello',
          };
        }
        if (ns === 'other') {
          return { title: 'Other Title' };
        }
        return {};
      });

      // 1. nsSeparator: false allows ':' inside keys
      const colonLinguini = createLinguini({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        nsSeparator: false,
        loader,
      });

      const ColonComp = () => {
        const { t, ready } = colonLinguini.useTranslation('common');
        if (!ready) return <div data-testid="colon">loading</div>;
        return (
          <div>
            <div data-testid="colon-status">{t('http:status')}</div>
            <div data-testid="colon-time">{t('time:12:00')}</div>
            <div data-testid="default-str">{t('missing:key', 'Fallback {x}', { x: 'OK' })}</div>
            <div data-testid="default-obj">{t('missing:key2', { defaultValue: 'Obj Fallback' })}</div>
          </div>
        );
      };

      const { unmount } = render(
        <colonLinguini.LinguiniProvider>
          <ColonComp />
        </colonLinguini.LinguiniProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('colon-status').textContent).toBe('HTTP OK');
      });
      expect(screen.getByTestId('colon-time').textContent).toBe('Noon');
      expect(screen.getByTestId('default-str').textContent).toBe('Fallback OK');
      expect(screen.getByTestId('default-obj').textContent).toBe('Obj Fallback');
      unmount();

      // 2. Custom nsSeparator: '::'
      const customSepLinguini = createLinguini({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        nsSeparator: '::',
        loader,
      });

      const CustomSepComp = () => {
        const common = customSepLinguini.useTranslation('common');
        const other = customSepLinguini.useTranslation('other');
        if (!common.ready || !other.ready) return <div data-testid="custom">loading</div>;
        return (
          <div>
            <div data-testid="custom-colon">{common.t('http:status')}</div>
            <div data-testid="custom-cross">{common.t('other::title')}</div>
          </div>
        );
      };

      render(
        <customSepLinguini.LinguiniProvider>
          <CustomSepComp />
        </customSepLinguini.LinguiniProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('custom-colon').textContent).toBe('HTTP OK');
        expect(screen.getByTestId('custom-cross').textContent).toBe('Other Title');
      });
    });

    it('keeps render count stable via ref check without extra renders', async () => {
      const renderCount = { value: 0 };
      const simpleLinguini = createLinguini({
        supportedLanguages: ['en'],
        defaultLanguage: 'en',
        loader: async () => ({ a: 'A' }),
      });

      const Simple = () => {
        const countRef = useRef(0);
        countRef.current++;
        renderCount.value = countRef.current;
        const { t, ready } = simpleLinguini.useTranslation('common');
        return <div data-testid="simple">{ready ? t('a') : 'loading'}</div>;
      };

      render(
        <simpleLinguini.LinguiniProvider>
          <Simple />
        </simpleLinguini.LinguiniProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('simple').textContent).toBe('A');
      });
      expect(renderCount.value).toBeLessThanOrEqual(3);
    });
  });
});
