import { describe, test, expect, beforeEach } from "bun:test";
import {
  setLocale,
  getLocale,
  getDirection,
  isRTL,
  t,
  tWith,
  formatDate,
  formatShortDate,
  formatTime,
  formatDateTime,
  formatDayOfWeek,
  formatShortDayOfWeek,
  formatRelativeTime,
  formatNumber,
  formatCurrency,
  wrapRTL,
  dirAttr,
  alignClass,
  htmlLang,
  cssVars,
  formatLocaleInfo,
  getTranslationKeys,
  getTranslationCount,
  TRANSLATIONS,
} from "@golems/shared/lib/i18n";

beforeEach(() => {
  setLocale("en");
});

// ---------------------------------------------------------------------------
// Locale management
// ---------------------------------------------------------------------------

describe("locale management", () => {
  test("default locale is en", () => {
    expect(getLocale()).toBe("en");
  });

  test("setLocale changes current locale", () => {
    setLocale("he");
    expect(getLocale()).toBe("he");
  });

  test("getDirection returns ltr for en", () => {
    expect(getDirection("en")).toBe("ltr");
  });

  test("getDirection returns rtl for he", () => {
    expect(getDirection("he")).toBe("rtl");
  });

  test("isRTL returns true for Hebrew", () => {
    expect(isRTL("he")).toBe(true);
    expect(isRTL("en")).toBe(false);
  });

  test("getDirection uses current locale when no arg", () => {
    setLocale("he");
    expect(getDirection()).toBe("rtl");
    setLocale("en");
    expect(getDirection()).toBe("ltr");
  });
});

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

describe("translation", () => {
  test("t returns English by default", () => {
    expect(t("status.running")).toBe("Running");
  });

  test("t returns Hebrew when locale is he", () => {
    setLocale("he");
    expect(t("status.running")).toBe("פעיל");
  });

  test("t accepts explicit locale override", () => {
    expect(t("status.running", "he")).toBe("פעיל");
    expect(t("status.running", "en")).toBe("Running");
  });

  test("t returns key when translation missing", () => {
    const result = t("nonexistent.key" as any);
    expect(result).toBe("nonexistent.key");
  });

  test("all translations have both en and he", () => {
    for (const [key, entry] of Object.entries(TRANSLATIONS)) {
      expect(entry.en).toBeTruthy();
      expect(entry.he).toBeTruthy();
    }
  });

  test("golem names are translated", () => {
    expect(t("golem.claude", "en")).toBe("ClaudeGolem");
    expect(t("golem.claude", "he")).toBe("גולם-קלוד");
    expect(t("golem.nightshift", "he")).toBe("משמרת לילה");
  });

  test("dashboard strings are translated", () => {
    expect(t("dashboard.title", "he")).toBe("לוח בקרה");
    expect(t("dashboard.services", "he")).toBe("שירותים");
  });
});

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

describe("date formatting", () => {
  const testDate = new Date("2026-02-08T14:30:00Z");

  test("formatDate English", () => {
    const result = formatDate(testDate, "en");
    expect(result).toContain("February");
    expect(result).toContain("2026");
  });

  test("formatDate Hebrew", () => {
    const result = formatDate(testDate, "he");
    expect(result).toContain("פברואר");
    expect(result).toContain("2026");
  });

  test("formatDate accepts ISO string", () => {
    const result = formatDate("2026-02-08T14:30:00Z", "en");
    expect(result).toContain("February");
  });

  test("formatShortDate English", () => {
    const result = formatShortDate(testDate, "en");
    expect(result).toContain("Feb");
  });

  test("formatShortDate Hebrew", () => {
    const result = formatShortDate(testDate, "he");
    expect(result).toContain("פברואר");
  });

  test("formatTime returns HH:MM", () => {
    const result = formatTime(new Date("2026-02-08T09:05:00"));
    expect(result).toBe("09:05");
  });

  test("formatDateTime combines date and time", () => {
    const result = formatDateTime(testDate, "en");
    expect(result).toContain("February");
    expect(result).toContain(":");
  });

  test("formatDayOfWeek English", () => {
    // 2026-02-08 is a Sunday
    const result = formatDayOfWeek(new Date("2026-02-08"), "en");
    expect(result).toBe("Sunday");
  });

  test("formatDayOfWeek Hebrew", () => {
    const result = formatDayOfWeek(new Date("2026-02-08"), "he");
    expect(result).toContain("יום");
    expect(result).toContain("ראשון");
  });

  test("formatShortDayOfWeek Hebrew uses gershayim", () => {
    const result = formatShortDayOfWeek(new Date("2026-02-08"), "he");
    expect(result).toBe("א׳");
  });

  test("formatShortDayOfWeek English uses 3 chars", () => {
    const result = formatShortDayOfWeek(new Date("2026-02-08"), "en");
    expect(result).toBe("Sun");
  });
});

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

describe("relative time", () => {
  test("formatRelativeTime returns now for recent", () => {
    const result = formatRelativeTime(new Date(), "en");
    expect(result).toBe("just now");
  });

  test("formatRelativeTime Hebrew now", () => {
    const result = formatRelativeTime(new Date(), "he");
    expect(result).toBe("עכשיו");
  });

  test("formatRelativeTime shows minutes in English", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60000);
    const result = formatRelativeTime(fiveMinAgo, "en");
    expect(result).toContain("5");
    expect(result).toContain("minutes");
    expect(result).toContain("ago");
  });

  test("formatRelativeTime shows minutes in Hebrew (prefix)", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60000);
    const result = formatRelativeTime(fiveMinAgo, "he");
    expect(result).toContain("5");
    expect(result).toContain("דקות");
    // Hebrew: "לפני 5 דקות" (ago comes first)
    expect(result.startsWith("לפני")).toBe(true);
  });

  test("formatRelativeTime shows hours", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600000);
    const result = formatRelativeTime(twoHoursAgo, "en");
    expect(result).toContain("2");
    expect(result).toContain("hours");
  });

  test("formatRelativeTime shows days", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
    const result = formatRelativeTime(threeDaysAgo, "en");
    expect(result).toContain("3");
    expect(result).toContain("days");
  });
});

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

describe("number formatting", () => {
  test("formatNumber English uses commas", () => {
    const result = formatNumber(1234567, "en");
    expect(result).toContain(",");
  });

  test("formatCurrency USD", () => {
    const result = formatCurrency(42.5, "USD", "en");
    expect(result).toContain("$");
    expect(result).toContain("42.50");
  });

  test("formatCurrency ILS Hebrew", () => {
    const result = formatCurrency(42.5, "ILS", "he");
    expect(result).toContain("₪");
  });
});

// ---------------------------------------------------------------------------
// RTL helpers
// ---------------------------------------------------------------------------

describe("RTL helpers", () => {
  test("wrapRTL adds RTL marks for Hebrew", () => {
    const result = wrapRTL("שלום", "he");
    expect(result).toContain("\u200F");
  });

  test("wrapRTL returns unchanged for English", () => {
    const result = wrapRTL("Hello", "en");
    expect(result).toBe("Hello");
  });

  test("dirAttr returns correct attribute", () => {
    expect(dirAttr("en")).toBe('dir="ltr"');
    expect(dirAttr("he")).toBe('dir="rtl"');
  });

  test("alignClass returns text alignment", () => {
    expect(alignClass("en")).toBe("text-left");
    expect(alignClass("he")).toBe("text-right");
  });
});

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

describe("HTML helpers", () => {
  test("htmlLang returns lang and dir for English", () => {
    const result = htmlLang("en");
    expect(result).toBe('lang="en" dir="ltr"');
  });

  test("htmlLang returns lang and dir for Hebrew", () => {
    const result = htmlLang("he");
    expect(result).toBe('lang="he" dir="rtl"');
  });

  test("cssVars includes direction properties", () => {
    const enVars = cssVars("en");
    expect(enVars).toContain("--direction: ltr");
    expect(enVars).toContain("--text-align: left");

    const heVars = cssVars("he");
    expect(heVars).toContain("--direction: rtl");
    expect(heVars).toContain("--text-align: right");
    expect(heVars).toContain("row-reverse");
  });
});

// ---------------------------------------------------------------------------
// Info & stats
// ---------------------------------------------------------------------------

describe("info and stats", () => {
  test("formatLocaleInfo shows locale details", () => {
    const result = formatLocaleInfo("en");
    expect(result).toContain("Locale: en");
    expect(result).toContain("Direction: ltr");
    expect(result).toContain("RTL: false");
  });

  test("formatLocaleInfo Hebrew", () => {
    const result = formatLocaleInfo("he");
    expect(result).toContain("Locale: he");
    expect(result).toContain("Direction: rtl");
    expect(result).toContain("RTL: true");
  });

  test("getTranslationKeys returns all keys", () => {
    const keys = getTranslationKeys();
    expect(keys).toContain("status.running");
    expect(keys).toContain("golem.claude");
    expect(keys.length).toBeGreaterThan(30);
  });

  test("getTranslationCount matches keys length", () => {
    expect(getTranslationCount()).toBe(getTranslationKeys().length);
  });
});
