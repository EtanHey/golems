import { describe, it, expect } from "bun:test";
import { DocumentType, DocumentTypeLabel } from "../types";

// Ported from packages/teller's former green-invoice copy.
describe("Green Invoice Types", () => {
  it("has correct document type values", () => {
    expect(DocumentType.RECEIPT).toBe(400);
    expect(DocumentType.TAX_INVOICE_RECEIPT).toBe(320);
    expect(DocumentType.TAX_INVOICE).toBe(305);
    expect(DocumentType.PRICE_QUOTE).toBe(10);
    expect(DocumentType.REFUND).toBe(330);
  });

  it("has labels for all document types", () => {
    for (const [, value] of Object.entries(DocumentType)) {
      expect(DocumentTypeLabel[value]).toBeDefined();
      expect(typeof DocumentTypeLabel[value]).toBe("string");
    }
  });

  it("receipt label says Kabala", () => {
    expect(DocumentTypeLabel[400]).toContain("Kabala");
  });

  it("covers all 13 document types", () => {
    expect(Object.keys(DocumentType)).toHaveLength(13);
    expect(Object.keys(DocumentTypeLabel)).toHaveLength(13);
  });
});
