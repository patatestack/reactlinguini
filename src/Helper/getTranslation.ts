import { TranslationMap } from '../Models';

export function getTranslation(key: string, translationMap: TranslationMap): string {
  const keyToFind = key.split('.');
  let nextMap: TranslationMap | undefined | string = translationMap;

  for (let i = 0; i < keyToFind.length; i++) {
    if (nextMap instanceof TranslationMap) {
      nextMap = nextMap?.get(keyToFind[i]);
    }
  }

  return (nextMap as string) ?? '';
}
