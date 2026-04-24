/**
 * Locale-aware formatting helpers.
 *
 * - Currency / number: use `Intl.NumberFormat(locale)` with a Latin-digit
 *   override for Arabic/Persian/etc. Finance UX reads better with Western
 *   digits even in RTL locales; internal pref confirmed with Arabic users
 *   (iUSD is a USD stablecoin).
 * - Dates: use `Intl.DateTimeFormat(locale)` with style shortcuts.
 *
 * Hooks: `useFormat()` returns formatters bound to the current i18n.language.
 * For one-off calls outside React, import the raw `format*` functions.
 */
import { useTranslation } from 'react-i18next'
import { useMemo } from 'react'

/**
 * Override the numberingSystem so RTL locales still render Western digits.
 * Safe for all locales because 'latn' is a universally supported fallback.
 */
const NUMBER_OPTS: Intl.NumberFormatOptions = { numberingSystem: 'latn' } as any

export function formatNumber(
  value: number,
  locale: string,
  opts: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(locale, { ...NUMBER_OPTS, ...opts }).format(value)
}

/** Format iUSD amounts with a fixed 2-decimal style (or pass customization). */
export function formatIUSD(
  value: number,
  locale: string,
  opts: Intl.NumberFormatOptions = {},
): string {
  return formatNumber(value, locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
    ...opts,
  })
}

/**
 * Format a Date (or ISO string / ms) for display. Defaults to a short
 * date+time. Uses local timezone unless the caller overrides.
 */
export function formatDateTime(
  date: Date | string | number,
  locale: string,
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  const d = typeof date === 'object' ? date : new Date(date)
  return new Intl.DateTimeFormat(locale, opts).format(d)
}

/** "3 minutes ago" style relative time. Falls back to absolute when > 7 days. */
export function formatRelative(
  date: Date | string | number,
  locale: string,
): string {
  const d = typeof date === 'object' ? date : new Date(date)
  const diffMs = d.getTime() - Date.now()
  const diffSec = Math.round(diffMs / 1000)
  const absSec = Math.abs(diffSec)

  // Beyond a week: just show the date.
  if (absSec > 7 * 24 * 3600) {
    return formatDateTime(d, locale, { dateStyle: 'medium' })
  }

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (absSec < 60)   return rtf.format(diffSec, 'second')
  if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), 'minute')
  if (absSec < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour')
  return rtf.format(Math.round(diffSec / 86400), 'day')
}

/** React hook — returns formatters bound to the current language. */
export function useFormat() {
  const { i18n } = useTranslation()
  const locale = i18n.language || 'en'
  return useMemo(() => ({
    locale,
    num:  (v: number, o?: Intl.NumberFormatOptions) => formatNumber(v, locale, o),
    iusd: (v: number, o?: Intl.NumberFormatOptions) => formatIUSD(v, locale, o),
    date: (d: Date | string | number, o?: Intl.DateTimeFormatOptions) => formatDateTime(d, locale, o),
    rel:  (d: Date | string | number) => formatRelative(d, locale),
  }), [locale])
}
