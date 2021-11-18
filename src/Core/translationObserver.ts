import { TranslationClient } from "./translationClient";
import { TranslationNamespaceObserver } from "../Models";

export function createTranslationNamespaceObserver(client: TranslationClient, namespaceName: string): TranslationNamespaceObserver {
  const namespace = client.getNamespace(namespaceName);

  const observer = {
    notify: () => {},
    getResult: () => namespace.state,
    subscribe: (callback: () => void) => {
      observer.notify = callback;
      const unsub = namespace.subscribe(observer);

      namespace.load();

      return unsub;
    }
  };

  return observer;
}
