/**
 * Clodds i18n - Lightweight internationalization
 *
 * Usage:
 *   import { t, setLocale, getLocale } from './i18n';
 *
 *   t('welcome');                    // "Welcome to Clodds"
 *   t('greeting', { name: 'Alex' }); // "Hello, Alex!"
 *   t('errors.notFound');            // Nested keys supported
 *
 * Configuration:
 *   - Environment: CLODDS_LOCALE=zh
 *   - Config: { "locale": "zh" }
 *   - Runtime: setLocale('zh')
 *
 * Adding languages:
 *   1. Create src/i18n/locales/{code}.json
 *   2. Add to SUPPORTED_LOCALES below
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Supported locales
export const SUPPORTED_LOCALES = ['en', 'zh', 'es', 'ja', 'ko', 'de', 'fr', 'pt', 'ru', 'ar'] as const;
export type Locale = typeof SUPPORTED_LOCALES[number];

// Default locale
const DEFAULT_LOCALE: Locale = 'en';

// Current locale state
let currentLocale: Locale = DEFAULT_LOCALE;

// Loaded translations cache
const translationsCache: Map<Locale, Record<string, unknown>> = new Map();

// Locale directory
const LOCALES_DIR = join(__dirname, 'locales');

/**
 * Load translations for a locale
 */
function loadTranslations(locale: Locale): Record<string, unknown> {
  if (translationsCache.has(locale)) {
    return translationsCache.get(locale)!;
  }

  const filePath = join(LOCALES_DIR, `${locale}.json`);

  if (!existsSync(filePath)) {
    // Fallback to English if locale file doesn't exist
    if (locale !== DEFAULT_LOCALE) {
      return loadTranslations(DEFAULT_LOCALE);
    }
    return {};
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const translations = JSON.parse(content);
    translationsCache.set(locale, translations);
    return translations;
  } catch (err) {
    console.error(`Failed to load locale ${locale}: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === 'string' ? current : undefined;
}

/**
 * Interpolate variables in a string
 * "Hello, {name}!" + { name: "Alex" } => "Hello, Alex!"
 */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;

  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return vars[key] !== undefined ? String(vars[key]) : match;
  });
}

/**
 * Translate a key
 *
 * @param key - Translation key (supports dot notation: "errors.notFound")
 * @param vars - Variables to interpolate
 * @returns Translated string or key if not found
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const translations = loadTranslations(currentLocale);
  let value = getNestedValue(translations, key);

  // Fallback to English if not found in current locale
  if (value === undefined && currentLocale !== DEFAULT_LOCALE) {
    const enTranslations = loadTranslations(DEFAULT_LOCALE);
    value = getNestedValue(enTranslations, key);
  }

  // Return key if still not found
  if (value === undefined) {
    return key;
  }

  return interpolate(value, vars);
}

/**
 * Set the current locale
 */
export function setLocale(locale: string): boolean {
  const normalized = locale.toLowerCase().split('-')[0] as Locale;

  if (SUPPORTED_LOCALES.includes(normalized)) {
    currentLocale = normalized;
    return true;
  }

  return false;
}

/**
 * Get the current locale
 */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Get all supported locales with their display names
 */
export function getSupportedLocales(): Array<{ code: Locale; name: string; nativeName: string }> {
  return [
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'zh', name: 'Chinese', nativeName: '中文' },
    { code: 'es', name: 'Spanish', nativeName: 'Español' },
    { code: 'ja', name: 'Japanese', nativeName: '日本語' },
    { code: 'ko', name: 'Korean', nativeName: '한국어' },
    { code: 'de', name: 'German', nativeName: 'Deutsch' },
    { code: 'fr', name: 'French', nativeName: 'Français' },
    { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
    { code: 'ru', name: 'Russian', nativeName: 'Русский' },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  ];
}

/**
 * Initialize i18n from environment or config
 */
export function initI18n(config?: { locale?: string }): void {
  // Priority: config > env > default
  const locale = config?.locale
    || process.env.CLODDS_LOCALE
    || process.env.LANG?.split('.')[0]?.split('_')[0]
    || DEFAULT_LOCALE;

  setLocale(locale);
}

/**
 * Check if a locale is supported
 */
export function isLocaleSupported(locale: string): boolean {
  const normalized = locale.toLowerCase().split('-')[0] as Locale;
  return SUPPORTED_LOCALES.includes(normalized);
}

/**
 * Detect user's preferred locale from various sources
 */
export function detectLocale(sources: {
  header?: string;      // Accept-Language header
  query?: string;       // ?lang=zh
  cookie?: string;      // Cookie value
  userSetting?: string; // User's saved preference
}): Locale {
  // Priority: userSetting > query > cookie > header > default
  const candidates = [
    sources.userSetting,
    sources.query,
    sources.cookie,
    ...(sources.header?.split(',').map(l => l.split(';')[0].trim()) || []),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && isLocaleSupported(candidate)) {
      return candidate.toLowerCase().split('-')[0] as Locale;
    }
  }

  return DEFAULT_LOCALE;
}

// Export types
export type { Locale as LocaleType };
