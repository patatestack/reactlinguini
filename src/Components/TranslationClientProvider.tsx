import React from 'react';
import { TranslationNamespaceObserver } from '..';
import { TranslationClient } from '../Core/translationClient';
import { createTranslationNamespaceObserver } from '../Core/translationObserver';

const context = React.createContext<TranslationClient | undefined>(undefined)

export function TranslationClientProvider(children: React.ReactElement, client: TranslationClient) {
  return <context.Provider value={client}>{children}</context.Provider>
}

export const useTranslationClient = (): TranslationClient => {
  const translationClient = React.useContext(context);

  if (!translationClient) {
    throw new Error('No translationClient set, use TranslationClientProvider to set one')
  }

  return translationClient
}

export function useTranslations(namespaceName: string) {
  const client = useTranslationClient();

  const [, rerender] = React.useReducer((i: number) => i + 1, 0);

  const observerRef = React.useRef<TranslationNamespaceObserver>();
  if (!observerRef.current) {
    observerRef.current = createTranslationNamespaceObserver(client, namespaceName);
  }

  React.useEffect(() => {
    return observerRef.current?.subscribe(rerender);
  }, [])

  return observerRef.current.getResult();
}