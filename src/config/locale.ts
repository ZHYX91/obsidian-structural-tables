/** Supported interface locales. Note and table direction remain host-owned. */
export const LOCALES = [
  { id: "en", name: "English", direction: "ltr" },
  { id: "zh-CN", name: "简体中文", direction: "ltr" },
  { id: "zh-TW", name: "繁體中文", direction: "ltr" },
  { id: "ja", name: "日本語", direction: "ltr" },
  { id: "ko", name: "한국어", direction: "ltr" },
  { id: "de", name: "Deutsch", direction: "ltr" },
  { id: "fr", name: "Français", direction: "ltr" },
  { id: "es", name: "Español", direction: "ltr" },
  { id: "pt-BR", name: "Português (Brasil)", direction: "ltr" },
  { id: "ru", name: "Русский", direction: "ltr" },
  { id: "vi", name: "Tiếng Việt", direction: "ltr" },
  { id: "ar", name: "العربية", direction: "rtl" },
] as const;

export type LocaleId = typeof LOCALES[number]["id"];
export type InterfaceLanguage = "auto" | LocaleId;

export function sanitizeInterfaceLanguage(value: unknown): InterfaceLanguage {
  return LOCALES.some((locale) => locale.id === value) ? value as LocaleId : "auto";
}

/** Obsidian uses both short language IDs and BCP 47-style regional IDs. */
export function resolveLocale(language: InterfaceLanguage, hostLanguage: string): LocaleId {
  if (language !== "auto") return language;
  const [base, ...subtags] = hostLanguage.trim().toLowerCase().replace(/_/gu, "-").split("-");
  if (base === "zh") {
    if (subtags.includes("hant")) return "zh-TW";
    if (subtags.includes("hans")) return "zh-CN";
    return subtags.some((part) => part === "tw" || part === "hk" || part === "mo") ? "zh-TW" : "zh-CN";
  }
  // Obsidian may expose pt, pt_BR or pt-BR while the catalog has one regional ID.
  if (base === "pt") return subtags.length === 0 || subtags.includes("br") ? "pt-BR" : "en";
  return LOCALES.find((locale) => locale.id === base)?.id ?? "en";
}
