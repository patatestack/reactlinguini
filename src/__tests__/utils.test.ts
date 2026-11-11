import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getNestedValue, interpolate, detectBrowserLanguage } from '../utils';

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
});
