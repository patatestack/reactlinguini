import { getTranslation, objectToMap } from "../Helper";
import { TranslationMap, TranslationNamespace, TranslationNamespaceDefinition, TranslationNamespaceStatus } from "../Models";

function initializeTranslationNamespaceFromDefinitions(client: TranslationClient, namespaceDefinitions: TranslationNamespaceDefinition[]) {
  return namespaceDefinitions.map((definition) => createTranslationNamespace(client, definition));
}
  
function createTranslationNamespace(client: TranslationClient, { namespaceName, versionKey, loaderFn }: TranslationNamespaceDefinition): TranslationNamespace {
  let namespace: TranslationNamespace = {
    promise: null,
    name: namespaceName,
    language: client.getLanguageKey(),
    versionKey,
    subscribers: [],
    state: {
      status: TranslationNamespaceStatus.Loading,
      isReady: false,
      isLoading: true,
      translationMap: undefined,
      error: undefined,
      t: (key: string, defaultValue?: string) => getTranslation(key, namespace.state.translationMap as TranslationMap) ?? defaultValue
    },
    subscribe: (subscriber) => {
      namespace.subscribers.push(subscriber);

      return () => {
        namespace.subscribers = namespace.subscribers.filter((itemSubscriber) => itemSubscriber !== subscriber)
      };
    },
    setState: (updater) => {
      namespace.state = updater(namespace.state);
      namespace.subscribers.forEach((subscriber) => {
        subscriber.notify();
      });
    },
    changeLanguage: (language: string) => {
      if (namespace.language !== language) {
        namespace.load();
        namespace.setState((old) => ({
          ...old,
          language
        }));
      }
    },
    load: () => {
      if (!namespace.promise) {
        namespace.promise = (async (): Promise<void> => {
          namespace.setState(old => ({
            ...old,
            isReady: false,
            isLoading: true,
            error: undefined
          }));

          try {
            const translations = await loaderFn(namespace.name, namespace.language, namespace.versionKey);
            const translationMap = objectToMap(translations);
            namespace.setState((old) => ({
              ...old,
              status: TranslationNamespaceStatus.Success,
              isReady: true,
              translationMap
            }));
          }
          catch (error: any) {
            namespace.setState((old) => ({
              ...old,
              status: TranslationNamespaceStatus.Error,
              isReady: false,
              error
            }));
          }
          finally {
            namespace.promise = null;
            namespace.setState((old) => ({
              ...old,
              isLoading: false
            }));
          }
        })();
      }

      return namespace.promise;
    }
  }

  return namespace;
}

export class TranslationClient {
  private namespaces;
  private currentLanguageKey;
  private blankNamespace = createTranslationNamespace(this, { namespaceName: '___blank__', loaderFn: () => Promise.resolve(() => {})})

  constructor(currentLanguageKey: string, namespaceDefinitions: TranslationNamespaceDefinition[]) {
    this.currentLanguageKey = currentLanguageKey;
    this.namespaces = initializeTranslationNamespaceFromDefinitions(this, namespaceDefinitions);
  }

  setLanguageKey = (languageKey: string) => {
    this.namespaces.forEach(namespace => {
      namespace.changeLanguage(languageKey);
    });
    this.currentLanguageKey = languageKey;
  }

  getLanguageKey = () => this.currentLanguageKey;

  getNamespace = (namespaceName: string) => {
    let namespace = this.namespaces.find((itemNamespace) => itemNamespace.name === namespaceName);

    if (!namespace) {
      console.warn('No namespace defined with that name');
      return this.blankNamespace;
    }

    return namespace;
  }
}