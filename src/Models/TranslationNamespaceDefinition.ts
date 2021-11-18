export interface TranslationNamespaceDefinition {
  namespaceName: string,
  versionKey?: string,
  loaderFn: (namespaceName: string, languageKey: string, versionKey?: string) => Promise<any>
}
