import { TFunc } from ".";
import { TranslationMap } from "./TranslationMap"

export interface TranslationNamespaceState {
  status: TranslationNamespaceStatus,
  isReady: boolean,
  isLoading: boolean,
  translationMap?: TranslationMap,
  t: TFunc,
  error?: Error
}

export enum TranslationNamespaceStatus {
  Loading = 'loading',
  Success = 'success',
  Error = 'error'
}
