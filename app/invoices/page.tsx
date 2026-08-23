"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import Badge from "../../components/Badge";
import Button from "../../components/Button";
import Card from "../../components/Card";
import MessageBanner from "../../components/MessageBanner";
import Stat from "../../components/Stat";
import Tabs from "../../components/Tabs";
import QuotationPanel from "./QuotationPanel";

type Tab =
  | "ready"
  | "invoices"
  | "credits"
  | "payments"
  | "statements"
  | "chase"
  | "customer-pos"
  | "quotations"
  | "supplier-pos"
  | "accounting";

type ReadyJob = {
  job_id: string;
  customer_id: string;
  customer_name: string | null;
  job_reference: string | null;
  completed_at: string | null;
  customer_price: number | null;
  pod_status: string | null;
  requires_po: boolean;
  pod_required: boolean;
  invoice_pod_attachment_required: boolean;
  vat_rate: number | null;
  currency_code: string | null;
};

type Invoice = {
  id: string;
  customer_id: string | null;
  customer_name?: string | null;
  invoice_number: string | null;
  status: string | null;
  issue_date: string | null;
  due_date: string | null;
  subtotal?: number | null;
  vat_total?: number | null;
  total: number | null;
  amount_paid?: number | null;
  credit_total?: number | null;
  balance_due: number | null;
  currency: string | null;
  po_reference?: string | null;
  notes?: string | null;
  accounting_invoice_id?: string | null;
  accounting_sync_status?: string | null;
};

type InvoiceLine = {
  id: string;
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  vat_rate: number | null;
};
type CreditNoteLine = {
  id: string;
  invoice_line_id: string | null;
  job_id: string | null;
  description: string;
  quantity: number | null;
  unit_price: number | null;
  vat_rate: number | null;
  net_amount: number | null;
  vat_amount: number | null;
  gross_amount: number | null;
};

type CreditNote = {
  id: string;
  customer_id: string;
  original_invoice_id: string | null;
  credit_note_number: string | null;
  status: string;
  issue_date: string;
  reason: string | null;
  subtotal: number | null;
  vat_total: number | null;
  total: number | null;
  currency: string | null;

  customers?: {
    id: string;
    name: string;
  } | null;

  invoices?: {
    id: string;
    invoice_number: string | null;
    total: number | null;
    credit_total: number | null;
    balance_due: number | null;
    currency: string | null;
  } | null;

  credit_note_lines?: CreditNoteLine[];

  credit_note_allocations?: Array<{
    id: string;
    invoice_id: string;
    amount: number | null;
    allocated_at: string;
  }>;
};

type CreditLineDraft = {
  invoiceLineId: string;
  description: string;
  originalQuantity: number;
  availableQuantity: number;
  unitPrice: number;
  vatRate: number;
  quantity: string;
};

type InvoiceJobDetail = {
  job_id: string;
  reference: string | null;
  external_reference: string | null;
  pod_status: string | null;
};

type InvoicePreviewData = {
  invoice: Invoice & {
    customer_reference?: string | null;
    accounting_invoice_id?: string | null;
    accounting_sync_error?: string | null;
  };
  lines: InvoiceLine[];
  jobs: InvoiceJobDetail[];
  payments: Array<Record<string, unknown>>;
  credits: Array<Record<string, unknown>>;
  branding: InvoiceDocumentBranding | null;
};

type InvoiceDocumentBranding = {
  companyProfile: {
    company_name: string | null;
    trading_name: string | null;
    registration_number: string | null;
    vat_number: string | null;
    business_email: string | null;
    business_phone: string | null;
    website: string | null;
    address_line_1: string | null;
    address_line_2: string | null;
    city: string | null;
    region: string | null;
    postcode: string | null;
    country_code: string | null;
  } | null;

  documentSettings: {
    logo_path: string | null;
    logo_signed_url: string | null;
    footer_text: string | null;
    bank_details: string | null;
    generic_document_note: string | null;
    show_logo: boolean;
    show_company_registration: boolean;
    show_vat_number: boolean;
    show_contact_details: boolean;
  } | null;
};
type Customer = {
  id: string;
  name: string;
  accounts_email: string | null;
  account_code: string | null;
  currency_code: string | null;
  payment_terms_days: number | null;
  requires_po: boolean;
  pod_required: boolean;
  invoice_pod_attachment_required: boolean;
  vat_rate: number | null;
  credit_status: string | null;
  credit_hold: boolean;
};

type Subcontractor = {
  id: string;
  name: string;
};

type Integration = {
  id: string;
  provider: string;
  display_name: string | null;
  connection_status: string;
  active: boolean;
  last_sync_at: string | null;
};

type XeroStatus = {
  connected: boolean;
  integration: {
    id: string;
    provider: string;
    display_name: string | null;
    active: boolean;
    connection_status: string;
    external_tenant_id: string | null;
    external_tenant_name: string | null;
    default_sales_account_code: string | null;
    default_purchase_account_code: string | null;
    default_tax_code: string | null;
    default_currency: string | null;
    connected_at: string | null;
    last_sync_at: string | null;
    updated_at: string | null;
  } | null;
};

type GenericRow = Record<string, unknown>;

const TABS: Array<[Tab, string]> = [
  ["ready", "Ready to Invoice"],
  ["invoices", "Invoices"],
  ["credits", "Credit Notes"],
  ["payments", "Payments"],
  ["statements", "Statements"],
  ["chase", "Chase Letters"],
  ["customer-pos", "Customer POs"],
  ["quotations", "Quotations"],
  ["supplier-pos", "Supplier POs"],
  ["accounting", "Accounting"],
];

export default function CustomerAccountsPage() {
  const tenant = useTenant();

  const [tab, setTab] = useState<Tab>("ready");
  const [readyJobs, setReadyJobs] = useState<ReadyJob[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [rows, setRows] = useState<GenericRow[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);

  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const [invoicePoReference, setInvoicePoReference] = useState("");
  const [invoiceNotes, setInvoiceNotes] = useState("");

  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editingLines, setEditingLines] = useState<InvoiceLine[]>([]);
  const [editIssueDate, setEditIssueDate] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editPoReference, setEditPoReference] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [invoiceEditWorking, setInvoiceEditWorking] = useState(false);
  const [previewInvoice, setPreviewInvoice] =
    useState<InvoicePreviewData | null>(null);
  const [previewWorking, setPreviewWorking] = useState(false);
  const [xeroInvoiceSyncingId, setXeroInvoiceSyncingId] =
    useState<string | null>(null);
  const [emailInvoiceSendingId, setEmailInvoiceSendingId] =
    useState<string | null>(null);

  const [paymentCustomerId, setPaymentCustomerId] = useState("");
  const [paymentInvoiceId, setPaymentInvoiceId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [creditInvoiceId, setCreditInvoiceId] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditIssueDate, setCreditIssueDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [creditLines, setCreditLines] = useState<CreditLineDraft[]>([]);
  const [editingCreditNote, setEditingCreditNote] =
    useState<CreditNote | null>(null);
  const [creditLinesLoading, setCreditLinesLoading] = useState(false);

  const [statementCustomerId, setStatementCustomerId] = useState("");

  const [chaseCustomerId, setChaseCustomerId] = useState("");
  const [chaseLevel, setChaseLevel] = useState("reminder_1");
  const [chaseSubject, setChaseSubject] = useState(
    "Outstanding account reminder"
  );
  const [chaseBody, setChaseBody] = useState("");

  const [customerPoCustomerId, setCustomerPoCustomerId] = useState("");
  const [customerPoNumber, setCustomerPoNumber] = useState("");
  const [customerPoValue, setCustomerPoValue] = useState("");
  const [customerPoDescription, setCustomerPoDescription] = useState("");

  const [supplierPoSubcontractorId, setSupplierPoSubcontractorId] =
    useState("");
  const [supplierPoNumber, setSupplierPoNumber] = useState("");
  const [supplierPoSubtotal, setSupplierPoSubtotal] = useState("");
  const [supplierPoVat, setSupplierPoVat] = useState("");
  const [supplierPoDescription, setSupplierPoDescription] = useState("");

  const [provider, setProvider] = useState("xero");
  const [providerDisplayName, setProviderDisplayName] = useState("");
  const [salesAccountCode, setSalesAccountCode] = useState("");
  const [purchaseAccountCode, setPurchaseAccountCode] = useState("");
  const [taxCode, setTaxCode] = useState("");

  const [xeroStatus, setXeroStatus] = useState<XeroStatus>({
    connected: false,
    integration: null,
  });
  const [xeroWorking, setXeroWorking] = useState(false);

  const tenantId = tenant.activeTenantId;

  const loadXeroStatus = useCallback(async () => {
    if (!tenantId) {
      setXeroStatus({
        connected: false,
        integration: null,
      });
      return;
    }

    const response = await fetch(
      `/api/accounts/accounting/xero/status?tenantId=${encodeURIComponent(
        tenantId
      )}`,
      {
        cache: "no-store",
      }
    );

    const body = (await response.json()) as XeroStatus & {
      error?: string;
    };

    if (!response.ok) {
      throw new Error(body.error || "Unable to load Xero connection status.");
    }

    setXeroStatus({
      connected: body.connected === true,
      integration: body.integration ?? null,
    });

    const integration = body.integration;

    if (integration) {
      setProvider("xero");
      setProviderDisplayName(integration.display_name || "Xero");
      setSalesAccountCode(
        integration.default_sales_account_code || ""
      );
      setPurchaseAccountCode(
        integration.default_purchase_account_code || ""
      );
      setTaxCode(integration.default_tax_code || "");
    }
  }, [tenantId]);

  const loadLookups = useCallback(async () => {
    if (!tenantId) return;

    const response = await fetch(
      `/api/accounts/lookups?tenantId=${encodeURIComponent(tenantId)}`,
      { cache: "no-store" }
    );

    const body = await response.json();

    if (!response.ok) {
      throw new Error(body.error || "Unable to load account lookups.");
    }

    setCustomers(body.customers ?? []);
    setSubcontractors(body.subcontractors ?? []);

    setInvoices((current) => {
      if (current.length > 0) return current;

      return (body.invoices ?? []).map((invoice: Invoice) => ({
        ...invoice,
        customer_name:
          body.customers?.find(
            (customer: Customer) => customer.id === invoice.customer_id
          )?.name ?? null,
      }));
    });
  }, [tenantId]);

  const loadTab = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      await loadLookups();

      if (tab === "ready") {
        const response = await fetch(
          `/api/accounts/ready-to-invoice?tenantId=${encodeURIComponent(
            tenantId
          )}`,
          { cache: "no-store" }
        );

        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error || "Unable to load completed jobs.");
        }

        setReadyJobs(body.jobs ?? []);
        setRows([]);
        return;
      }

      if (tab === "invoices") {
        const response = await fetch(
          `/api/accounts/invoices?tenantId=${encodeURIComponent(tenantId)}`,
          { cache: "no-store" }
        );

        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error || "Unable to load invoices.");
        }

        setInvoices(body.invoices ?? []);
        setRows([]);
        return;
      }

      if (tab === "quotations") {
        setRows([]);
        return;
      }
      const endpoint =
        tab === "credits"
          ? "credit-notes"
          : tab === "payments"
            ? "payments"
            : tab === "statements"
              ? "statements"
              : tab === "chase"
                ? "chase-letters"
                : tab === "accounting"
                  ? "accounting"
                  : "purchase-orders";

      const suffix =
        tab === "supplier-pos"
          ? "&type=supplier"
          : tab === "customer-pos"
            ? "&type=customer"
            : "";

      const response = await fetch(
        `/api/accounts/${endpoint}?tenantId=${encodeURIComponent(
          tenantId
        )}${suffix}`,
        { cache: "no-store" }
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Unable to load accounts data.");
      }

      if (tab === "accounting") {
        setIntegrations(body.integrations ?? []);
        setRows([]);
      } else if (tab === "credits") {
        setCreditNotes(body.creditNotes ?? []);
        setRows([]);

        const invoiceResponse = await fetch(
          `/api/accounts/invoices?tenantId=${encodeURIComponent(
            tenantId
          )}`,
          {
            cache: "no-store",
          }
        );

        const invoiceBody = await invoiceResponse.json();

        if (!invoiceResponse.ok) {
          throw new Error(
            invoiceBody.error ||
              "Unable to load invoices for Credit Notes."
          );
        }

        setInvoices(invoiceBody.invoices ?? []);
      } else {
        setRows(
          body.payments ??
            body.statements ??
            body.chaseLetters ??
            body.purchaseOrders ??
            []
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load accounts."
      );
    } finally {
      setLoading(false);
    }
  }, [loadLookups, tab, tenantId]);

  useEffect(() => {
    void loadTab();
  }, [loadTab]);

  useEffect(() => {
    if (tab !== "accounting" || !tenantId) {
      return;
    }

    void loadXeroStatus().catch((error) => {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load Xero status."
      );
    });
  }, [loadXeroStatus, tab, tenantId]);

  const selectedReady = useMemo(
    () => readyJobs.filter((job) => selectedJobs.includes(job.job_id)),
    [readyJobs, selectedJobs]
  );

  const selectedCustomerIds = Array.from(
    new Set(selectedReady.map((job) => job.customer_id))
  );

  const selectedTotal = selectedReady.reduce(
    (sum, job) => sum + Number(job.customer_price ?? 0),
    0
  );

  const openInvoices = invoices.filter(
    (invoice) =>
      Number(invoice.balance_due ?? 0) > 0 &&
      !["void", "credited"].includes(String(invoice.status ?? "").toLowerCase())
  );

  const overdueInvoices = openInvoices.filter(
    (invoice) =>
      invoice.due_date &&
      invoice.due_date < new Date().toISOString().slice(0, 10)
  );

  const outstandingTotal = openInvoices.reduce(
    (sum, invoice) => sum + Number(invoice.balance_due ?? 0),
    0
  );

  async function postJson(
    path: string,
    payload: Record<string, unknown>,
    successMessage: string
  ) {
    setWorking(true);
    setMessage("");

    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Unable to save record.");
      }

      setMessage(successMessage);
      await loadTab();
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save record."
      );
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function createInvoice() {
    if (!tenant.writeTenantId || selectedReady.length === 0) {
      setMessage("Choose at least one completed job.");
      return;
    }

    if (selectedCustomerIds.length !== 1) {
      setMessage("All selected jobs must belong to the same customer.");
      return;
    }

    const customer = customers.find(
      (item) => item.id === selectedCustomerIds[0]
    );

    if (customer?.requires_po && !invoicePoReference.trim()) {
      setMessage("This customer requires a PO reference before invoicing.");
      return;
    }

    const success = await postJson(
      "/api/accounts/invoices",
      {
        tenantId: tenant.writeTenantId,
        customerId: selectedCustomerIds[0],
        jobIds: selectedJobs,
        poReference: invoicePoReference.trim() || null,
        notes: invoiceNotes.trim() || null,
      },
      "Invoice created."
    );

    if (success) {
      setSelectedJobs([]);
      setInvoicePoReference("");
      setInvoiceNotes("");
      setTab("invoices");
    }
  }

  async function openInvoicePreview(invoice: Invoice) {
    if (!tenantId) {
      setMessage("Choose a tenant.");
      return;
    }

    setPreviewWorking(true);
    setMessage("");

    try {
      const encodedTenantId =
        encodeURIComponent(tenantId);

      const [
        invoiceResponse,
        brandingResponse,
      ] = await Promise.all([
        fetch(
          `/api/accounts/invoices/${invoice.id}?tenantId=${encodedTenantId}`,
          {
            cache: "no-store",
          }
        ),

        fetch(
          `/api/settings/documents?tenantId=${encodedTenantId}`,
          {
            cache: "no-store",
          }
        ),
      ]);

      const invoiceBody =
        await invoiceResponse.json();

      if (!invoiceResponse.ok) {
        throw new Error(
          invoiceBody.error ||
            "Unable to load invoice preview."
        );
      }

      const brandingBody =
        await brandingResponse.json();

      if (!brandingResponse.ok) {
        throw new Error(
          brandingBody.error ||
            "Unable to load document branding."
        );
      }

      setPreviewInvoice({
        ...invoiceBody,

        branding: {
          companyProfile:
            brandingBody.companyProfile ??
            null,

          documentSettings:
            brandingBody.documentSettings ??
            null,
        },
      });
    }
    catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load invoice preview."
      );
    }
    finally {
      setPreviewWorking(false);
    }
  }
  async function approveInvoice(invoice: Invoice) {
    if (!tenant.writeTenantId) {
      setMessage("Choose a tenant.");
      return;
    }

    if (
      !window.confirm(
        `Approve ${invoice.invoice_number || "this invoice"}?`
      )
    ) {
      return;
    }

    setPreviewWorking(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/accounts/invoices/${invoice.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId: tenant.writeTenantId,
            status: "approved",
          }),
        }
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body.error || "Unable to approve invoice."
        );
      }

      setMessage("Invoice approved.");
      setPreviewInvoice(null);
      await loadTab();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to approve invoice."
      );
    } finally {
      setPreviewWorking(false);
    }
  }
  async function emailInvoice(invoice: Invoice) {
    if (!tenant.writeTenantId) {
      setMessage("Choose a tenant.");
      return;
    }

    const status =
      String(invoice.status ?? "").toLowerCase();

    if (!["approved", "sent"].includes(status)) {
      setMessage(
        "Approve the invoice before emailing it."
      );
      return;
    }

    if (
      !window.confirm(
        `Email ${
          invoice.invoice_number || "this invoice"
        } with PDF and available POD attachments?`
      )
    ) {
      return;
    }

    setEmailInvoiceSendingId(invoice.id);
    setMessage("");

    try {
      const response = await fetch(
        `/api/accounts/invoices/${invoice.id}/email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId: tenant.writeTenantId,
            includePod: true,
          }),
        }
      );

      const body = (await response.json()) as {
        ok?: boolean;
        invoiceId?: string;
        invoiceNumber?: string;
        recipient?: string;
        deliveryLogId?: string;
        providerMessageId?: string | null;
        attachments?: string[];
        podAttachmentCount?: number;
        sentAt?: string;
        missingPodJobs?: Array<{
          id: string;
          reference: string;
          podStatus: string;
        }>;
        error?: string;
      };

      if (!response.ok) {
        if (
          Array.isArray(body.missingPodJobs) &&
          body.missingPodJobs.length > 0
        ) {
          const missing =
            body.missingPodJobs
              .map(
                (job) =>
                  `${job.reference} (${job.podStatus})`
              )
              .join(", ");

          throw new Error(
            `${body.error || "Unable to email invoice."} Missing POD: ${missing}`
          );
        }

        throw new Error(
          body.error || "Unable to email invoice."
        );
      }

      const attachmentCount =
        Array.isArray(body.attachments)
          ? body.attachments.length
          : 0;

      const podCount =
        Number(body.podAttachmentCount ?? 0);

      const acknowledgement =
        body.providerMessageId
          ? ` Provider acknowledgement: ${body.providerMessageId}.`
          : "";

      setMessage(
        `${
          body.invoiceNumber ||
          invoice.invoice_number ||
          "Invoice"
        } sent to ${
          body.recipient || "the customer"
        }. ${attachmentCount} attachment${
          attachmentCount === 1 ? "" : "s"
        }${
          podCount > 0
            ? ` including ${podCount} POD PDF${
                podCount === 1 ? "" : "s"
              }`
            : ""
        }.${acknowledgement}`
      );

      setPreviewInvoice(null);

      await loadTab();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to email invoice."
      );

      await loadTab();
    } finally {
      setEmailInvoiceSendingId(null);
    }
  }
  async function syncInvoiceToXero(invoice: Invoice) {
    if (!tenant.writeTenantId) {
      setMessage("Choose a tenant.");
      return;
    }

    if (!xeroStatus.connected) {
      setMessage("Connect Xero before syncing invoices.");
      return;
    }

    if (
      !window.confirm(
        `Sync ${invoice.invoice_number || "this invoice"} to Xero?`
      )
    ) {
      return;
    }

    setXeroInvoiceSyncingId(invoice.id);
    setMessage("");

    try {
      const response = await fetch(
        `/api/accounts/accounting/xero/invoices/${invoice.id}/sync`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId: tenant.writeTenantId,
          }),
        }
      );

      const body = (await response.json()) as {
        ok?: boolean;
        alreadySynced?: boolean;
        invoiceNumber?: string;
        xeroInvoiceId?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          body.error || "Unable to sync invoice to Xero."
        );
      }

      if (body.alreadySynced) {
        setMessage(
          `${body.invoiceNumber || "Invoice"} is already synced to Xero.`
        );
      } else {
        setMessage(
          `${body.invoiceNumber || "Invoice"} synced to Xero successfully.`
        );
      }

      setPreviewInvoice(null);
      await loadTab();
      await loadXeroStatus();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to sync invoice to Xero."
      );

      await loadTab();
    } finally {
      setXeroInvoiceSyncingId(null);
    }
  }
  async function openInvoiceEditor(invoice: Invoice) {
    if (!tenantId) {
      setMessage("Choose a tenant.");
      return;
    }

    setInvoiceEditWorking(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/accounts/invoices/${invoice.id}?tenantId=${encodeURIComponent(
          tenantId
        )}`,
        {
          cache: "no-store",
        }
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "Unable to load invoice.");
      }

      setEditingInvoice({
        ...invoice,
        issue_date: body.invoice?.issue_date ?? invoice.issue_date,
        due_date: body.invoice?.due_date ?? invoice.due_date,
        po_reference: body.invoice?.po_reference ?? null,
        notes: body.invoice?.notes ?? null,
      });

      setEditingLines(body.lines ?? []);
      setEditIssueDate(body.invoice?.issue_date ?? "");
      setEditDueDate(body.invoice?.due_date ?? "");
      setEditPoReference(body.invoice?.po_reference ?? "");
      setEditNotes(body.invoice?.notes ?? "");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load invoice."
      );
    } finally {
      setInvoiceEditWorking(false);
    }
  }

  async function saveInvoiceEditor() {
    if (!tenant.writeTenantId || !editingInvoice) {
      return;
    }

    if (editingLines.length === 0) {
      setMessage("Invoice must contain at least one line.");
      return;
    }

    const invalidLine = editingLines.some((line) => {
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unit_price);
      const vatRate = Number(line.vat_rate);

      return (
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(unitPrice) ||
        unitPrice < 0 ||
        !Number.isFinite(vatRate) ||
        vatRate < 0
      );
    });

    if (invalidLine) {
      setMessage(
        "Invoice lines contain an invalid quantity, price or VAT rate."
      );
      return;
    }

    setInvoiceEditWorking(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/accounts/invoices/${editingInvoice.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId: tenant.writeTenantId,
            issue_date: editIssueDate || null,
            due_date: editDueDate || null,
            po_reference: editPoReference.trim() || null,
            notes: editNotes.trim() || null,
            lines: editingLines.map((line) => ({
              id: line.id,
              description:
                line.description?.trim() || "Transport service",
              quantity: Number(line.quantity),
              unit_price: Number(line.unit_price),
              vat_rate: Number(line.vat_rate),
            })),
          }),
        }
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body.error || "Unable to update invoice."
        );
      }

      setEditingInvoice(null);
      setEditingLines([]);
      setMessage("Invoice updated successfully.");

      await loadTab();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update invoice."
      );
    } finally {
      setInvoiceEditWorking(false);
    }
  }
  async function createPayment() {
    if (!tenant.writeTenantId || !paymentCustomerId || !paymentAmount) {
      setMessage("Customer and payment amount are required.");
      return;
    }

    const success = await postJson(
      "/api/accounts/payments",
      {
        tenantId: tenant.writeTenantId,
        customerId: paymentCustomerId,
        invoiceId: paymentInvoiceId || null,
        amount: Number(paymentAmount),
        allocateAmount: paymentInvoiceId ? Number(paymentAmount) : 0,
        paymentMethod,
        paymentReference: paymentReference.trim() || null,
      },
      "Payment recorded."
    );

    if (success) {
      setPaymentAmount("");
      setPaymentReference("");
    }
  }

  function roundCreditMoney(value: number) {
    return Math.round(
      (value + Number.EPSILON) * 100
    ) / 100;
  }

  function creditDraftTotals() {
    return creditLines.reduce(
      (totals, line) => {
        const quantity =
          Number(line.quantity || 0);

        if (
          !Number.isFinite(quantity) ||
          quantity <= 0
        ) {
          return totals;
        }

        const net =
          roundCreditMoney(
            quantity *
              line.unitPrice
          );

        const vat =
          roundCreditMoney(
            net *
              (line.vatRate / 100)
          );

        const gross =
          roundCreditMoney(
            net + vat
          );

        return {
          net:
            roundCreditMoney(
              totals.net + net
            ),

          vat:
            roundCreditMoney(
              totals.vat + vat
            ),

          gross:
            roundCreditMoney(
              totals.gross + gross
            ),
        };
      },
      {
        net: 0,
        vat: 0,
        gross: 0,
      }
    );
  }

  function creditedQuantityForLine(
    invoiceId: string,
    invoiceLineId: string,
    excludeCreditNoteId?: string
  ) {
    return creditNotes.reduce(
      (total, note) => {
        if (
          note.original_invoice_id !==
            invoiceId ||
          note.id ===
            excludeCreditNoteId ||
          [
            "cancelled",
            "void",
          ].includes(
            String(
              note.status ?? ""
            ).toLowerCase()
          )
        ) {
          return total;
        }

        const quantity =
          (
            note.credit_note_lines ??
            []
          )
            .filter(
              (line) =>
                line.invoice_line_id ===
                invoiceLineId
            )
            .reduce(
              (sum, line) =>
                sum +
                Number(
                  line.quantity ?? 0
                ),
              0
            );

        return total + quantity;
      },
      0
    );
  }

  async function loadCreditInvoiceLines(
    invoiceId: string,
    existingCredit?: CreditNote | null
  ) {
    if (
      !tenant.writeTenantId ||
      !invoiceId
    ) {
      setCreditLines([]);
      return;
    }

    setCreditLinesLoading(true);
    setMessage("");

    try {
      const response =
        await fetch(
          `/api/accounts/invoices/${invoiceId}?tenantId=${encodeURIComponent(
            tenant.writeTenantId
          )}`,
          {
            cache:
              "no-store",
          }
        );

      const body =
        await response.json();

      if (!response.ok) {
        throw new Error(
          body.error ||
            "Unable to load invoice lines."
        );
      }

      const existingQuantities =
        new Map<
          string,
          number
        >();

      for (
        const line of
        existingCredit
          ?.credit_note_lines ??
        []
      ) {
        if (
          !line.invoice_line_id
        ) {
          continue;
        }

        existingQuantities.set(
          line.invoice_line_id,
          Number(
            line.quantity ?? 0
          )
        );
      }

      const nextLines:
        CreditLineDraft[] =
        (body.lines ?? []).map(
          (line: InvoiceLine) => {
            const originalQuantity =
              Number(
                line.quantity ?? 0
              );

            const alreadyCredited =
              creditedQuantityForLine(
                invoiceId,
                line.id,
                existingCredit?.id
              );

            const availableQuantity =
              Math.max(
                originalQuantity -
                  alreadyCredited,
                0
              );

            const existingQuantity =
              Number(
                existingQuantities.get(
                  line.id
                ) ?? 0
              );

            return {
              invoiceLineId:
                line.id,

              description:
                line.description ||
                "Invoice line",

              originalQuantity,

              availableQuantity,

              unitPrice:
                Number(
                  line.unit_price ??
                    0
                ),

              vatRate:
                Number(
                  line.vat_rate ??
                    0
                ),

              quantity:
                existingQuantity > 0
                  ? String(
                      existingQuantity
                    )
                  : "",
            };
          }
        );

      setCreditLines(
        nextLines
      );
    }
    catch (error) {
      setCreditLines([]);

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load invoice lines."
      );
    }
    finally {
      setCreditLinesLoading(
        false
      );
    }
  }

  async function changeCreditInvoice(
    invoiceId: string
  ) {
    setCreditInvoiceId(
      invoiceId
    );

    setEditingCreditNote(
      null
    );

    setCreditLines([]);

    if (!invoiceId) {
      return;
    }

    await loadCreditInvoiceLines(
      invoiceId
    );
  }

  function resetCreditEditor() {
    setEditingCreditNote(
      null
    );

    setCreditInvoiceId(
      ""
    );

    setCreditReason(
      ""
    );

    setCreditIssueDate(
      new Date()
        .toISOString()
        .slice(0, 10)
    );

    setCreditLines([]);
  }

  function selectedCreditLines() {
    return creditLines
      .map((line) => ({
        invoiceLineId:
          line.invoiceLineId,

        quantity:
          Number(
            line.quantity || 0
          ),
      }))
      .filter(
        (line) =>
          Number.isFinite(
            line.quantity
          ) &&
          line.quantity > 0
      );
  }

  function validateCreditLines() {
    const selected =
      selectedCreditLines();

    if (
      selected.length === 0
    ) {
      setMessage(
        "Enter a credit quantity against at least one invoice line."
      );

      return null;
    }

    for (
      const line of
      creditLines
    ) {
      const quantity =
        Number(
          line.quantity || 0
        );

      if (
        quantity <= 0
      ) {
        continue;
      }

      if (
        quantity >
        line.availableQuantity +
          0.000001
      ) {
        setMessage(
          `Credit quantity for "${line.description}" exceeds the available quantity of ${line.availableQuantity}.`
        );

        return null;
      }
    }

    return selected;
  }

  async function createCreditNote() {
    if (
      !tenant.writeTenantId ||
      !creditInvoiceId
    ) {
      setMessage(
        "Choose an original invoice."
      );

      return;
    }

    const lines =
      validateCreditLines();

    if (!lines) {
      return;
    }

    setWorking(true);
    setMessage("");

    try {
      const response =
        await fetch(
          "/api/accounts/credit-notes",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                tenantId:
                  tenant.writeTenantId,

                invoiceId:
                  creditInvoiceId,

                issueDate:
                  creditIssueDate,

                reason:
                  creditReason
                    .trim() ||
                  null,

                lines,
              }),
          }
        );

      const body =
        await response.json();

      if (!response.ok) {
        throw new Error(
          body.error ||
            "Unable to create Credit Note."
        );
      }

      setMessage(
        `${
          body.creditNote
            ?.credit_note_number ||
          "Credit Note"
        } saved as draft.`
      );

      resetCreditEditor();

      await loadTab();
    }
    catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to create Credit Note."
      );
    }
    finally {
      setWorking(false);
    }
  }

  async function editCreditNote(
    note: CreditNote
  ) {
    if (
      note.status !== "draft" ||
      !note.original_invoice_id
    ) {
      return;
    }

    if (
      (
        note.credit_note_allocations ??
        []
      ).length > 0
    ) {
      setMessage(
        "This legacy draft already has an allocation and must be corrected before editing."
      );

      return;
    }

    setEditingCreditNote(
      note
    );

    setCreditInvoiceId(
      note.original_invoice_id
    );

    setCreditReason(
      note.reason ?? ""
    );

    setCreditIssueDate(
      note.issue_date ||
        new Date()
          .toISOString()
          .slice(0, 10)
    );

    await loadCreditInvoiceLines(
      note.original_invoice_id,
      note
    );

    window.setTimeout(
      () => {
        document
          .getElementById(
            "credit-note-editor"
          )
          ?.scrollIntoView({
            behavior:
              "smooth",

            block:
              "start",
          });
      },
      0
    );
  }

  async function saveCreditNote() {
    if (
      !tenant.writeTenantId ||
      !editingCreditNote
    ) {
      return;
    }

    const lines =
      validateCreditLines();

    if (!lines) {
      return;
    }

    setWorking(true);
    setMessage("");

    try {
      const response =
        await fetch(
          "/api/accounts/credit-notes",
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                tenantId:
                  tenant.writeTenantId,

                creditNoteId:
                  editingCreditNote.id,

                action:
                  "save",

                issueDate:
                  creditIssueDate,

                reason:
                  creditReason
                    .trim() ||
                  null,

                lines,
              }),
          }
        );

      const body =
        await response.json();

      if (!response.ok) {
        throw new Error(
          body.error ||
            "Unable to save Credit Note."
        );
      }

      setMessage(
        `${
          body.creditNote
            ?.credit_note_number ||
          "Credit Note"
        } saved.`
      );

      resetCreditEditor();

      await loadTab();
    }
    catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to save Credit Note."
      );
    }
    finally {
      setWorking(false);
    }
  }

  async function creditNoteAction(
    note: CreditNote,
    action:
      | "approve"
      | "cancel"
  ) {
    if (
      !tenant.writeTenantId
    ) {
      return;
    }

    if (
      action === "approve" &&
      !window.confirm(
        `Approve ${
          note.credit_note_number ||
          "this Credit Note"
        } for ${money(
          note.total,
          note.currency ||
            "GBP"
        )}? This will apply the credit to the original invoice.`
      )
    ) {
      return;
    }

    if (
      action === "cancel" &&
      !window.confirm(
        `Cancel ${
          note.credit_note_number ||
          "this Credit Note"
        }?`
      )
    ) {
      return;
    }

    setWorking(true);
    setMessage("");

    try {
      const response =
        await fetch(
          "/api/accounts/credit-notes",
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                tenantId:
                  tenant.writeTenantId,

                creditNoteId:
                  note.id,

                action,
              }),
          }
        );

      const body =
        await response.json();

      if (!response.ok) {
        throw new Error(
          body.error ||
            `Unable to ${action} Credit Note.`
        );
      }

      setMessage(
        action === "approve"
          ? `${
              note.credit_note_number ||
              "Credit Note"
            } approved and applied to the invoice.`
          : `${
              note.credit_note_number ||
              "Credit Note"
            } cancelled.`
      );

      resetCreditEditor();

      await loadTab();
    }
    catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : `Unable to ${action} Credit Note.`
      );
    }
    finally {
      setWorking(false);
    }
  }
  async function createStatement() {
    if (!tenant.writeTenantId || !statementCustomerId) {
      setMessage("Choose a customer.");
      return;
    }

    await postJson(
      "/api/accounts/statements",
      {
        tenantId: tenant.writeTenantId,
        customerId: statementCustomerId,
      },
      "Statement generated."
    );
  }

  async function createChaseLetter() {
    if (!tenant.writeTenantId || !chaseCustomerId) {
      setMessage("Choose a customer.");
      return;
    }

    await postJson(
      "/api/accounts/chase-letters",
      {
        tenantId: tenant.writeTenantId,
        customerId: chaseCustomerId,
        chaseLevel,
        subject: chaseSubject.trim(),
        body: chaseBody.trim() || null,
      },
      "Chase letter created."
    );
  }

  async function createCustomerPo() {
    if (
      !tenant.writeTenantId ||
      !customerPoCustomerId ||
      !customerPoNumber.trim()
    ) {
      setMessage("Customer and PO number are required.");
      return;
    }

    const success = await postJson(
      "/api/accounts/purchase-orders",
      {
        tenantId: tenant.writeTenantId,
        type: "customer",
        customerId: customerPoCustomerId,
        poNumber: customerPoNumber.trim(),
        authorisedValue: customerPoValue
          ? Number(customerPoValue)
          : null,
        description: customerPoDescription.trim() || null,
      },
      "Customer PO created."
    );

    if (success) {
      setCustomerPoNumber("");
      setCustomerPoValue("");
      setCustomerPoDescription("");
    }
  }

  async function createSupplierPo() {
    if (!tenant.writeTenantId || !supplierPoNumber.trim()) {
      setMessage("Supplier PO number is required.");
      return;
    }

    const subtotal = Number(supplierPoSubtotal || 0);
    const vat = Number(supplierPoVat || 0);

    const success = await postJson(
      "/api/accounts/purchase-orders",
      {
        tenantId: tenant.writeTenantId,
        type: "supplier",
        subcontractorId: supplierPoSubcontractorId || null,
        poNumber: supplierPoNumber.trim(),
        description: supplierPoDescription.trim() || null,
        subtotal,
        vatTotal: vat,
        total: subtotal + vat,
      },
      "Supplier PO created."
    );

    if (success) {
      setSupplierPoNumber("");
      setSupplierPoSubtotal("");
      setSupplierPoVat("");
      setSupplierPoDescription("");
    }
  }

  function connectXero() {
    const targetTenantId =
      tenant.writeTenantId || tenant.activeTenantId;

    if (!targetTenantId) {
      setMessage("Choose a tenant before connecting Xero.");
      return;
    }

    window.location.assign(
      `/api/accounts/accounting/xero/connect?tenantId=${encodeURIComponent(
        targetTenantId
      )}`
    );
  }

  async function testXeroConnection() {
    const targetTenantId =
      tenant.writeTenantId || tenant.activeTenantId;

    if (!targetTenantId) {
      setMessage("Choose a tenant before testing Xero.");
      return;
    }

    setXeroWorking(true);
    setMessage("");

    try {
      const response = await fetch(
        "/api/accounts/accounting/xero/test",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId: targetTenantId,
          }),
        }
      );

      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        organisation?: {
          Name?: string;
        } | null;
      };

      if (!response.ok) {
        throw new Error(body.error || "Xero connection test failed.");
      }

      setMessage(
        body.organisation?.Name
          ? `Xero connection successful: ${body.organisation.Name}`
          : "Xero connection successful."
      );

      await loadXeroStatus();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Xero connection test failed."
      );
    } finally {
      setXeroWorking(false);
    }
  }

  async function disconnectXero() {
    const targetTenantId =
      tenant.writeTenantId || tenant.activeTenantId;

    if (!targetTenantId) {
      setMessage("Choose a tenant before disconnecting Xero.");
      return;
    }

    if (
      !window.confirm(
        "Disconnect Xero from this TMS tenant?"
      )
    ) {
      return;
    }

    setXeroWorking(true);
    setMessage("");

    try {
      const response = await fetch(
        "/api/accounts/accounting/xero/disconnect",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId: targetTenantId,
          }),
        }
      );

      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error || "Unable to disconnect Xero.");
      }

      setMessage("Xero disconnected.");

      await loadXeroStatus();
      await loadTab();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to disconnect Xero."
      );
    } finally {
      setXeroWorking(false);
    }
  }

  async function saveAccountingProvider() {
    if (!tenant.writeTenantId) {
      setMessage("Choose a tenant.");
      return;
    }

    await postJson(
      "/api/accounts/accounting",
      {
        tenantId: tenant.writeTenantId,
        provider,
        displayName: providerDisplayName.trim() || provider,
        defaultSalesAccountCode: salesAccountCode.trim() || null,
        defaultPurchaseAccountCode: purchaseAccountCode.trim() || null,
        defaultTaxCode: taxCode.trim() || null,
        connectionStatus:
          provider === "manual" || provider === "csv"
            ? "available"
            : "not_connected",
      },
      "Accounting provider settings saved."
    );
  }

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1500px] px-6 py-8">
          <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-kicker uppercase text-ink-3">
                Customer Accounts
              </div>
              <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
                Invoices & Accounts
              </h1>
              <p className="m-0 text-sm text-ink-3">
                Jobs, PODs, invoices, credits, payments, statements, purchase
                orders, debt chasing and accounting-package sync.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Stat
                label="Outstanding"
                value={money(outstandingTotal, "GBP")}
              />
              <Stat
                label="Overdue invoices"
                value={String(overdueInvoices.length)}
              />
              <Stat
                label="Ready to invoice"
                value={String(readyJobs.length)}
              />
            </div>
          </header>

          <div className="-m-0.5 mb-4 overflow-x-auto p-0.5">
            <Tabs
              label="Accounts sections"
              tabs={TABS.map(([key, label]) => ({ id: key, label }))}
              activeId={tab}
              onChange={(id) => setTab(id as Tab)}
            />
          </div>

          <MessageBanner tone="neutral">{message}</MessageBanner>

          {loading ? (
            <Card>Loading accounts...</Card>
          ) : (
            <>
              {tab === "ready" ? (
                <ReadyToInvoicePanel
                  readyJobs={readyJobs}
                  selectedJobs={selectedJobs}
                  setSelectedJobs={setSelectedJobs}
                  selectedReady={selectedReady}
                  selectedTotal={selectedTotal}
                  invoicePoReference={invoicePoReference}
                  setInvoicePoReference={setInvoicePoReference}
                  invoiceNotes={invoiceNotes}
                  setInvoiceNotes={setInvoiceNotes}
                  working={working}
                  createInvoice={createInvoice}
                />
              ) : null}

              {tab === "invoices" ? (
                <InvoicesPanel
                  invoices={invoices}
                  editingInvoice={editingInvoice}
                  editingLines={editingLines}
                  setEditingLines={setEditingLines}
                  editIssueDate={editIssueDate}
                  setEditIssueDate={setEditIssueDate}
                  editDueDate={editDueDate}
                  setEditDueDate={setEditDueDate}
                  editPoReference={editPoReference}
                  setEditPoReference={setEditPoReference}
                  editNotes={editNotes}
                  setEditNotes={setEditNotes}
                  working={invoiceEditWorking}
                  openInvoiceEditor={openInvoiceEditor}
                  saveInvoiceEditor={saveInvoiceEditor}
                  xeroConnected={xeroStatus.connected}
                  xeroInvoiceSyncingId={xeroInvoiceSyncingId}
                  syncInvoiceToXero={syncInvoiceToXero}
                  emailInvoiceSendingId={emailInvoiceSendingId}
                  emailInvoice={emailInvoice}
                  previewInvoice={previewInvoice}
                  previewWorking={previewWorking}
                  openInvoicePreview={openInvoicePreview}
                  approveInvoice={approveInvoice}
                  closeInvoicePreview={() => setPreviewInvoice(null)}                  closeInvoiceEditor={() => {
                    setEditingInvoice(null);
                    setEditingLines([]);
                  }}
                />
              ) : null}

              {tab === "payments" ? (
                <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                  <h2 className="m-0 mb-3 text-md font-semibold text-ink">Record Customer Payment</h2>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Customer">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={paymentCustomerId}
                        onChange={(event) => {
                          setPaymentCustomerId(event.target.value);
                          setPaymentInvoiceId("");
                        }}
                      >
                        <option value="">Choose customer</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Allocate to Invoice">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={paymentInvoiceId}
                        onChange={(event) =>
                          setPaymentInvoiceId(event.target.value)
                        }
                      >
                        <option value="">Unallocated payment</option>
                        {openInvoices
                          .filter(
                            (invoice) =>
                              !paymentCustomerId ||
                              invoice.customer_id === paymentCustomerId
                          )
                          .map((invoice) => (
                            <option key={invoice.id} value={invoice.id}>
                              {invoice.invoice_number} ·{" "}
                              {money(
                                invoice.balance_due,
                                invoice.currency || "GBP"
                              )}{" "}
                              outstanding
                            </option>
                          ))}
                      </select>
                    </Field>

                    <Field label="Amount">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        type="number"
                        step="0.01"
                        min="0"
                        value={paymentAmount}
                        onChange={(event) =>
                          setPaymentAmount(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Method">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={paymentMethod}
                        onChange={(event) =>
                          setPaymentMethod(event.target.value)
                        }
                      >
                        <option value="bank_transfer">Bank Transfer</option>
                        <option value="card">Card</option>
                        <option value="cash">Cash</option>
                        <option value="cheque">Cheque</option>
                        <option value="direct_debit">Direct Debit</option>
                        <option value="other">Other</option>
                      </select>
                    </Field>

                    <Field label="Reference">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={paymentReference}
                        onChange={(event) =>
                          setPaymentReference(event.target.value)
                        }
                      />
                    </Field>
                  </div>

                  <div className="mt-3">
                    <ActionButton
                      working={working}
                      label="Record Payment"
                      onClick={createPayment}
                    />
                  </div>

                  <RecordCards rows={rows} />
                </section>
              ) : null}

              {tab === "credits" ? (
                <div className="space-y-4">
                  <section
                    id="credit-note-editor"
                    className="rounded-lg border border-line bg-surface p-4 shadow-sm"
                  >
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="m-0 text-md font-semibold text-ink">
                          {editingCreditNote
                            ? `Edit ${
                                editingCreditNote.credit_note_number ||
                                "Credit Note"
                              }`
                            : "Create Credit Note"}
                        </h2>

                        <p className="mb-0 mt-1 text-sm text-ink-3">
                          Credit invoice lines directly so Net, VAT and Total remain correct.
                        </p>
                      </div>

                      {editingCreditNote ? (
                        <button
                          type="button"
                          disabled={working}
                          onClick={resetCreditEditor}
                          className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"
                        >
                          Cancel Edit
                        </button>
                      ) : null}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="Original Invoice">
                        <select
                          className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                          value={creditInvoiceId}
                          disabled={
                            working ||
                            Boolean(
                              editingCreditNote
                            )
                          }
                          onChange={(event) =>
                            void changeCreditInvoice(
                              event.target.value
                            )
                          }
                        >
                          <option value="">
                            Choose invoice
                          </option>

                          {invoices.map(
                            (invoice) => (
                              <option
                                key={invoice.id}
                                value={invoice.id}
                              >
                                {invoice.invoice_number}
                                {" · "}
                                {invoice.customer_name ||
                                  "Customer"}
                                {" · "}
                                {money(
                                  invoice.total,
                                  invoice.currency ||
                                    "GBP"
                                )}
                              </option>
                            )
                          )}
                        </select>
                      </Field>

                      <Field label="Issue Date">
                        <input
                          type="date"
                          className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                          value={creditIssueDate}
                          onChange={(event) =>
                            setCreditIssueDate(
                              event.target.value
                            )
                          }
                        />
                      </Field>

                      <Field label="Reason">
                        <input
                          className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                          value={creditReason}
                          placeholder="Reason for credit"
                          onChange={(event) =>
                            setCreditReason(
                              event.target.value
                            )
                          }
                        />
                      </Field>
                    </div>

                    {creditLinesLoading ? (
                      <div className="mt-4 rounded-md border border-line bg-canvas p-4 text-sm text-ink-3">
                        Loading invoice lines...
                      </div>
                    ) : null}

                    {!creditLinesLoading &&
                    creditInvoiceId &&
                    creditLines.length === 0 ? (
                      <div className="mt-4 rounded-md border border-line bg-canvas p-4 text-sm text-ink-3">
                        This invoice has no creditable lines.
                      </div>
                    ) : null}

                    {creditLines.length > 0 ? (
                      <div className="mt-4 overflow-x-auto rounded-lg border border-line">
                        <table className="w-full min-w-[920px] border-collapse text-sm">
                          <thead className="bg-canvas text-left text-ink-3">
                            <tr>
                              <th className="px-3 py-2 font-medium">
                                Description
                              </th>
                              <th className="px-3 py-2 text-right font-medium">
                                Original Qty
                              </th>
                              <th className="px-3 py-2 text-right font-medium">
                                Available
                              </th>
                              <th className="px-3 py-2 text-right font-medium">
                                Rate
                              </th>
                              <th className="px-3 py-2 text-right font-medium">
                                VAT
                              </th>
                              <th className="px-3 py-2 text-right font-medium">
                                Credit Qty
                              </th>
                              <th className="px-3 py-2 text-right font-medium">
                                Net
                              </th>
                              <th className="px-3 py-2 text-right font-medium">
                                VAT
                              </th>
                              <th className="px-3 py-2 text-right font-medium">
                                Total
                              </th>
                            </tr>
                          </thead>

                          <tbody>
                            {creditLines.map(
                              (
                                line,
                                index
                              ) => {
                                const quantity =
                                  Number(
                                    line.quantity ||
                                      0
                                  );

                                const net =
                                  quantity > 0
                                    ? roundCreditMoney(
                                        quantity *
                                          line.unitPrice
                                      )
                                    : 0;

                                const vat =
                                  quantity > 0
                                    ? roundCreditMoney(
                                        net *
                                          (line.vatRate /
                                            100)
                                      )
                                    : 0;

                                const gross =
                                  roundCreditMoney(
                                    net + vat
                                  );

                                const currency =
                                  invoices.find(
                                    (invoice) =>
                                      invoice.id ===
                                      creditInvoiceId
                                  )?.currency ||
                                  "GBP";

                                return (
                                  <tr
                                    key={
                                      line.invoiceLineId
                                    }
                                    className="border-t border-line"
                                  >
                                    <td className="px-3 py-3 text-ink">
                                      {
                                        line.description
                                      }
                                    </td>

                                    <td className="px-3 py-3 text-right text-ink">
                                      {
                                        line.originalQuantity
                                      }
                                    </td>

                                    <td className="px-3 py-3 text-right text-ink">
                                      {
                                        line.availableQuantity
                                      }
                                    </td>

                                    <td className="px-3 py-3 text-right text-ink">
                                      {money(
                                        line.unitPrice,
                                        currency
                                      )}
                                    </td>

                                    <td className="px-3 py-3 text-right text-ink">
                                      {
                                        line.vatRate
                                      }
                                      %
                                    </td>

                                    <td className="px-3 py-2 text-right">
                                      <input
                                        type="number"
                                        min="0"
                                        max={
                                          line.availableQuantity
                                        }
                                        step="0.01"
                                        className="h-9 w-28 rounded-md border border-ink-3 bg-surface px-2 text-right text-base text-ink"
                                        value={
                                          line.quantity
                                        }
                                        onChange={(
                                          event
                                        ) => {
                                          const value =
                                            event.target
                                              .value;

                                          setCreditLines(
                                            (
                                              current
                                            ) =>
                                              current.map(
                                                (
                                                  item,
                                                  itemIndex
                                                ) =>
                                                  itemIndex ===
                                                  index
                                                    ? {
                                                        ...item,
                                                        quantity:
                                                          value,
                                                      }
                                                    : item
                                              )
                                          );
                                        }}
                                      />
                                    </td>

                                    <td className="px-3 py-3 text-right font-medium text-ink">
                                      {money(
                                        net,
                                        currency
                                      )}
                                    </td>

                                    <td className="px-3 py-3 text-right font-medium text-ink">
                                      {money(
                                        vat,
                                        currency
                                      )}
                                    </td>

                                    <td className="px-3 py-3 text-right font-semibold text-ink">
                                      {money(
                                        gross,
                                        currency
                                      )}
                                    </td>
                                  </tr>
                                );
                              }
                            )}
                          </tbody>
                        </table>
                      </div>
                    ) : null}

                    {creditLines.length > 0 ? (
                      <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-t border-line pt-4">
                        <div className="grid min-w-[280px] gap-1 text-sm">
                          <div className="flex justify-between gap-6 text-ink-3">
                            <span>
                              Subtotal
                            </span>

                            <span>
                              {money(
                                creditDraftTotals()
                                  .net,
                                invoices.find(
                                  (invoice) =>
                                    invoice.id ===
                                    creditInvoiceId
                                )?.currency ||
                                  "GBP"
                              )}
                            </span>
                          </div>

                          <div className="flex justify-between gap-6 text-ink-3">
                            <span>
                              VAT
                            </span>

                            <span>
                              {money(
                                creditDraftTotals()
                                  .vat,
                                invoices.find(
                                  (invoice) =>
                                    invoice.id ===
                                    creditInvoiceId
                                )?.currency ||
                                  "GBP"
                              )}
                            </span>
                          </div>

                          <div className="flex justify-between gap-6 border-t border-line pt-1 text-base font-semibold text-ink">
                            <span>
                              Credit Total
                            </span>

                            <span>
                              {money(
                                creditDraftTotals()
                                  .gross,
                                invoices.find(
                                  (invoice) =>
                                    invoice.id ===
                                    creditInvoiceId
                                )?.currency ||
                                  "GBP"
                              )}
                            </span>
                          </div>
                        </div>

                        <ActionButton
                          working={working}
                          label={
                            editingCreditNote
                              ? "Save Credit Note"
                              : "Save Draft Credit Note"
                          }
                          onClick={
                            editingCreditNote
                              ? saveCreditNote
                              : createCreditNote
                          }
                        />
                      </div>
                    ) : null}
                  </section>

                  <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="m-0 text-md font-semibold text-ink">
                          Credit Notes
                        </h2>

                        <p className="mb-0 mt-1 text-sm text-ink-3">
                          Draft credits do not affect invoice balances until approved.
                        </p>
                      </div>

                      <div className="text-sm text-ink-3">
                        {creditNotes.length}{" "}
                        {creditNotes.length ===
                        1
                          ? "record"
                          : "records"}
                      </div>
                    </div>

                    {creditNotes.length ===
                    0 ? (
                      <div className="rounded-md border border-line bg-canvas p-4 text-sm text-ink-3">
                        No Credit Notes yet.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {creditNotes.map(
                          (note) => {
                            const status =
                              String(
                                note.status ||
                                  "draft"
                              ).toLowerCase();

                            const allocationCount =
                              (
                                note.credit_note_allocations ??
                                []
                              ).length;

                            const canEdit =
                              status ===
                                "draft" &&
                              allocationCount ===
                                0;

                            return (
                              <article
                                key={note.id}
                                className="rounded-lg border border-line bg-canvas p-4"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-4">
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h3 className="m-0 text-base font-semibold text-ink">
                                        {note.credit_note_number ||
                                          "Credit Note"}
                                      </h3>

                                      <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium uppercase text-ink-3">
                                        {
                                          status
                                        }
                                      </span>
                                    </div>

                                    <div className="mt-1 text-sm text-ink-3">
                                      {note.customers
                                        ?.name ||
                                        "Customer"}
                                      {" · "}
                                      Invoice{" "}
                                      {note.invoices
                                        ?.invoice_number ||
                                        "—"}
                                      {" · "}
                                      {
                                        note.issue_date
                                      }
                                    </div>

                                    {note.reason ? (
                                      <div className="mt-2 text-sm text-ink">
                                        {
                                          note.reason
                                        }
                                      </div>
                                    ) : null}
                                  </div>

                                  <div className="min-w-[210px] text-sm">
                                    <div className="flex justify-between gap-6 text-ink-3">
                                      <span>
                                        Subtotal
                                      </span>

                                      <span>
                                        {money(
                                          note.subtotal,
                                          note.currency ||
                                            "GBP"
                                        )}
                                      </span>
                                    </div>

                                    <div className="mt-1 flex justify-between gap-6 text-ink-3">
                                      <span>
                                        VAT
                                      </span>

                                      <span>
                                        {money(
                                          note.vat_total,
                                          note.currency ||
                                            "GBP"
                                        )}
                                      </span>
                                    </div>

                                    <div className="mt-1 flex justify-between gap-6 border-t border-line pt-1 text-base font-semibold text-ink">
                                      <span>
                                        Total
                                      </span>

                                      <span>
                                        {money(
                                          note.total,
                                          note.currency ||
                                            "GBP"
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {(note.credit_note_lines ??
                                  []).length >
                                0 ? (
                                  <div className="mt-3 overflow-x-auto rounded-md border border-line bg-surface">
                                    <table className="w-full min-w-[700px] text-sm">
                                      <thead className="bg-canvas text-left text-ink-3">
                                        <tr>
                                          <th className="px-3 py-2 font-medium">
                                            Description
                                          </th>
                                          <th className="px-3 py-2 text-right font-medium">
                                            Qty
                                          </th>
                                          <th className="px-3 py-2 text-right font-medium">
                                            Rate
                                          </th>
                                          <th className="px-3 py-2 text-right font-medium">
                                            VAT
                                          </th>
                                          <th className="px-3 py-2 text-right font-medium">
                                            Total
                                          </th>
                                        </tr>
                                      </thead>

                                      <tbody>
                                        {(
                                          note.credit_note_lines ??
                                          []
                                        ).map(
                                          (line) => (
                                            <tr
                                              key={
                                                line.id
                                              }
                                              className="border-t border-line"
                                            >
                                              <td className="px-3 py-2 text-ink">
                                                {
                                                  line.description
                                                }
                                              </td>

                                              <td className="px-3 py-2 text-right text-ink">
                                                {
                                                  line.quantity
                                                }
                                              </td>

                                              <td className="px-3 py-2 text-right text-ink">
                                                {money(
                                                  line.unit_price,
                                                  note.currency ||
                                                    "GBP"
                                                )}
                                              </td>

                                              <td className="px-3 py-2 text-right text-ink">
                                                {
                                                  line.vat_rate
                                                }
                                                %
                                              </td>

                                              <td className="px-3 py-2 text-right font-medium text-ink">
                                                {money(
                                                  line.gross_amount,
                                                  note.currency ||
                                                    "GBP"
                                                )}
                                              </td>
                                            </tr>
                                          )
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <div className="mt-3 rounded-md border border-warning-border bg-warning-tint p-3 text-sm text-warning-strong">
                                    Legacy Credit Note: no line-level credit data is stored.
                                  </div>
                                )}

                                {status ===
                                  "draft" &&
                                allocationCount >
                                  0 ? (
                                  <div className="mt-3 rounded-md border border-warning-border bg-warning-tint p-3 text-sm text-warning-strong">
                                    Legacy allocated draft detected. Do not edit or approve this record until its existing allocation has been corrected.
                                  </div>
                                ) : null}

                                <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                                  {canEdit ? (
                                    <>
                                      <button
                                        type="button"
                                        disabled={
                                          working
                                        }
                                        onClick={() =>
                                          void editCreditNote(
                                            note
                                          )
                                        }
                                        className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"
                                      >
                                        Edit
                                      </button>

                                      <button
                                        type="button"
                                        disabled={
                                          working ||
                                          (
                                            note.credit_note_lines ??
                                            []
                                          ).length ===
                                            0
                                        }
                                        onClick={() =>
                                          void creditNoteAction(
                                            note,
                                            "approve"
                                          )
                                        }
                                        className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"
                                      >
                                        Approve & Apply
                                      </button>

                                      <button
                                        type="button"
                                        disabled={
                                          working
                                        }
                                        onClick={() =>
                                          void creditNoteAction(
                                            note,
                                            "cancel"
                                          )
                                        }
                                        className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"
                                      >
                                        Cancel Credit
                                      </button>
                                    </>
                                  ) : null}

                                  {status ===
                                  "approved" ? (
                                    <div className="rounded-md border border-success-border bg-success-tint px-3 py-2 text-sm font-medium text-success-strong">
                                      Applied to invoice
                                    </div>
                                  ) : null}
                                </div>
                              </article>
                            );
                          }
                        )}
                      </div>
                    )}
                  </section>
                </div>
              ) : null}
              {tab === "statements" ? (
                <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                  <h2 className="m-0 mb-3 text-md font-semibold text-ink">Generate Statement</h2>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Customer">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={statementCustomerId}
                        onChange={(event) =>
                          setStatementCustomerId(event.target.value)
                        }
                      >
                        <option value="">Choose customer</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <div className="mt-3">
                    <ActionButton
                      working={working}
                      label="Generate Statement"
                      onClick={createStatement}
                    />
                  </div>

                  <RecordCards rows={rows} />
                </section>
              ) : null}

              {tab === "chase" ? (
                <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                  <h2 className="m-0 mb-3 text-md font-semibold text-ink">Create Chase Letter</h2>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Customer">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={chaseCustomerId}
                        onChange={(event) =>
                          setChaseCustomerId(event.target.value)
                        }
                      >
                        <option value="">Choose customer</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Level">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={chaseLevel}
                        onChange={(event) =>
                          setChaseLevel(event.target.value)
                        }
                      >
                        <option value="reminder_1">Reminder 1</option>
                        <option value="reminder_2">Reminder 2</option>
                        <option value="final_reminder">Final Reminder</option>
                        <option value="account_hold">Account Hold</option>
                      </select>
                    </Field>

                    <Field label="Subject">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={chaseSubject}
                        onChange={(event) =>
                          setChaseSubject(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Message">
                      <textarea
                        className="min-h-24 w-full min-w-0 resize-y rounded-md border border-ink-3 bg-surface px-3 py-2 text-base text-ink"
                        value={chaseBody}
                        onChange={(event) =>
                          setChaseBody(event.target.value)
                        }
                      />
                    </Field>
                  </div>

                  <div className="mt-3">
                    <ActionButton
                      working={working}
                      label="Create Chase Letter"
                      onClick={createChaseLetter}
                    />
                  </div>

                  <RecordCards rows={rows} />
                </section>
              ) : null}

              {tab === "customer-pos" ? (
                <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                  <h2 className="m-0 mb-3 text-md font-semibold text-ink">Customer Purchase Order</h2>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Customer">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={customerPoCustomerId}
                        onChange={(event) =>
                          setCustomerPoCustomerId(event.target.value)
                        }
                      >
                        <option value="">Choose customer</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="PO Number">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={customerPoNumber}
                        onChange={(event) =>
                          setCustomerPoNumber(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Authorised Value">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        type="number"
                        step="0.01"
                        value={customerPoValue}
                        onChange={(event) =>
                          setCustomerPoValue(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Description">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={customerPoDescription}
                        onChange={(event) =>
                          setCustomerPoDescription(event.target.value)
                        }
                      />
                    </Field>
                  </div>

                  <div className="mt-3">
                    <ActionButton
                      working={working}
                      label="Create Customer PO"
                      onClick={createCustomerPo}
                    />
                  </div>

                  <RecordCards rows={rows} />
                </section>
              ) : null}

              {tab === "quotations" && tenantId ? (
                <QuotationPanel
                  tenantId={tenantId}
                  customers={customers}
                />
              ) : null}
              {tab === "supplier-pos" ? (
                <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                  <h2 className="m-0 mb-3 text-md font-semibold text-ink">Supplier / Subcontractor PO</h2>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Subcontractor">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={supplierPoSubcontractorId}
                        onChange={(event) =>
                          setSupplierPoSubcontractorId(event.target.value)
                        }
                      >
                        <option value="">General supplier / not linked</option>
                        {subcontractors.map((subcontractor) => (
                          <option
                            key={subcontractor.id}
                            value={subcontractor.id}
                          >
                            {subcontractor.name}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="PO Number">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={supplierPoNumber}
                        onChange={(event) =>
                          setSupplierPoNumber(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Net">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        type="number"
                        step="0.01"
                        value={supplierPoSubtotal}
                        onChange={(event) =>
                          setSupplierPoSubtotal(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="VAT">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        type="number"
                        step="0.01"
                        value={supplierPoVat}
                        onChange={(event) =>
                          setSupplierPoVat(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Description">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={supplierPoDescription}
                        onChange={(event) =>
                          setSupplierPoDescription(event.target.value)
                        }
                      />
                    </Field>
                  </div>

                  <div className="mt-3">
                    <ActionButton
                      working={working}
                      label="Create Supplier PO"
                      onClick={createSupplierPo}
                    />
                  </div>

                  <RecordCards rows={rows} />
                </section>
              ) : null}

              {tab === "accounting" ? (
                <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                  <h2 className="m-0 mb-3 text-md font-semibold text-ink">Accounting Integration</h2>

                  <article className="mb-4 rounded-lg border border-line bg-surface-2 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <strong className="font-mono text-sm font-semibold text-ink">
                          Xero
                        </strong>

                        <div className="text-sm text-ink-3">
                          Secure OAuth accounting connection
                        </div>
                      </div>

                      <Status
                        value={
                          xeroStatus.connected
                            ? "connected"
                            : xeroStatus.integration?.connection_status ||
                              "not_connected"
                        }
                      />
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Info
                        label="Organisation"
                        value={
                          xeroStatus.integration?.external_tenant_name ||
                          "Not connected"
                        }
                      />

                      <Info
                        label="Connected"
                        value={formatDate(
                          xeroStatus.integration?.connected_at
                        )}
                      />

                      <Info
                        label="Last Sync"
                        value={formatDate(
                          xeroStatus.integration?.last_sync_at
                        )}
                      />

                      <Info
                        label="Currency"
                        value={
                          xeroStatus.integration?.default_currency ||
                          "GBP"
                        }
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2.5">
                      {!xeroStatus.connected ? (
                        <Button
                          variant="secondary"
                          type="button"
                          onClick={connectXero}
                          disabled={xeroWorking}
                        >
                          Connect Xero
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="secondary"
                            type="button"
                            onClick={() => void testXeroConnection()}
                            disabled={xeroWorking}
                          >
                            {xeroWorking
                              ? "Testing..."
                              : "Test Connection"}
                          </Button>

                          <Button
                            variant="danger"
                            type="button"
                            onClick={() => void disconnectXero()}
                            disabled={xeroWorking}
                          >
                            Disconnect Xero
                          </Button>
                        </>
                      )}
                    </div>
                  </article>

                  <p className="mb-3 text-sm text-ink-3">
                    Configure nominal/account codes here. Xero credentials are
                    stored securely on the server and are never exposed to the
                    browser.
                  </p>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Provider">
                      <select
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={provider}
                        onChange={(event) =>
                          setProvider(event.target.value)
                        }
                      >
                        <option value="xero">Xero</option>
                        <option value="quickbooks">QuickBooks Online</option>
                        <option value="sage">Sage</option>
                        <option value="freeagent">FreeAgent</option>
                        <option value="csv">CSV Export</option>
                        <option value="manual">Manual</option>
                      </select>
                    </Field>

                    <Field label="Display Name">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={providerDisplayName}
                        onChange={(event) =>
                          setProviderDisplayName(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Sales Account Code">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={salesAccountCode}
                        onChange={(event) =>
                          setSalesAccountCode(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Purchase Account Code">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={purchaseAccountCode}
                        onChange={(event) =>
                          setPurchaseAccountCode(event.target.value)
                        }
                      />
                    </Field>

                    <Field label="Tax Code">
                      <input
                        className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                        value={taxCode}
                        onChange={(event) =>
                          setTaxCode(event.target.value)
                        }
                      />
                    </Field>
                  </div>

                  <div className="mt-3">
                    <ActionButton
                      working={working}
                      label="Save Provider Settings"
                      onClick={saveAccountingProvider}
                    />
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {integrations
                      .filter(
                        (integration) =>
                          integration.provider !== "xero" ||
                          integration.id !== xeroStatus.integration?.id
                      )
                      .map((integration) => (
                        <article
                          key={integration.id}
                          className="rounded-lg border border-line bg-surface-2 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <strong className="text-ink">
                              {integration.display_name ||
                                integration.provider}
                            </strong>

                            <Status
                              value={integration.connection_status}
                            />
                          </div>

                          <div className="mt-1 text-sm text-ink-3">
                            Provider: {integration.provider}
                          </div>

                          <div className="text-sm text-ink-3">
                            Last sync:{" "}
                            {formatDate(integration.last_sync_at)}
                          </div>
                        </article>
                      ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </main>
      </div>
    </TenantGate>
  );
}

function ReadyToInvoicePanel({
  readyJobs,
  selectedJobs,
  setSelectedJobs,
  selectedReady,
  selectedTotal,
  invoicePoReference,
  setInvoicePoReference,
  invoiceNotes,
  setInvoiceNotes,
  working,
  createInvoice,
}: {
  readyJobs: ReadyJob[];
  selectedJobs: string[];
  setSelectedJobs: React.Dispatch<React.SetStateAction<string[]>>;
  selectedReady: ReadyJob[];
  selectedTotal: number;
  invoicePoReference: string;
  setInvoicePoReference: (value: string) => void;
  invoiceNotes: string;
  setInvoiceNotes: (value: string) => void;
  working: boolean;
  createInvoice: () => Promise<void>;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-md font-semibold text-ink">Ready to Invoice</h2>
          <p className="m-0 text-sm text-ink-3">
            Select completed jobs for one customer to create a consolidated
            invoice.
          </p>
        </div>

        <div className="grid gap-0.5 text-right text-sm">
          <strong className="font-mono tabular-nums text-ink">
            {selectedReady.length} selected
          </strong>
          <span className="font-mono tabular-nums text-ink-2">
            {money(
              selectedTotal,
              selectedReady[0]?.currency_code || "GBP"
            )}
          </span>
        </div>
      </div>

      <div className="my-3 grid gap-3 sm:grid-cols-2">
        <Field label="Customer PO Reference">
          <input
            className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
            value={invoicePoReference}
            onChange={(event) =>
              setInvoicePoReference(event.target.value)
            }
          />
        </Field>

        <Field label="Invoice Notes">
          <input
            className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
            value={invoiceNotes}
            onChange={(event) => setInvoiceNotes(event.target.value)}
          />
        </Field>
      </div>

      <ActionButton
        working={working}
        label="Create Consolidated Invoice"
        onClick={createInvoice}
        disabled={selectedReady.length === 0}
      />

      <div className="mt-3 overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b border-line px-3 py-2 text-left text-kicker uppercase text-ink-2"></th>
              <th className="border-b border-line px-3 py-2 text-left text-kicker uppercase text-ink-2">Job</th>
              <th className="border-b border-line px-3 py-2 text-left text-kicker uppercase text-ink-2">Customer</th>
              <th className="border-b border-line px-3 py-2 text-left text-kicker uppercase text-ink-2">Completed</th>
              <th className="border-b border-line px-3 py-2 text-left text-kicker uppercase text-ink-2">POD</th>
              <th className="border-b border-line px-3 py-2 text-left text-kicker uppercase text-ink-2">PO Required</th>
              <th className="border-b border-line px-3 py-2 text-right text-kicker uppercase text-ink-2">Price</th>
            </tr>
          </thead>

          <tbody>
            {readyJobs.map((job) => (
              <tr key={job.job_id}>
                <td className="border-b border-line px-3 py-2 text-ink">
                  <input
                    type="checkbox"
                    checked={selectedJobs.includes(job.job_id)}
                    onChange={(event) =>
                      setSelectedJobs((current) =>
                        event.target.checked
                          ? [...current, job.job_id]
                          : current.filter((id) => id !== job.job_id)
                      )
                    }
                  />
                </td>

                <td className="border-b border-line px-3 py-2 text-ink">{job.job_reference || job.job_id.slice(0, 8)}</td>
                <td className="border-b border-line px-3 py-2 text-ink">{job.customer_name || "Customer"}</td>
                <td className="border-b border-line px-3 py-2 text-ink">{formatDate(job.completed_at)}</td>
                <td className="border-b border-line px-3 py-2 text-ink">
                  <Status value={job.pod_status || "Not set"} />
                </td>
                <td className="border-b border-line px-3 py-2 text-ink">{job.requires_po ? "Yes" : "No"}</td>
                <td className="border-b border-line px-3 py-2 text-right font-mono tabular-nums text-ink">
                  {money(
                    job.customer_price,
                    job.currency_code || "GBP"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InvoicesPanel({
  invoices,
  editingInvoice,
  editingLines,
  setEditingLines,
  editIssueDate,
  setEditIssueDate,
  editDueDate,
  setEditDueDate,
  editPoReference,
  setEditPoReference,
  editNotes,
  setEditNotes,
  working,
  openInvoiceEditor,
  saveInvoiceEditor,
  xeroConnected,
  xeroInvoiceSyncingId,
  syncInvoiceToXero,
  emailInvoiceSendingId,
  emailInvoice,
  previewInvoice,
  previewWorking,
  openInvoicePreview,
  approveInvoice,
  closeInvoicePreview,
  closeInvoiceEditor,
}: {
  invoices: Invoice[];
  editingInvoice: Invoice | null;
  editingLines: InvoiceLine[];
  setEditingLines: React.Dispatch<React.SetStateAction<InvoiceLine[]>>;
  editIssueDate: string;
  setEditIssueDate: (value: string) => void;
  editDueDate: string;
  setEditDueDate: (value: string) => void;
  editPoReference: string;
  setEditPoReference: (value: string) => void;
  editNotes: string;
  setEditNotes: (value: string) => void;
  working: boolean;
  openInvoiceEditor: (invoice: Invoice) => Promise<void>;
  saveInvoiceEditor: () => Promise<void>;
  xeroConnected: boolean;
  xeroInvoiceSyncingId: string | null;
  syncInvoiceToXero: (invoice: Invoice) => Promise<void>;
  emailInvoiceSendingId: string | null;
  emailInvoice: (invoice: Invoice) => Promise<void>;
  previewInvoice: InvoicePreviewData | null;
  previewWorking: boolean;
  openInvoicePreview: (invoice: Invoice) => Promise<void>;
  approveInvoice: (invoice: Invoice) => Promise<void>;
  closeInvoicePreview: () => void;
  closeInvoiceEditor: () => void;
}) {
  const editableStatuses = new Set([
    "draft",
    "awaiting_pod",
    "approved",
  ]);

  const approvableStatuses = new Set([
    "draft",
    "awaiting_pod",
  ]);

  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      {/* INVOICE_PRINT_ONLY */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden !important;
          }

          #invoice-preview,
          #invoice-preview * {
            visibility: visible !important;
          }

          #invoice-preview {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            box-shadow: none !important;
          }

          #invoice-preview .print\:hidden {
            display: none !important;
          }
        }

        @page {
          size: A4 portrait;
          margin: 12mm;
        }
      `}</style>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-md font-semibold text-ink">
            Invoices
          </h2>

          <p className="m-0 text-sm text-ink-3">
            View, edit, approve and prepare consolidated customer invoices.
          </p>
        </div>
      </div>

      {previewInvoice ? (
        <article
          id="invoice-preview"
          className="mt-4 rounded-xl border border-line bg-white p-6 text-slate-950 shadow-sm print:border-0 print:shadow-none"
        >
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              {previewInvoice.branding?.documentSettings?.show_logo &&
              previewInvoice.branding.documentSettings.logo_signed_url ? (
                <img
                  src={
                    previewInvoice.branding.documentSettings
                      .logo_signed_url
                  }
                  alt="Company logo"
                  className="max-h-20 max-w-44 shrink-0 object-contain"
                />
              ) : null}

              <div className="min-w-0">
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                  {previewInvoice.branding?.companyProfile?.company_name ||
                    previewInvoice.branding?.companyProfile?.trading_name ||
                    "ADR Carriers"}
                </div>

                {[
                  previewInvoice.branding?.companyProfile?.address_line_1,
                  previewInvoice.branding?.companyProfile?.address_line_2,
                  previewInvoice.branding?.companyProfile?.city,
                  previewInvoice.branding?.companyProfile?.region,
                  previewInvoice.branding?.companyProfile?.postcode,
                  previewInvoice.branding?.companyProfile?.country_code,
                ].filter(Boolean).length > 0 ? (
                  <div className="mt-1 max-w-md text-xs leading-5 text-slate-500">
                    {[
                      previewInvoice.branding?.companyProfile?.address_line_1,
                      previewInvoice.branding?.companyProfile?.address_line_2,
                      previewInvoice.branding?.companyProfile?.city,
                      previewInvoice.branding?.companyProfile?.region,
                      previewInvoice.branding?.companyProfile?.postcode,
                      previewInvoice.branding?.companyProfile?.country_code,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </div>
                ) : null}

                {previewInvoice.branding?.documentSettings
                  ?.show_contact_details ? (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    {previewInvoice.branding.companyProfile
                      ?.business_phone ? (
                      <span>
                        Tel:{" "}
                        {
                          previewInvoice.branding.companyProfile
                            .business_phone
                        }
                      </span>
                    ) : null}

                    {previewInvoice.branding.companyProfile
                      ?.business_email ? (
                      <span>
                        {
                          previewInvoice.branding.companyProfile
                            .business_email
                        }
                      </span>
                    ) : null}

                    {previewInvoice.branding.companyProfile
                      ?.website ? (
                      <span>
                        {
                          previewInvoice.branding.companyProfile
                            .website
                        }
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <h3 className="mt-3 text-2xl font-bold">
                  Invoice
                </h3>

                <div className="mt-1 font-mono text-lg">
                  {previewInvoice.invoice.invoice_number || "Invoice"}
                </div>
              </div>
            </div>

            <div className="print:hidden flex flex-wrap gap-2">
              {["approved", "sent"].includes(
                String(previewInvoice.invoice.status || "").toLowerCase()
              ) ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={
                    emailInvoiceSendingId ===
                    previewInvoice.invoice.id
                  }
                  onClick={() =>
                    void emailInvoice(
                      previewInvoice.invoice
                    )
                  }
                >
                  {emailInvoiceSendingId ===
                  previewInvoice.invoice.id
                    ? "Emailing..."
                    : "Email Invoice + POD"}
                </Button>
              ) : null}

              {xeroConnected &&
              ["approved", "sent"].includes(
                String(previewInvoice.invoice.status || "").toLowerCase()
              ) &&
              !previewInvoice.invoice.accounting_invoice_id ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={
                    xeroInvoiceSyncingId === previewInvoice.invoice.id
                  }
                  onClick={() =>
                    void syncInvoiceToXero(previewInvoice.invoice)
                  }
                >
                  {xeroInvoiceSyncingId === previewInvoice.invoice.id
                    ? "Syncing..."
                    : "Sync this invoice to Xero"}
                </Button>
              ) : null}

              <Button
                type="button"
                variant="secondary"
                onClick={() => window.print()}
              >
                Print / Save PDF
              </Button>

              <Button
                type="button"
                variant="secondary"
                onClick={closeInvoicePreview}
              >
                Close
              </Button>
            </div>
          </div>

          {(previewInvoice.branding?.documentSettings
            ?.show_company_registration &&
            previewInvoice.branding?.companyProfile
              ?.registration_number) ||
          (previewInvoice.branding?.documentSettings
            ?.show_vat_number &&
            previewInvoice.branding?.companyProfile
              ?.vat_number) ? (
            <div
              data-invoice-company-details="true"
              className="mb-4 flex flex-wrap justify-end gap-x-5 gap-y-1 text-xs text-slate-500"
            >
              {previewInvoice.branding?.documentSettings
                ?.show_company_registration &&
              previewInvoice.branding?.companyProfile
                ?.registration_number ? (
                <span>
                  Company No:{" "}
                  {
                    previewInvoice.branding.companyProfile
                      .registration_number
                  }
                </span>
              ) : null}

              {previewInvoice.branding?.documentSettings
                ?.show_vat_number &&
              previewInvoice.branding?.companyProfile
                ?.vat_number ? (
                <span>
                  VAT No:{" "}
                  {
                    previewInvoice.branding.companyProfile
                      .vat_number
                  }
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-5 border-y border-slate-200 py-5 md:grid-cols-2">
            <div className="space-y-2">
              <div>
                <span className="text-xs font-bold uppercase text-slate-500">
                  Customer
                </span>
                <div className="font-semibold">
                  {previewInvoice.invoice.customer_name || "Customer"}
                </div>
              </div>

              <div>
                <span className="text-xs font-bold uppercase text-slate-500">
                  Customer reference
                </span>
                <div>
                  {previewInvoice.invoice.customer_reference || "—"}
                </div>
              </div>

              <div>
                <span className="text-xs font-bold uppercase text-slate-500">
                  PO reference
                </span>
                <div>
                  {previewInvoice.invoice.po_reference || "—"}
                </div>
              </div>
            </div>

            <div className="space-y-2 md:text-right">
              <div>
                <span className="text-xs font-bold uppercase text-slate-500">
                  Issue date
                </span>
                <div>
                  {formatDate(previewInvoice.invoice.issue_date)}
                </div>
              </div>

              <div>
                <span className="text-xs font-bold uppercase text-slate-500">
                  Due date
                </span>
                <div>
                  {formatDate(previewInvoice.invoice.due_date)}
                </div>
              </div>

              <div>
                <span className="text-xs font-bold uppercase text-slate-500">
                  Status
                </span>
                <div className="capitalize">
                  {(previewInvoice.invoice.status || "draft").replaceAll(
                    "_",
                    " "
                  )}
                </div>
              </div>
            </div>
          </div>

          {previewInvoice.jobs.length > 0 ? (
            <div className="mt-5">
              <h4 className="mb-2 text-sm font-bold uppercase text-slate-500">
                Jobs / RMA references
              </h4>

              <div className="flex flex-wrap gap-2">
                {previewInvoice.jobs.map((job) => (
                  <div
                    key={job.job_id}
                    className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                  >
                    <strong>{job.reference || job.job_id.slice(0, 8)}</strong>

                    {job.external_reference ? (
                      <div className="text-xs text-slate-500">
                        {job.external_reference}
                      </div>
                    ) : null}

                    <div className="text-xs capitalize text-slate-500">
                      POD: {(job.pod_status || "not set").replaceAll("_", " ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-2 text-left">
                    Description
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right">
                    Qty
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right">
                    Rate
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right">
                    VAT
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right">
                    Net
                  </th>
                </tr>
              </thead>

              <tbody>
                {previewInvoice.lines.map((line) => {
                  const quantity = Number(line.quantity ?? 0);
                  const rate = Number(line.unit_price ?? 0);
                  const net = quantity * rate;

                  return (
                    <tr key={line.id}>
                      <td className="border-b border-slate-200 px-3 py-3">
                        {line.description || "Transport service"}
                      </td>

                      <td className="border-b border-slate-200 px-3 py-3 text-right font-mono">
                        {quantity}
                      </td>

                      <td className="border-b border-slate-200 px-3 py-3 text-right font-mono">
                        {money(
                          rate,
                          previewInvoice.invoice.currency || "GBP"
                        )}
                      </td>

                      <td className="border-b border-slate-200 px-3 py-3 text-right font-mono">
                        {Number(line.vat_rate ?? 0)}%
                      </td>

                      <td className="border-b border-slate-200 px-3 py-3 text-right font-mono">
                        {money(
                          net,
                          previewInvoice.invoice.currency || "GBP"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="ml-auto mt-5 grid max-w-sm gap-2">
            <div className="flex justify-between gap-6">
              <span>Subtotal</span>
              <strong className="font-mono">
                {money(
                  previewInvoice.invoice.subtotal,
                  previewInvoice.invoice.currency || "GBP"
                )}
              </strong>
            </div>

            <div className="flex justify-between gap-6">
              <span>VAT</span>
              <strong className="font-mono">
                {money(
                  previewInvoice.invoice.vat_total,
                  previewInvoice.invoice.currency || "GBP"
                )}
              </strong>
            </div>

            <div className="flex justify-between gap-6 border-t border-slate-300 pt-2 text-lg">
              <span>Total</span>
              <strong className="font-mono">
                {money(
                  previewInvoice.invoice.total,
                  previewInvoice.invoice.currency || "GBP"
                )}
              </strong>
            </div>

            <div className="flex justify-between gap-6">
              <span>Balance due</span>
              <strong className="font-mono">
                {money(
                  previewInvoice.invoice.balance_due,
                  previewInvoice.invoice.currency || "GBP"
                )}
              </strong>
            </div>
          </div>

          {previewInvoice.invoice.notes ? (
            <div className="mt-5 rounded-lg bg-slate-50 p-3 text-sm">
              <strong>Notes:</strong>{" "}
              {previewInvoice.invoice.notes}
            </div>
          ) : null}

          <div className="mt-5 border-t border-slate-200 pt-4">
            <div className="text-xs font-bold uppercase text-slate-500">
              Accounting
            </div>

            <div className="mt-1 text-sm">
              Xero sync:{" "}
              <strong className="capitalize">
                {(
                  previewInvoice.invoice.accounting_sync_status ||
                  "not_synced"
                ).replaceAll("_", " ")}
              </strong>
            </div>

            {previewInvoice.invoice.accounting_sync_error ? (
              <div className="mt-1 text-sm text-red-700">
                {previewInvoice.invoice.accounting_sync_error}
              </div>
            ) : null}
          </div>

          {previewInvoice.branding?.documentSettings
            ?.bank_details ? (
            <div className="mt-6 border-t border-slate-200 pt-4">
              <div className="text-xs font-bold uppercase text-slate-500">
                Payment Details
              </div>

              <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                {
                  previewInvoice.branding.documentSettings
                    .bank_details
                }
              </div>
            </div>
          ) : null}

          {previewInvoice.branding?.documentSettings
            ?.generic_document_note ? (
            <div className="mt-4 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-slate-600">
              {
                previewInvoice.branding.documentSettings
                  .generic_document_note
              }
            </div>
          ) : null}

          {previewInvoice.branding?.documentSettings
            ?.footer_text ? (
            <footer
              data-invoice-document-footer="true"
              className="mt-6 border-t border-slate-200 pt-4 text-center text-xs leading-5 text-slate-500"
            >
              <div className="whitespace-pre-wrap">
                {
                  previewInvoice.branding.documentSettings
                    .footer_text
                }
              </div>
            </footer>
          ) : null}
        </article>
      ) : null}

      {editingInvoice ? (
        <div className="mt-4 rounded-lg border border-line bg-surface-2 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="m-0 text-md font-semibold text-ink">
                Edit {editingInvoice.invoice_number || "Invoice"}
              </h3>

              <div className="mt-1 text-sm text-ink-3">
                {editingInvoice.customer_name || "Customer"}
              </div>
            </div>

            <Button
              type="button"
              variant="secondary"
              onClick={closeInvoiceEditor}
              disabled={working}
            >
              Cancel
            </Button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Issue Date">
              <input
                type="date"
                className="h-10 w-full rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                value={editIssueDate}
                onChange={(event) => setEditIssueDate(event.target.value)}
              />
            </Field>

            <Field label="Due Date">
              <input
                type="date"
                className="h-10 w-full rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                value={editDueDate}
                onChange={(event) => setEditDueDate(event.target.value)}
              />
            </Field>

            <Field label="PO Reference">
              <input
                className="h-10 w-full rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                value={editPoReference}
                onChange={(event) =>
                  setEditPoReference(event.target.value)
                }
              />
            </Field>

            <Field label="Notes">
              <input
                className="h-10 w-full rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                value={editNotes}
                onChange={(event) => setEditNotes(event.target.value)}
              />
            </Field>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-line px-3 py-2 text-left">
                    Description
                  </th>
                  <th className="border-b border-line px-3 py-2 text-right">
                    Qty
                  </th>
                  <th className="border-b border-line px-3 py-2 text-right">
                    Unit Price
                  </th>
                  <th className="border-b border-line px-3 py-2 text-right">
                    VAT %
                  </th>
                  <th className="border-b border-line px-3 py-2 text-right">
                    Net
                  </th>
                </tr>
              </thead>

              <tbody>
                {editingLines.map((line, index) => (
                  <tr key={line.id}>
                    <td className="border-b border-line p-2">
                      <input
                        className="h-10 min-w-64 w-full rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                        value={line.description || ""}
                        onChange={(event) =>
                          setEditingLines((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    description: event.target.value,
                                  }
                                : item
                            )
                          )
                        }
                      />
                    </td>

                    <td className="border-b border-line p-2 text-right">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        className="h-10 w-24 rounded-md border border-ink-3 bg-surface px-3 text-right text-base text-ink"
                        value={line.quantity ?? 1}
                        onChange={(event) =>
                          setEditingLines((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    quantity: Number(event.target.value),
                                  }
                                : item
                            )
                          )
                        }
                      />
                    </td>

                    <td className="border-b border-line p-2 text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="h-10 w-32 rounded-md border border-ink-3 bg-surface px-3 text-right text-base text-ink"
                        value={line.unit_price ?? 0}
                        onChange={(event) =>
                          setEditingLines((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    unit_price: Number(event.target.value),
                                  }
                                : item
                            )
                          )
                        }
                      />
                    </td>

                    <td className="border-b border-line p-2 text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="h-10 w-24 rounded-md border border-ink-3 bg-surface px-3 text-right text-base text-ink"
                        value={line.vat_rate ?? 0}
                        onChange={(event) =>
                          setEditingLines((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    vat_rate: Number(event.target.value),
                                  }
                                : item
                            )
                          )
                        }
                      />
                    </td>

                    <td className="border-b border-line px-3 py-2 text-right font-mono">
                      {money(
                        Number(line.quantity ?? 0) *
                          Number(line.unit_price ?? 0),
                        editingInvoice.currency || "GBP"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex justify-end">
            <ActionButton
              working={working}
              label="Save Invoice"
              onClick={saveInvoiceEditor}
            />
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {invoices.length === 0 ? (
          <p className="col-span-full py-10 text-center text-sm text-ink-3">
            No invoices yet.
          </p>
        ) : (
          invoices.map((invoice) => {
            const status =
              String(invoice.status || "draft").toLowerCase();

            const canEdit =
              editableStatuses.has(status);

            const canApprove =
              approvableStatuses.has(status);

            return (
              <article
                key={invoice.id}
                className="rounded-lg border border-line bg-surface-2 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <strong className="font-mono text-sm font-semibold text-ink">
                      {invoice.invoice_number || "Invoice"}
                    </strong>

                    <div className="text-sm text-ink-3">
                      {invoice.customer_name || "Customer"}
                    </div>
                  </div>

                  <Status value={invoice.status || "draft"} />
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Info
                    label="Issue Date"
                    value={formatDate(invoice.issue_date)}
                  />

                  <Info
                    label="Due Date"
                    value={formatDate(invoice.due_date)}
                  />

                  <Info
                    label="Total"
                    value={money(
                      invoice.total,
                      invoice.currency || "GBP"
                    )}
                  />

                  <Info
                    label="Balance"
                    value={money(
                      invoice.balance_due,
                      invoice.currency || "GBP"
                    )}
                  />

                  <Info
                    label="Accounting"
                    value={
                      invoice.accounting_sync_status ||
                      "not_synced"
                    }
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={previewWorking}
                    onClick={() =>
                      void openInvoicePreview(invoice)
                    }
                  >
                    View / Preview
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!canEdit || working}
                    onClick={() =>
                      void openInvoiceEditor(invoice)
                    }
                  >
                    {canEdit
                      ? "Edit Invoice"
                      : "Invoice Locked"}
                  </Button>

                  {["approved", "sent"].includes(status) ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={
                        emailInvoiceSendingId ===
                        invoice.id
                      }
                      onClick={() =>
                        void emailInvoice(invoice)
                      }
                    >
                      {emailInvoiceSendingId ===
                      invoice.id
                        ? "Emailing..."
                        : "Email Invoice + POD"}
                    </Button>
                  ) : null}

                  {xeroConnected ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={
                        xeroInvoiceSyncingId === invoice.id ||
                        !["approved", "sent"].includes(status) ||
                        Boolean(invoice.accounting_invoice_id) ||
                        invoice.accounting_sync_status === "synced"
                      }
                      onClick={() =>
                        void syncInvoiceToXero(invoice)
                      }
                    >
                      {xeroInvoiceSyncingId === invoice.id
                        ? "Syncing..."
                        : invoice.accounting_invoice_id ||
                            invoice.accounting_sync_status === "synced"
                          ? "Synced to Xero"
                          : "Sync to Xero"}
                    </Button>
                  ) : null}
                  {canApprove ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={previewWorking}
                      onClick={() =>
                        void approveInvoice(invoice)
                      }
                    >
                      Approve
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
function RecordCards({ rows }: { rows: GenericRow[] }) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.length === 0 ? (
        <p className="col-span-full py-10 text-center text-sm text-ink-3">No records yet.</p>
      ) : (
        rows.map((row, index) => (
          <article
            key={String(row.id ?? index)}
            className="rounded-lg border border-line bg-surface-2 p-3"
          >
            <pre className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-xs text-ink-2">
              {JSON.stringify(row, null, 2)}
            </pre>
          </article>
        ))
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      {children}
    </label>
  );
}

function ActionButton({
  working,
  label,
  onClick,
  disabled = false,
}: {
  working: boolean;
  label: string;
  onClick: () => Promise<void>;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      disabled={working || disabled}
      onClick={() => void onClick()}
    >
      {working ? "Working..." : label}
    </Button>
  );
}

function Status({ value }: { value: string }) {
  return (
    <Badge tone="neutral">
      <span className="capitalize">{value.replaceAll("_", " ")}</span>
    </Badge>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="text-sm">
      <span className="text-kicker uppercase text-ink-2">{label}</span>{" "}
      <strong className="block text-ink">{value}</strong>
    </div>
  );
}

function money(
  value: number | null | undefined,
  currency: string
) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency || "GBP",
  }).format(Number(value ?? 0));
}

function formatDate(value: string | null | undefined) {
  if (!value) return "â€”";

  const date = new Date(
    value.includes("T") ? value : `${value}T00:00:00`
  );

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GB");
}
