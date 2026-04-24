/**
 * i18n setup — auto-detects browser language, persists user override in
 * localStorage, falls back to English when the detected locale isn't in
 * the supported set. Syncs <html lang/dir> on every change so RTL
 * locales (Arabic) flip the page automatically.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en    from './locales/en.json'
import zhCN  from './locales/zh-CN.json'
import zhTW  from './locales/zh-TW.json'
import ja    from './locales/ja.json'
import ko    from './locales/ko.json'
import th    from './locales/th.json'
import es    from './locales/es.json'
import it    from './locales/it.json'
import fr    from './locales/fr.json'
import de    from './locales/de.json'
import pt    from './locales/pt.json'
import hi    from './locales/hi.json'
import ar    from './locales/ar.json'
import tr    from './locales/tr.json'
import el    from './locales/el.json'
import ru    from './locales/ru.json'
import ms    from './locales/ms.json'
import id    from './locales/id.json'
import fil   from './locales/fil.json'

export const SUPPORTED_LOCALES = [
  { code: 'en',    name: 'English',     native: 'English' },
  { code: 'zh-CN', name: 'Chinese (Simplified)',  native: '简体中文' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', native: '繁體中文' },
  { code: 'ja',    name: 'Japanese',    native: '日本語' },
  { code: 'ko',    name: 'Korean',      native: '한국어' },
  { code: 'th',    name: 'Thai',        native: 'ไทย' },
  { code: 'es',    name: 'Spanish',     native: 'Español' },
  { code: 'it',    name: 'Italian',     native: 'Italiano' },
  { code: 'fr',    name: 'French',      native: 'Français' },
  { code: 'de',    name: 'German',      native: 'Deutsch' },
  { code: 'pt',    name: 'Portuguese',  native: 'Português' },
  { code: 'hi',    name: 'Hindi',       native: 'हिन्दी' },
  { code: 'ar',    name: 'Arabic',      native: 'العربية' },
  { code: 'tr',    name: 'Turkish',     native: 'Türkçe' },
  { code: 'el',    name: 'Greek',       native: 'Ελληνικά' },
  { code: 'ru',    name: 'Russian',     native: 'Русский' },
  { code: 'ms',    name: 'Malay',       native: 'Bahasa Melayu' },
  { code: 'id',    name: 'Indonesian',  native: 'Bahasa Indonesia' },
  { code: 'fil',   name: 'Filipino',    native: 'Filipino' },
] as const

export type LocaleCode = typeof SUPPORTED_LOCALES[number]['code']

const RTL_LOCALES: ReadonlySet<string> = new Set(['ar', 'he', 'fa', 'ur'])

export function isRTL(code: string): boolean {
  return RTL_LOCALES.has(code.split('-')[0])
}

const STORAGE_KEY = 'ipay_lang'
/**
 * Separate flag that records whether the user has explicitly picked a
 * language via Settings / LangSwitcher (source = 'manual') vs having it
 * inferred from navigator on first visit (source = 'auto'). We only
 * preserve the value across reloads when source is 'manual'; auto-detected
 * values are re-read from the browser on every load, so if the user later
 * changes their Safari/Chrome UI language, we follow.
 */
const SOURCE_KEY = 'ipay_lang_source'

function getSource(): 'manual' | 'auto' | null {
  if (typeof localStorage === 'undefined') return null
  const v = localStorage.getItem(SOURCE_KEY)
  return v === 'manual' || v === 'auto' ? v : null
}

/**
 * Runs before i18next detection: if the cached language came from auto
 * detection, drop it so the navigator value is re-read. Manual picks stay.
 */
function clearAutoCache() {
  if (typeof localStorage === 'undefined') return
  if (getSource() === 'manual') return
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(SOURCE_KEY)
}

clearAutoCache()

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'en':    { translation: en    },
      'zh-CN': { translation: zhCN  },
      'zh-TW': { translation: zhTW  },
      'ja':    { translation: ja    },
      'ko':    { translation: ko    },
      'th':    { translation: th    },
      'es':    { translation: es    },
      'it':    { translation: it    },
      'fr':    { translation: fr    },
      'de':    { translation: de    },
      'pt':    { translation: pt    },
      'hi':    { translation: hi    },
      'ar':    { translation: ar    },
      'tr':    { translation: tr    },
      'el':    { translation: el    },
      'ru':    { translation: ru    },
      'ms':    { translation: ms    },
      'id':    { translation: id    },
      'fil':   { translation: fil   },
    },
    // Fallback chain: 'zh' (no region) → try Simplified, then English.
    // Same for Portuguese (pt-BR/pt-PT both fall to pt). Other languages
    // fall to English by default.
    fallbackLng: {
      'zh':    ['zh-CN', 'en'],
      'zh-HK': ['zh-TW', 'en'],
      'zh-MO': ['zh-TW', 'en'],
      'zh-SG': ['zh-CN', 'en'],
      'pt-BR': ['pt', 'en'],
      'pt-PT': ['pt', 'en'],
      'default': ['en'],
    },
    supportedLngs: SUPPORTED_LOCALES.map(l => l.code),
    // false (default) treats 'zh-CN' / 'zh-TW' as fully distinct codes —
    // critical so they don't get collapsed to 'zh' and lose their region
    // when looking up resources.
    nonExplicitSupportedLngs: false,
    // Normalize regions to BCP47 form: lower-case lang, upper-case region
    // ('zh-cn' from navigator → 'zh-CN' to match our resource keys).
    cleanCode: true,
    lowerCaseLng: false,
    load: 'currentOnly',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: STORAGE_KEY,
    },
    react: { useSuspense: false },
  })

function applyHtmlLangDir(lang: string) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.setAttribute('lang', lang)
  root.setAttribute('dir', isRTL(lang) ? 'rtl' : 'ltr')
  // Keep the default English <title> in index.html for SEO indexing, but
  // update document.title on the SPA root routes so users see their
  // language in browser history + pinned tabs. Detail routes (e.g.
  // /pay /gift /receipt) set their own title via page components.
  try {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname
      const isRootish = path === '/' || path === '/app' || path.startsWith('/app/')
      if (isRootish) {
        const tagline = i18n.t('landing.tagline')
        document.title = `iUSD Pay — ${tagline}`
      }
    }
  } catch { /* ignore */ }
}

applyHtmlLangDir(i18n.language || 'en')
i18n.on('languageChanged', applyHtmlLangDir)

/**
 * Patch window.fetch once to inject an Accept-Language header on every
 * request to the iPay API. Server-side errors come back in the user's
 * chosen language without touching every individual fetch site.
 *
 * Only overrides the header when the caller hasn't already set one.
 */
if (typeof window !== 'undefined' && !(window as any).__ipayFetchI18nPatched) {
  const origFetch = window.fetch.bind(window)
  ;(window as any).__ipayFetchI18nPatched = true
  window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    // Only inject for our API (avoid leaking language preference to 3rd-party origins)
    if (url && /\/\/[^/]*iusd-pay\.xyz|\/\/localhost(:\d+)?\/(v1|auth|account|pay|gift|invoice)/i.test(url)) {
      const headers = new Headers(init?.headers || (typeof input === 'object' && 'headers' in input ? (input as Request).headers : undefined))
      if (!headers.has('Accept-Language')) {
        headers.set('Accept-Language', i18n.language || 'en')
      }
      return origFetch(input, { ...(init || {}), headers })
    }
    return origFetch(input, init)
  }
}

// After initial detection, tag whatever i18next settled on with
// source='auto' if we don't already have a manual pick. This preserves
// the "track system language" semantic: next reload will re-detect unless
// the user explicitly picks one via setLocale().
if (typeof localStorage !== 'undefined' && !getSource()) {
  localStorage.setItem(SOURCE_KEY, 'auto')
}

export function setLocale(code: LocaleCode): Promise<unknown> {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SOURCE_KEY, 'manual')
  }
  return i18n.changeLanguage(code)
}

/** Reset to auto-detect (clears the manual flag; system language takes over next load). */
export function resetLocaleToAuto(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(SOURCE_KEY)
  // Best-effort: re-detect synchronously from navigator for immediate feedback
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en') || 'en'
  i18n.changeLanguage(nav)
}

/** True iff the current language was picked manually via setLocale(). */
export function isManualLocale(): boolean {
  return getSource() === 'manual'
}

export default i18n
