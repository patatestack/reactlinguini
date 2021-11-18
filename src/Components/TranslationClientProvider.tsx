import React from 'react';
import { TranslationClient } from '../Core/translationClient';

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