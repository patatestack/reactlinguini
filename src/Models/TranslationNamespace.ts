import { TranslationNamespaceObserver } from "./TranslationNamespaceObserver"
import { TranslationNamespaceState } from "./TranslationNamespaceState"

export interface TranslationNamespace {
  promise: Promise<void> | null,
  name: string,
  language: string,
  versionKey?: string,
  subscribers: TranslationNamespaceObserver[],
  state: TranslationNamespaceState,
  subscribe: (subscriber: TranslationNamespaceObserver) => () => void,
  setState: (updater: (oldState: TranslationNamespaceState) => TranslationNamespaceState) => void,
  changeLanguage: (language: string) => void,
  load: () => void
}
