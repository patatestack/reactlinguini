import React from "react";
import { useReducer, useRef } from "react";
import { TranslationNamespaceObserver, useTranslationClient } from ".."
import { createTranslationNamespaceObserver } from "../Core/translationObserver";

export function useTranslations(namespaceName: string) {
    const client = useTranslationClient();
  
    const [, rerender] = useReducer((i: number) => i + 1, 0);
  
    const observerRef = useRef<TranslationNamespaceObserver>();
    if (!observerRef.current) {
      observerRef.current = createTranslationNamespaceObserver(client, namespaceName);
    }
  
    React.useEffect(() => {
      return observerRef.current?.subscribe(rerender);
    }, [])
  
    return observerRef.current.getResult();
  }