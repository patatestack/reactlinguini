import { describe, it, expect, afterEach } from 'vitest';
import { getNestedValue, interpolate, detectBrowserLanguage, deepMerge, setNestedValue } from '../utils';

describe('utils', () => {
  describe('getNestedValue', () => {
    it('resolves flat keys', () => {
      const obj = { key: 'value' };
      expect(getNestedValue(obj, 'key')).toBe('value');
    });

    it('resolves nested keys', () => {
      const obj = {
        nested: {
          key: 'value',
          double: {
            inner: 'deep'
          }
        }
      };
      expect(getNestedValue(obj, 'nested.key')).toBe('value');
      expect(getNestedValue(obj, 'nested.double.inner')).toBe('deep');
    });

    it('returns undefined if path is missing or invalid', () => {
      const obj = { key: 'value' };
      expect(getNestedValue(obj, 'missing')).toBeUndefined();
      expect(getNestedValue(obj, 'key.nested')).toBeUndefined();
      expect(getNestedValue(undefined, 'key')).toBeUndefined();
    });

    it('resolves array indices and arrays of objects using dot notation', () => {
      const obj = {
        items: ['First', 'Second'],
        cards: [{ title: 'Alpha' }, { title: 'Beta', meta: { author: 'Ada' } }],
      };
      expect(getNestedValue(obj, 'items.0')).toBe('First');
      expect(getNestedValue(obj, 'cards.1.title')).toBe('Beta');
      expect(getNestedValue(obj, 'cards.1.meta.author')).toBe('Ada');
      expect(getNestedValue(obj, 'cards.5.title')).toBeUndefined();
    });
  });

  describe('interpolate', () => {
    it('interpolates single curly braces', () => {
      const text = 'Hello {name}!';
      expect(interpolate(text, { name: 'Alice' })).toBe('Hello Alice!');
    });

    it('interpolates double curly braces', () => {
      const text = 'Welcome {{user}} to {{place}}!';
      expect(interpolate(text, { user: 'Bob', place: 'Linguini' })).toBe('Welcome Bob to Linguini!');
    });

    it('ignores missing params and leaves placeholders intact', () => {
      const text = 'Hello {name} and {friend}!';
      expect(interpolate(text, { name: 'Alice' })).toBe('Hello Alice and {friend}!');
    });

    it('handles numeric parameters', () => {
      const text = 'Item count: {count}';
      expect(interpolate(text, { count: 42 })).toBe('Item count: 42');
    });

    it('returns original text if no params provided', () => {
      const text = 'Hello {name}';
      expect(interpolate(text)).toBe('Hello {name}');
    });
  });

  describe('detectBrowserLanguage', () => {
    const originalNavigator = global.navigator;

    afterEach(() => {
      global.navigator = originalNavigator;
    });

    it('falls back to default language if navigator is undefined', () => {
      // @ts-ignore
      delete global.navigator;
      expect(detectBrowserLanguage(['en', 'fr'], 'en')).toBe('en');
    });

    it('matches exact navigator language', () => {
      // @ts-ignore
      global.navigator = { languages: ['fr-FR', 'en-US'], language: 'fr-FR' };
      expect(detectBrowserLanguage(['en-US', 'fr-FR'], 'en')).toBe('fr-FR');
    });

    it('matches base language from language code', () => {
      // @ts-ignore
      global.navigator = { languages: ['fr-CA', 'en-US'], language: 'fr-CA' };
      expect(detectBrowserLanguage(['en', 'fr'], 'en')).toBe('fr');
    });

    it('matches alternative regional dialect if exact match is missing', () => {
      // @ts-ignore
      global.navigator = { languages: ['fr-CA', 'en-US'] };
      // fr-CA should match fr-FR because they share the 'fr' base language
      expect(detectBrowserLanguage(['en', 'fr-FR'], 'en')).toBe('fr-FR');
    });

    it('falls back to default if no matches found', () => {
      // @ts-ignore
      global.navigator = { languages: ['es-ES', 'de-DE'], language: 'es-ES' };
      expect(detectBrowserLanguage(['en', 'fr'], 'en')).toBe('en');
    });
  });

  describe('deepMerge', () => {
    it('deeply merges nested objects without mutating target or source', () => {
      const target = {
        header: { title: 'Old', subtitle: 'Keep' },
        tags: ['a', 'b'],
      };
      const source = {
        header: { title: 'New', extra: 'Added' },
        footer: { copyright: '2026' },
        tags: ['c'],
      };

      const merged = deepMerge(target, source);
      expect(merged).toEqual({
        header: { title: 'New', subtitle: 'Keep', extra: 'Added' },
        footer: { copyright: '2026' },
        tags: ['c'],
      });
      // Original objects remain unmutated
      expect(target.header.title).toBe('Old');
      expect((target as any).footer).toBeUndefined();
      expect(target.tags).toEqual(['a', 'b']);
    });

    it('ignores prototype pollution keys', () => {
      const malicious = JSON.parse('{"__proto__":{"polluted":true},"safe":"ok"}');
      const merged = deepMerge({}, malicious);
      expect(merged).toEqual({ safe: 'ok' });
      expect(({} as any).polluted).toBeUndefined();
    });
  });

  describe('setNestedValue', () => {
    it('sets flat and dotted paths immutably', () => {
      const original = { existing: { a: '1' } };
      const next = setNestedValue(original, 'dashboard.settings.theme', 'Dark');
      expect(next).toEqual({
        existing: { a: '1' },
        dashboard: { settings: { theme: 'Dark' } },
      });
      expect((original as any).dashboard).toBeUndefined();
    });

    it('deep-merges when existing leaf and new value are plain objects', () => {
      const original = { settings: { theme: 'Dark', keep: 'Yes' } };
      const next = setNestedValue(original, 'settings', { theme: 'Light', lang: 'EN' });
      expect(next).toEqual({
        settings: { theme: 'Light', keep: 'Yes', lang: 'EN' },
      });
      expect(original.settings.theme).toBe('Dark');
    });

    it('ignores prototype pollution segments', () => {
      const original = { a: 1 };
      const next = setNestedValue(original, '__proto__.polluted', true);
      expect(next).toEqual({ a: 1 });
      expect(({} as any).polluted).toBeUndefined();
    });
  });
});
