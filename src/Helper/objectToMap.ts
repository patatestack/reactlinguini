import { TranslationMap } from '../Models';

function getProperty<T, K extends keyof T>(o: T, propertyName: K): T[K] {
  return o[propertyName];
}

export function objectToMap(value: Record<string, unknown>): TranslationMap {
  const newMap = new TranslationMap();

  Object.keys(value).forEach((key) => {
    const innerValue = getProperty<Record<string, any>, any>(value, key);

    if (innerValue instanceof Object) {
      newMap.set(key, objectToMap(innerValue));
    } else {
      newMap.set(key, innerValue as string);
    }
  });

  return newMap;
}
