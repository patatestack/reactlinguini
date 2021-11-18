import { TranslationNamespaceState } from "./TranslationNamespaceState"

export interface TranslationNamespaceObserver {
  notify: () => void,
  getResult: () => TranslationNamespaceState,
  subscribe: (callback: () => void) => () => void
}
