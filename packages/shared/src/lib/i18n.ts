/**
 * i18n — Internationalization helpers for Golems ecosystem
 *
 * Provides Hebrew + English locale support, RTL detection,
 * locale-aware date formatting, and translation lookup.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Locale = "en" | "he";
export type Direction = "ltr" | "rtl";

export interface TranslationEntry {
  en: string;
  he: string;
}

export type TranslationKey = keyof typeof TRANSLATIONS;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RTL_LOCALES: Set<Locale> = new Set(["he"]);

const HEBREW_MONTHS: string[] = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

const HEBREW_DAYS: string[] = [
  "ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת",
];

const HEBREW_SHORT_DAYS: string[] = [
  "א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳",
];

const ENGLISH_MONTHS: string[] = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ENGLISH_SHORT_MONTHS: string[] = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const ENGLISH_DAYS: string[] = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

// ---------------------------------------------------------------------------
// Translations — Golems UI strings
// ---------------------------------------------------------------------------

export const TRANSLATIONS = {
  // Status
  "status.running": { en: "Running", he: "פעיל" },
  "status.stopped": { en: "Stopped", he: "מושבת" },
  "status.scheduled": { en: "Scheduled", he: "מתוזמן" },
  "status.unknown": { en: "Unknown", he: "לא ידוע" },
  "status.healthy": { en: "Healthy", he: "תקין" },
  "status.degraded": { en: "Degraded", he: "מופחת" },
  "status.error": { en: "Error", he: "שגיאה" },

  // Golems
  "golem.claude": { en: "ClaudeGolem", he: "גולם-קלוד" },
  "golem.telegram": { en: "Telegram Bot", he: "בוט טלגרם" },
  "golem.nightshift": { en: "Night Shift", he: "משמרת לילה" },
  "golem.email": { en: "Email Golem", he: "גולם-אימייל" },
  "golem.job": { en: "Job Golem", he: "גולם-עבודה" },
  "golem.recruiter": { en: "Recruiter Golem", he: "גולם-מגייס" },
  "golem.teller": { en: "Teller Golem", he: "גולם-כספים" },
  "golem.maintainer": { en: "Maintainer Golem", he: "גולם-תחזוקה" },

  // Dashboard
  "dashboard.title": { en: "Golem Dashboard", he: "לוח בקרה" },
  "dashboard.services": { en: "Services", he: "שירותים" },
  "dashboard.config": { en: "Configuration", he: "הגדרות" },
  "dashboard.health": { en: "System Health", he: "בריאות מערכת" },
  "dashboard.lastCheck": { en: "Last checked", he: "בדיקה אחרונה" },

  // Queue
  "queue.title": { en: "Chat Queue", he: "תור הודעות" },
  "queue.empty": { en: "No messages in queue", he: "אין הודעות בתור" },
  "queue.queued": { en: "Queued", he: "בתור" },
  "queue.seen": { en: "Seen", he: "נצפה" },
  "queue.sent": { en: "Sent", he: "נשלח" },
  "queue.edited": { en: "Edited", he: "נערך" },
  "queue.active": { en: "Active", he: "פעיל" },

  // Exploration
  "explore.title": { en: "Explorations", he: "סקירות" },
  "explore.none": { en: "No explorations yet", he: "אין סקירות עדיין" },
  "explore.findings": { en: "Findings", he: "ממצאים" },
  "explore.templates": { en: "Templates", he: "תבניות" },

  // Wizard
  "wizard.title": { en: "Setup Wizard", he: "אשף הגדרה" },
  "wizard.complete": { en: "Setup complete", he: "ההגדרה הושלמה" },
  "wizard.step": { en: "Step", he: "שלב" },

  // Common
  "common.yes": { en: "Yes", he: "כן" },
  "common.no": { en: "No", he: "לא" },
  "common.cancel": { en: "Cancel", he: "ביטול" },
  "common.save": { en: "Save", he: "שמירה" },
  "common.delete": { en: "Delete", he: "מחיקה" },
  "common.edit": { en: "Edit", he: "עריכה" },
  "common.loading": { en: "Loading...", he: "טוען..." },
  "common.noData": { en: "No data", he: "אין נתונים" },

  // Time
  "time.ago": { en: "ago", he: "לפני" },
  "time.now": { en: "just now", he: "עכשיו" },
  "time.minutes": { en: "minutes", he: "דקות" },
  "time.hours": { en: "hours", he: "שעות" },
  "time.days": { en: "days", he: "ימים" },
} as const;

// ---------------------------------------------------------------------------
// Locale detection
// ---------------------------------------------------------------------------

let currentLocale: Locale = "en";

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function getDirection(locale?: Locale): Direction {
  return RTL_LOCALES.has(locale || currentLocale) ? "rtl" : "ltr";
}

export function isRTL(locale?: Locale): boolean {
  return getDirection(locale) === "rtl";
}

export function detectLocale(): Locale {
  const env = process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || "";
  if (env.startsWith("he")) return "he";
  return "en";
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

export function t(key: TranslationKey, locale?: Locale): string {
  const entry = TRANSLATIONS[key];
  if (!entry) return key;
  const l = locale || currentLocale;
  return entry[l] || entry.en;
}

export function tWith(key: TranslationKey, replacements: Record<string, string>, locale?: Locale): string {
  let text = t(key, locale);
  for (const [k, v] of Object.entries(replacements)) {
    text = text.replace(`{${k}}`, v);
  }
  return text;
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

export function formatDate(date: Date | string, locale?: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const l = locale || currentLocale;

  if (l === "he") {
    const day = d.getDate();
    const month = HEBREW_MONTHS[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ב${month} ${year}`;
  }

  const month = ENGLISH_MONTHS[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  return `${month} ${day}, ${year}`;
}

export function formatShortDate(date: Date | string, locale?: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const l = locale || currentLocale;

  if (l === "he") {
    const day = d.getDate();
    const month = HEBREW_MONTHS[d.getMonth()];
    return `${day} ${month}`;
  }

  const month = ENGLISH_SHORT_MONTHS[d.getMonth()];
  const day = d.getDate();
  return `${month} ${day}`;
}

export function formatTime(date: Date | string, locale?: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function formatDateTime(date: Date | string, locale?: Locale): string {
  return `${formatDate(date, locale)} ${formatTime(date, locale)}`;
}

export function formatDayOfWeek(date: Date | string, locale?: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const l = locale || currentLocale;

  if (l === "he") {
    return `יום ${HEBREW_DAYS[d.getDay()]}`;
  }
  return ENGLISH_DAYS[d.getDay()];
}

export function formatShortDayOfWeek(date: Date | string, locale?: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const l = locale || currentLocale;

  if (l === "he") {
    return HEBREW_SHORT_DAYS[d.getDay()];
  }
  return ENGLISH_DAYS[d.getDay()].slice(0, 3);
}

export function formatRelativeTime(date: Date | string, locale?: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const l = locale || currentLocale;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return t("time.now", l);

  if (l === "he") {
    if (diffMin < 60) return `${t("time.ago", l)} ${diffMin} ${t("time.minutes", l)}`;
    if (diffHours < 24) return `${t("time.ago", l)} ${diffHours} ${t("time.hours", l)}`;
    return `${t("time.ago", l)} ${diffDays} ${t("time.days", l)}`;
  }

  if (diffMin < 60) return `${diffMin} ${t("time.minutes", l)} ${t("time.ago", l)}`;
  if (diffHours < 24) return `${diffHours} ${t("time.hours", l)} ${t("time.ago", l)}`;
  return `${diffDays} ${t("time.days", l)} ${t("time.ago", l)}`;
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

export function formatNumber(n: number, locale?: Locale): string {
  const l = locale || currentLocale;
  return n.toLocaleString(l === "he" ? "he-IL" : "en-US");
}

export function formatCurrency(amount: number, currency: string = "USD", locale?: Locale): string {
  const l = locale || currentLocale;
  if (l === "he" && currency === "ILS") {
    return `₪${amount.toLocaleString("he-IL", { minimumFractionDigits: 2 })}`;
  }
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// RTL helpers
// ---------------------------------------------------------------------------

export function wrapRTL(text: string, locale?: Locale): string {
  if (isRTL(locale)) {
    return `\u200F${text}\u200F`;
  }
  return text;
}

export function dirAttr(locale?: Locale): string {
  return `dir="${getDirection(locale)}"`;
}

export function alignClass(locale?: Locale): string {
  return isRTL(locale) ? "text-right" : "text-left";
}

// ---------------------------------------------------------------------------
// HTML helpers for admin dashboard
// ---------------------------------------------------------------------------

export function htmlLang(locale?: Locale): string {
  const l = locale || currentLocale;
  return `lang="${l}" dir="${getDirection(l)}"`;
}

export function cssVars(locale?: Locale): string {
  const l = locale || currentLocale;
  const dir = getDirection(l);
  return [
    `--direction: ${dir};`,
    `--text-align: ${dir === "rtl" ? "right" : "left"};`,
    `--flex-direction: ${dir === "rtl" ? "row-reverse" : "row"};`,
    `--margin-start: ${dir === "rtl" ? "margin-right" : "margin-left"};`,
    `--margin-end: ${dir === "rtl" ? "margin-left" : "margin-right"};`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function formatLocaleInfo(locale?: Locale): string {
  const l = locale || currentLocale;
  const lines: string[] = [];
  lines.push(`Locale: ${l}`);
  lines.push(`Direction: ${getDirection(l)}`);
  lines.push(`RTL: ${isRTL(l)}`);
  lines.push(`Sample date: ${formatDate(new Date(), l)}`);
  lines.push(`Sample number: ${formatNumber(1234567.89, l)}`);
  return lines.join("\n");
}

export function getTranslationKeys(): string[] {
  return Object.keys(TRANSLATIONS);
}

export function getTranslationCount(): number {
  return Object.keys(TRANSLATIONS).length;
}
