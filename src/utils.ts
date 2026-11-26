const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Immutably deep-merges `source` into `target`. Plain objects are merged recursively;
 * primitives and arrays from `source` overwrite `target`.
 * Preserves exact object references for `target` and untouched sibling subtrees when unchanged.
 */
export function deepMerge(
  target: Record<string, any> | undefined,
  source: Record<string, any>
): Record<string, any> {
  const hasTarget = isPlainObject(target);
  if (!isPlainObject(source)) {
    return hasTarget ? target : {};
  }

  let result: Record<string, any> | undefined;

  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    if (UNSAFE_KEYS.has(key)) continue;

    const sourceVal = source[key];
    const targetVal = hasTarget ? target[key] : undefined;

    if (isPlainObject(sourceVal)) {
      const mergedChild = deepMerge(isPlainObject(targetVal) ? targetVal : undefined, sourceVal);
      if (!hasTarget || !isPlainObject(targetVal) || mergedChild !== targetVal) {
        if (!result) result = hasTarget ? { ...target } : {};
        result[key] = mergedChild;
      }
    } else {
      if (!hasTarget || !Object.is(targetVal, sourceVal) || !(key in target)) {
        if (!result) result = hasTarget ? { ...target } : {};
        result[key] = sourceVal;
      }
    }
  }

  return result ?? (hasTarget ? target : {});
}

/**
 * Immutably sets multiple dot-notated path entries in a nested object in one pass.
 * Clones the root and each visited intermediate container at most once per batch.
 */
export function setNestedValues(
  target: Record<string, any> | undefined,
  entries: Record<string, any>
): Record<string, any> {
  const hasTarget = isPlainObject(target);
  if (!isPlainObject(entries)) {
    return hasTarget ? target : {};
  }

  let base: Record<string, any> | undefined;
  const cloned = new WeakSet<object>();

  const ensureBase = (): Record<string, any> => {
    if (!base) {
      base = hasTarget ? { ...target } : {};
      cloned.add(base);
    }
    return base;
  };

  for (const path in entries) {
    if (!Object.prototype.hasOwnProperty.call(entries, path)) continue;
    const value = entries[path];

    if (!path) {
      if (isPlainObject(value)) {
        const currentBase = ensureBase();
        const merged = deepMerge(currentBase, value);
        if (merged !== currentBase) {
          base = merged;
          cloned.add(base);
        }
      }
      continue;
    }

    const parts = path.split('.');
    if (parts.some((part) => !part || UNSAFE_KEYS.has(part))) {
      continue;
    }

    let current = ensureBase();
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const existing = current[part];
      if (isPlainObject(existing)) {
        if (!cloned.has(existing)) {
          const copy = { ...existing };
          cloned.add(copy);
          current[part] = copy;
          current = copy;
        } else {
          current = existing;
        }
      } else {
        const next: Record<string, any> = {};
        cloned.add(next);
        current[part] = next;
        current = next;
      }
    }

    const leaf = parts[parts.length - 1];
    const existingLeaf = current[leaf];
    if (isPlainObject(existingLeaf) && isPlainObject(value)) {
      const mergedLeaf = deepMerge(existingLeaf, value);
      current[leaf] = mergedLeaf;
      cloned.add(mergedLeaf);
    } else if (isPlainObject(value)) {
      const copyLeaf = deepMerge(undefined, value);
      current[leaf] = copyLeaf;
      cloned.add(copyLeaf);
    } else {
      current[leaf] = value;
    }
  }

  return base ?? (hasTarget ? target : {});
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
