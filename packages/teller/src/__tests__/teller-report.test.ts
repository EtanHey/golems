import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import * as supabaseFactory from "@golems/shared/lib/supabase-factory";
import * as tellerDb from "@golems/teller/db";
import {
  generateMonthlyReport,
  generateTaxReport,
  formatMonthlyReportText,
  formatTaxReportText,
} from "@golems/teller/report";

let mockPaymentsData: any[] = [];

const mockLte = mock(() => Promise.resolve({ data: mockPaymentsData, error: null }));
const mockGte = mock(() => ({ lte: mockLte }));
const mockSelect = mock(() => ({ gte: mockGte }));
const mockFrom = mock(() => ({ select: mockSelect }));
const mockDbClient = { from: mockFrom };

describe("TellerGolem Report", () => {
  beforeEach(() => {
    mockPaymentsData = [];
    mockFrom.mockClear();
    mockSelect.mockClear();
    mockGte.mockClear();
    mockLte.mockClear();
    // Mock supabase-factory to return our mock client
    spyOn(supabaseFactory, "getSupabase").mockReturnValue(mockDbClient as any);
    // Mock teller-golem/db getSubscriptionSummary
    spyOn(tellerDb, "getSubscriptionSummary").mockImplementation(async () => ({
      totalMonthly: 50,
      services: [{ name: "Netflix" }, { name: "Spotify" }] as any[],
      newThisMonth: [],
      cancelledThisMonth: [],
    }));
  });

  afterEach(() => {
    mock.restore();
  });

  describe("generateMonthlyReport", () => {
    test("aggregates payments correctly", async () => {
      mockPaymentsData = [
        { date: "2026-01-05", amount: 15.99, service_name: "Netflix", tax_category: "software" },
        { date: "2026-01-10", amount: 9.99, service_name: "Spotify", tax_category: "software" },
        { date: "2026-01-15", amount: 45.00, service_name: "WeWork", tax_category: "office" },
        { date: "2026-01-20", amount: 12.50, service_name: "Netflix", tax_category: "software" },
      ];

      const report = await generateMonthlyReport("2026-01");

      expect(report.month).toBe("2026-01");
      expect(report.totalSpend).toBeCloseTo(83.48, 2);
      expect(report.byCategory.software).toBeCloseTo(38.48, 2);
      expect(report.byCategory.office).toBeCloseTo(45.0, 2);
      expect(report.byCategory.advertising).toBe(0);
      expect(report.byVendor["Netflix"]).toBeCloseTo(28.49, 2);
      expect(report.byVendor["Spotify"]).toBeCloseTo(9.99, 2);
      expect(report.byVendor["WeWork"]).toBeCloseTo(45.0, 2);
      expect(report.subscriptionCount).toBe(2);
    });

    test("returns empty report when no data", async () => {
      mockPaymentsData = [];

      const report = await generateMonthlyReport("2026-03");

      expect(report.month).toBe("2026-03");
      expect(report.totalSpend).toBe(0);
      expect(report.byCategory.software).toBe(0);
      expect(report.byCategory.other).toBe(0);
      expect(Object.keys(report.byVendor)).toHaveLength(0);
      expect(report.subscriptionCount).toBe(0);
    });

    test("handles null category as other", async () => {
      mockPaymentsData = [
        { date: "2026-02-01", amount: 20, service_name: "RandomShop", tax_category: null },
      ];

      const report = await generateMonthlyReport("2026-02");

      expect(report.byCategory.other).toBe(20);
      expect(report.totalSpend).toBe(20);
    });
  });

  describe("generateTaxReport", () => {
    test("groups by category with item details", async () => {
      mockPaymentsData = [
        { date: "2026-03-01", amount: 100, service_name: "Google Ads", tax_category: "advertising" },
        { date: "2026-06-15", amount: 200, service_name: "Facebook Ads", tax_category: "advertising" },
        { date: "2026-09-01", amount: 50, service_name: "Udemy", tax_category: "education" },
      ];

      const report = await generateTaxReport(2026);

      expect(report.year).toBe(2026);
      expect(report.totalDeductible).toBe(350);
      expect(report.byCategory.advertising.total).toBe(300);
      expect(report.byCategory.advertising.items).toHaveLength(2);
      expect(report.byCategory.advertising.items[0]).toEqual({ vendor: "Google Ads", amount: 100 });
      expect(report.byCategory.advertising.items[1]).toEqual({ vendor: "Facebook Ads", amount: 200 });
      expect(report.byCategory.education.total).toBe(50);
      expect(report.byCategory.education.items).toHaveLength(1);
      expect(report.byCategory.office.total).toBe(0);
      expect(report.byCategory.office.items).toHaveLength(0);
    });

    test("returns empty report when no data", async () => {
      mockPaymentsData = [];

      const report = await generateTaxReport(2025);

      expect(report.year).toBe(2025);
      expect(report.totalDeductible).toBe(0);
      expect(report.byCategory.software.total).toBe(0);
      expect(report.byCategory.software.items).toHaveLength(0);
    });
  });

  describe("formatMonthlyReportText", () => {
    test("produces readable output", () => {
      const report = {
        month: "2026-01",
        totalSpend: 83.48,
        byCategory: {
          advertising: 0, insurance: 0, office: 45, software: 38.48,
          education: 0, travel: 0, meals: 0, "professional-services": 0, other: 0,
        } as any,
        byVendor: { Netflix: 28.49, Spotify: 9.99, WeWork: 45 },
        subscriptionCount: 2,
      };

      const text = formatMonthlyReportText(report);

      expect(text).toContain("Monthly Report: 2026-01");
      expect(text).toContain("Total Spend: $83.48");
      expect(text).toContain("Active Subscriptions: 2");
      expect(text).toContain("software: $38.48");
      expect(text).toContain("office: $45.00");
      expect(text).toContain("Netflix: $28.49");
      expect(text).not.toContain("advertising");
    });
  });

  describe("formatTaxReportText", () => {
    test("produces readable output", () => {
      const report = {
        year: 2026,
        totalDeductible: 350,
        byCategory: {
          advertising: { total: 300, items: [{ vendor: "Google Ads", amount: 100 }, { vendor: "Facebook Ads", amount: 200 }] },
          insurance: { total: 0, items: [] },
          office: { total: 0, items: [] },
          software: { total: 0, items: [] },
          education: { total: 50, items: [{ vendor: "Udemy", amount: 50 }] },
          travel: { total: 0, items: [] },
          meals: { total: 0, items: [] },
          "professional-services": { total: 0, items: [] },
          other: { total: 0, items: [] },
        } as any,
      };

      const text = formatTaxReportText(report);

      expect(text).toContain("Tax Report: 2026");
      expect(text).toContain("Total Deductible: $350.00");
      expect(text).toContain("advertising: $300.00");
      expect(text).toContain("- Google Ads: $100.00");
      expect(text).toContain("- Facebook Ads: $200.00");
      expect(text).toContain("education: $50.00");
      expect(text).toContain("- Udemy: $50.00");
      expect(text).not.toContain("insurance");
    });
  });
});
