const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Immutably deep-merges `source` into `target`. Plain objects are merged recursively;
 * primitives and arrays from `source` overwrite `target`.
 */
export function deepMerge(
  target: Record<string, any> | undefined,
  source: Record<string, any>
): Record<string, any> {
  const result: Record<string, any> = isPlainObject(target) ? { ...target } : {};

  if (!isPlainObject(source)) {
    return result;
  }

  for (const key of Object.keys(source)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const sourceVal = source[key];
    const targetVal = result[key];

    if (isPlainObject(sourceVal)) {
      result[key] = deepMerge(isPlainObject(targetVal) ? targetVal : undefined, sourceVal);
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}

/**
 * Immutably sets a value at a dot-notated path in a nested object.
 * If both the existing leaf and the new value are plain objects, they are deep-merged.
 */
export function setNestedValue(
  target: Record<string, any> | undefined,
  path: string,
  value: any
): Record<string, any> {
  const base: Record<string, any> = isPlainObject(target) ? { ...target } : {};
  if (!path) {
    return isPlainObject(value) ? deepMerge(base, value) : base;
  }

  const parts = path.split('.');
  if (parts.some((part) => !part || UNSAFE_KEYS.has(part))) {
    return base;
  }

  let current: Record<string, any> = base;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const existing = current[part];
    const next = isPlainObject(existing) ? { ...existing } : {};
    current[part] = next;
    current = next;
  }

  const leaf = parts[parts.length - 1];
  const existingLeaf = current[leaf];
  if (isPlainObject(existingLeaf) && isPlainObject(value)) {
    current[leaf] = deepMerge(existingLeaf, value);
  } else if (isPlainObject(value)) {
    current[leaf] = deepMerge(undefined, value);
  } else {
    current[leaf] = value;
  }

  return base;
}

/**
 * Resolves a dot-notated string path in a nested translation object.
 */
export function getNestedValue(obj: Record<string, any> | undefined, path: string): any {
  if (!obj) return undefined;
  
  const parts = path.split('.');
  let current: any = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }
  
  return current;
}

/**
 * Replaces placeholders like {param} or {{param}} in a translation string with dynamic values.
 */
export function interpolate(text: string, params?: Record<string, any>): string {
  if (typeof text !== 'string' || !params) {
    return text;
  }
  
  // Matches {variable} or {{variable}}
  return text.replace(/\{\{?([a-zA-Z0-9_\-\.]+)\}?\}/g, (match, key) => {
    const trimmedKey = key.trim();
    return trimmedKey in params ? String(params[trimmedKey]) : match;
  });
}

export function detectBrowserLanguage(supported: string[], defaultLang: string): string {
  if (typeof navigator === 'undefined') {
    return defaultLang;
  }
  
  const navLangs = navigator.languages || [navigator.language];
  
  for (const lang of navLangs) {
    if (!lang) continue;
    
    // 1. Exact match (e.g. 'en-US' -> 'en-US')
    if (supported.includes(lang)) {
      return lang;
    }
    
    const base = lang.split('-')[0];
    
    // 2. Base language match (e.g. requested 'fr-CA' -> supported 'fr')
    if (supported.includes(base)) {
      return base;
    }
    
    // 3. Dialect fallback match (e.g. requested 'fr-CA' -> supported 'fr-FR')
    const dialectMatch = supported.find((s) => s.split('-')[0] === base);
    if (dialectMatch) {
      return dialectMatch;
    }
  }
  
  return defaultLang;
}
