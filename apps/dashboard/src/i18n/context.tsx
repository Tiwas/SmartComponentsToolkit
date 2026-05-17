import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Language } from "@homey-toolbox/dashboard-shared";
import { interpolate, STRINGS, type Strings } from "./strings";

interface I18nValue {
  lang: Language;
  t: Strings;
  /** Template-friendly: t("ctx_move_to", { name: folder.name }) → "Move to Living room" */
  tf: (key: keyof Strings, vars: Record<string, string>) => string;
}

const I18nContext = createContext<I18nValue>({
  lang: "en",
  t: STRINGS.en,
  tf: (key, vars) => interpolate(STRINGS.en[key], vars),
});

export function I18nProvider({ lang, children }: { lang: Language; children: ReactNode }) {
  const value = useMemo<I18nValue>(() => {
    const t = STRINGS[lang] ?? STRINGS.en;
    return {
      lang,
      t,
      tf: (key, vars) => interpolate(t[key], vars),
    };
  }, [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
