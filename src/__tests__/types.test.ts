import { describe, it, expectTypeOf } from 'vitest';
import { createLinguini, useTranslation } from '../index';
import type { KeyOfNamespace, UseTranslationResult } from '../types';

describe('TypeScript per-namespace type inference', () => {
  it('infers namespace schemas from per-namespace loader return types', () => {
    const linguini = createLinguini({
      supportedLanguages: ['en'],
      defaultLanguage: 'en',
      namespaces: {
        marketing: {
          loader: async () => ({
            hero: { title: 'Hello', subtitle: 'World' },
            cta: 'Start',
          }),
        },
        untyped: {
          partial: true,
          loader: async (): Promise<Record<string, any>> => ({}),
        },
      },
    });

    type MarketingResult = ReturnType<typeof linguini.useTranslation<'marketing'>>;
    expectTypeOf<MarketingResult>().toEqualTypeOf<
      UseTranslationResult<'cta' | 'hero' | 'hero.title' | 'hero.subtitle'>
    >();

    type HeroScopedResult = ReturnType<typeof linguini.useTranslation<'marketing', 'hero'>>;
    expectTypeOf<HeroScopedResult>().toEqualTypeOf<
      UseTranslationResult<'title' | 'subtitle'>
    >();

    type UntypedResult = ReturnType<typeof linguini.useTranslation<'untyped'>>;
    expectTypeOf<UntypedResult>().toEqualTypeOf<UseTranslationResult<string>>();

    type DynamicResult = ReturnType<typeof linguini.useTranslation<'dynamicNs'>>;
    expectTypeOf<DynamicResult>().toEqualTypeOf<UseTranslationResult<string>>();
  });

  it('preserves explicit generic Schema on createLinguini', () => {
    type ExplicitSchema = {
      common: {
        welcome: string;
        nav: { home: string; about: string };
      };
    };

    const linguini = createLinguini<ExplicitSchema>({
      supportedLanguages: ['en'],
      defaultLanguage: 'en',
      loader: async () => ({}),
    });

    type CommonResult = ReturnType<typeof linguini.useTranslation<'common'>>;
    expectTypeOf<CommonResult>().toEqualTypeOf<
      UseTranslationResult<'welcome' | 'nav' | 'nav.home' | 'nav.about'>
    >();

    type NavScopedResult = ReturnType<typeof linguini.useTranslation<'common', 'nav'>>;
    expectTypeOf<NavScopedResult>().toEqualTypeOf<
      UseTranslationResult<'home' | 'about'>
    >();
  });

  it('falls back to string keys when no schema or typed loaders are provided', () => {
    const linguini = createLinguini({
      supportedLanguages: ['en'],
      defaultLanguage: 'en',
      loader: async () => ({ hello: 'world' }),
    });

    type AnyResult = ReturnType<typeof linguini.useTranslation<'common'>>;
    expectTypeOf<AnyResult>().toEqualTypeOf<UseTranslationResult<string>>();

    type HookAnyResult = ReturnType<typeof useTranslation>;
    expectTypeOf<HookAnyResult>().toEqualTypeOf<UseTranslationResult<string>>();

    expectTypeOf<KeyOfNamespace<Record<string, Record<string, any>>, 'common'>>().toEqualTypeOf<string>();
  });

  it('handles arrays and arrays of objects without leaking Array.prototype keys', () => {
    type ArraySchema = {
      list: {
        items: string[];
        cards: Array<{
          title: string;
          meta: { author: string };
        }>;
      };
    };

    const linguini = createLinguini<ArraySchema>({
      supportedLanguages: ['en'],
      defaultLanguage: 'en',
      loader: async () => ({}),
    });

    type ListResult = ReturnType<typeof linguini.useTranslation<'list'>>;
    expectTypeOf<ListResult>().toEqualTypeOf<
      UseTranslationResult<
        | 'items'
        | `items.${number}`
        | 'cards'
        | `cards.${number}`
        | `cards.${number}.title`
        | `cards.${number}.meta`
        | `cards.${number}.meta.author`
      >
    >();

    type CardsPrefixResult = ReturnType<typeof linguini.useTranslation<'list', 'cards'>>;
    expectTypeOf<CardsPrefixResult>().toEqualTypeOf<
      UseTranslationResult<
        | `${number}`
        | `${number}.title`
        | `${number}.meta`
        | `${number}.meta.author`
      >
    >();

    type CardItemPrefixResult = ReturnType<typeof linguini.useTranslation<'list', 'cards.0'>>;
    expectTypeOf<CardItemPrefixResult>().toEqualTypeOf<
      UseTranslationResult<'title' | 'meta' | 'meta.author'>
    >();

    type CardMetaPrefixResult = ReturnType<typeof linguini.useTranslation<'list', 'cards.0.meta'>>;
    expectTypeOf<CardMetaPrefixResult>().toEqualTypeOf<
      UseTranslationResult<'author'>
    >();
  });

  it('supports defaultValue overloads and new config/store options in types', () => {
    const linguini = createLinguini({
      supportedLanguages: ['en', 'fr'],
      defaultLanguage: 'en',
      fallbackLoadStrategy: 'onMissing',
      missingKeyFallback: (_ns, key) => key,
      nsSeparator: false,
      retry: { maxRetries: 2, retryDelay: (attempt) => attempt * 100 },
      namespaces: {
        common: {
          fallbackLoadStrategy: 'onError',
          retry: 1,
          loader: async () => ({ greeting: 'Hello {name}' }),
        },
      },
    });

    type CommonResult = ReturnType<typeof linguini.useTranslation<'common'>>;
    type TFunc = CommonResult['t'];

    const checkCalls = (t: TFunc) => {
      const a: string = t('greeting');
      const b: string = t('greeting', { name: 'Ada', defaultValue: 'Hi' });
      const c: string = t('greeting', 'Default Hi');
      const d: string = t('greeting', 'Default {name}', { name: 'Ada' });
      return [a, b, c, d];
    };
    expectTypeOf(checkCalls).returns.toEqualTypeOf<string[]>();
    expectTypeOf<typeof linguini.store.setVersions>().toBeCallableWith({ common: '2.0.0' }, { replace: true });
  });
});
