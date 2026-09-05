/**
 * Green Invoice API Types
 *
 * Based on Green Invoice REST API v1 (api.greeninvoice.co.il/api/v1).
 * Document types, payment types, and request/response interfaces.
 */

// --- Enums ---

export const DocumentType = {
  PRICE_QUOTE: 10,
  ORDER: 100,
  DELIVERY_NOTE: 200,
  RETURN_DELIVERY_NOTE: 210,
  TRANSACTION_ACCOUNT: 300,
  TAX_INVOICE: 305,
  TAX_INVOICE_RECEIPT: 320,
  REFUND: 330,
  RECEIPT: 400,
  RECEIPT_FOR_DONATION: 405,
  PURCHASE_ORDER: 500,
  RECEIPT_OF_A_DEPOSIT: 600,
  WITHDRAWAL_OF_DEPOSIT: 610,
} as const;

export type DocumentTypeValue =
  (typeof DocumentType)[keyof typeof DocumentType];

export const DocumentTypeLabel: Record<number, string> = {
  10: "Price Quote",
  100: "Order",
  200: "Delivery Note",
  210: "Return Delivery Note",
  300: "Transaction Account",
  305: "Tax Invoice",
  320: "Tax Invoice-Receipt",
  330: "Refund",
  400: "Receipt (Kabala)",
  405: "Receipt for Donation",
  500: "Purchase Order",
  600: "Receipt of a Deposit",
  610: "Withdrawal of Deposit",
};

export const PaymentType = {
  UNPAID: -1,
  DEDUCTION_AT_SOURCE: 0,
  CASH: 1,
  CHECK: 2,
  CREDIT_CARD: 3,
  ELECTRONIC_FUND_TRANSFER: 4,
  PAYPAL: 5,
  PAYMENT_APP: 10,
  OTHER: 11,
} as const;

export const IncomeVatType = {
  DEFAULT: 0,
  INCLUDED: 1,
  EXEMPT: 2,
} as const;

export const PaymentDealType = {
  REGULAR: 1,
  INSTALLMENTS: 2,
  CREDIT: 3,
  BILLING_DECLINED: 4,
  OTHER: 5,
} as const;

export const PaymentCardType = {
  UNKNOWN: 0,
  ISRACARD: 1,
  VISA: 2,
  MASTERCARD: 3,
  AMERICAN_EXPRESS: 4,
  DINERS: 5,
} as const;

// --- Request/Response Interfaces ---

export interface GreenInvoiceConfig {
  apiKeyId: string;
  apiKeySecret: string;
  sandbox?: boolean;
}

export interface IncomeItem {
  description: string;
  quantity: number;
  price: number;
  currency?: string;
  vatType?: number;
  catalogNum?: string;
}

export interface PaymentItem {
  type: number;
  price: number;
  currency?: string;
  date?: string;
  cardNum?: string;
  cardType?: number;
  dealType?: number;
  bankName?: string;
  bankBranch?: string;
  bankAccount?: string;
}

export interface DocumentClient {
  id?: string;
  name?: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  add?: boolean;
}

export interface CreateDocumentRequest {
  type: DocumentTypeValue;
  client: DocumentClient;
  currency?: string;
  lang?: string;
  description?: string;
  remarks?: string;
  income: IncomeItem[];
  payment?: PaymentItem[];
  signed?: boolean;
  rounding?: boolean;
}

export interface DocumentSearchRequest {
  page?: number;
  pageSize?: number;
  type?: number | number[];
  fromDate?: string;
  toDate?: string;
  sort?: string;
}

export interface ClientSearchRequest {
  page?: number;
  pageSize?: number;
  name?: string;
  taxId?: string;
  email?: string;
  sort?: string;
}
