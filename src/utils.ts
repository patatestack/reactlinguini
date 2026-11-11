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
