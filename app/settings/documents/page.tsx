"use client";

import {
  ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import Button from "../../../components/Button";
import Card from "../../../components/Card";


import { useTenant } from "../../components/TenantProvider";

type CompanyProfile = {
  tenant_id: string;
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
};

type DocumentSettings = {
  logo_path: string | null;
  footer_text: string;
  bank_details: string;
  generic_document_note: string;
  show_logo: boolean;
  show_company_registration: boolean;
  show_vat_number: boolean;
  show_contact_details: boolean;
};

type QuotationTemplate = {
  heading: string;
  intro_text: string;
  default_notes: string;
  default_terms: string;
  footer_text: string;
  default_valid_days: number;
  email_subject_template: string;
  email_body_template: string;
  auto_create_job_on_accept: boolean;
  show_company_registration: boolean;
  show_vat_number: boolean;
  show_route_details: boolean;
  show_line_vat: boolean;
};

const emptyDocumentSettings:
  DocumentSettings = {
  logo_path: null,
  footer_text: "",
  bank_details: "",
  generic_document_note: "",
  show_logo: true,
  show_company_registration: true,
  show_vat_number: true,
  show_contact_details: true,
};

const emptyQuotationTemplate:
  QuotationTemplate = {
  heading: "Quotation",
  intro_text: "",
  default_notes: "",
  default_terms:
    "Quotation valid for 14 days from date of issue.",
  footer_text: "",
  default_valid_days: 14,
  email_subject_template:
    "Quotation {{quote_number}} from {{company_name}}",
  email_body_template:
    "Please review quotation {{quote_number}} using the secure link below.",
  auto_create_job_on_accept:
    false,
  show_company_registration:
    true,
  show_vat_number:
    true,
  show_route_details:
    true,
  show_line_vat:
    true,
};

function text(
  value: unknown
): string {
  return String(
    value ?? ""
  );
}

export default function DocumentsSettingsPage() {

  const {
    activeTenantId,
    writeTenantId,
    status: tenantStatus,
  } = useTenant();

  const [
    tenantId,
    setTenantId,
  ] = useState("");

  const [
    company,
    setCompany,
  ] =
    useState<CompanyProfile | null>(
      null
    );

  const [
    documentSettings,
    setDocumentSettings,
  ] =
    useState<DocumentSettings>(
      emptyDocumentSettings
    );

  const [
    quotationTemplate,
    setQuotationTemplate,
  ] =
    useState<QuotationTemplate>(
      emptyQuotationTemplate
    );

  const [
    logoUrl,
    setLogoUrl,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    uploading,
    setUploading,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    error,
    setError,
  ] = useState("");

  const [
    autoSaveStatus,
    setAutoSaveStatus,
  ] = useState<
    "idle" |
    "dirty" |
    "saving" |
    "saved" |
    "error"
  >("idle");

  const hydratedRef =
    useRef(false);

  const lastSavedSnapshotRef =
    useRef("");

  const autoSaveRequestRef =
    useRef(0);

  const autoSaveTimerRef =
    useRef<
      ReturnType<
        typeof setTimeout
      > | null
    >(null);

  useEffect(() => {
    let cancelled =
      false;

    async function init() {
      hydratedRef.current = false;

      if (
        autoSaveTimerRef.current
      ) {
        clearTimeout(
          autoSaveTimerRef.current
        );

        autoSaveTimerRef.current =
          null;
      }

      setAutoSaveStatus(
        "idle"
      );

      setLoading(true);
      setError("");

      try {
        const companyId =
          String(
            writeTenantId ??
              activeTenantId ??
              ""
          );

        if (!companyId) {
          if (
            tenantStatus ===
            "loading"
          ) {
            return;
          }

          throw new Error(
            "No active company is selected."
          );
        }

        const response =
          await fetch(
            `/api/settings/documents?tenantId=${encodeURIComponent(
              companyId
            )}`,
            {
              cache:
                "no-store",
            }
          );

        const body =
          await response.json();

        if (
          !response.ok
        ) {
          throw new Error(
            body.error ||
              "Unable to load document settings."
          );
        }

        if (cancelled) {
          return;
        }

        setTenantId(
          companyId
        );

        setCompany(
          body.companyProfile ??
            null
        );

        const savedDocument =
          body.documentSettings;

        const savedQuotation =
          body.quotationTemplate;
        const hydratedDocumentSettings: DocumentSettings = {
          logo_path:
            savedDocument?.logo_path ??
            null,

          footer_text:
            text(
              savedDocument?.footer_text
            ),

          bank_details:
            text(
              savedDocument?.bank_details
            ),

          generic_document_note:
            text(
              savedDocument?.generic_document_note
            ),

          show_logo:
            savedDocument?.show_logo ??
            true,

          show_company_registration:
            savedDocument?.show_company_registration ??
            true,

          show_vat_number:
            savedDocument?.show_vat_number ??
            true,

          show_contact_details:
            savedDocument?.show_contact_details ??
            true,
        };

        const hydratedQuotationTemplate: QuotationTemplate = {
          heading:
            text(
              savedQuotation?.heading
            ) ||
            "Quotation",

          intro_text:
            text(
              savedQuotation?.intro_text
            ),

          default_notes:
            text(
              savedQuotation?.default_notes
            ),

          default_terms:
            text(
              savedQuotation?.default_terms
            ) ||
            emptyQuotationTemplate.default_terms,

          footer_text:
            text(
              savedQuotation?.footer_text
            ),

          default_valid_days:
            Number(
              savedQuotation?.default_valid_days ??
                14
            ),

          email_subject_template:
            text(
              savedQuotation?.email_subject_template
            ) ||
            emptyQuotationTemplate.email_subject_template,

          email_body_template:
            text(
              savedQuotation?.email_body_template
            ) ||
            emptyQuotationTemplate.email_body_template,

          auto_create_job_on_accept:
            savedQuotation?.auto_create_job_on_accept ??
            false,

          show_company_registration:
            savedQuotation?.show_company_registration ??
            true,

          show_vat_number:
            savedQuotation?.show_vat_number ??
            true,

          show_route_details:
            savedQuotation?.show_route_details ??
            true,

          show_line_vat:
            savedQuotation?.show_line_vat ??
            true,
        };

        setDocumentSettings(
          hydratedDocumentSettings
        );

        setQuotationTemplate(
          hydratedQuotationTemplate
        );

        lastSavedSnapshotRef.current =
          JSON.stringify({
            tenantId:
              companyId,

            documentSettings:
              hydratedDocumentSettings,

            quotationTemplate:
              hydratedQuotationTemplate,
          });

        hydratedRef.current =
          true;

        setAutoSaveStatus(
          "saved"
        );

        setLogoUrl(
          text(
            savedDocument?.logo_signed_url
          )
        );
      }
      catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load document settings."
          );
        }
      }
      finally {
        if (!cancelled) {
          setLoading(
            false
          );
        }
      }
    }

    void init();

    return () => {
      cancelled =
        true;
    };
  }, [
    activeTenantId,
    tenantStatus,
    writeTenantId,
  ]);

  async function uploadLogo(
    event:
      ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target.files?.[0];

    event.target.value =
      "";

    if (!file) {
      return;
    }

    setError("");
    setMessage("");

    if (!tenantId) {
      setError(
        "Company is not loaded."
      );
      return;
    }

    const allowedTypes =
      new Set([
        "image/png",
        "image/jpeg",
        "image/webp",
      ]);

    if (
      !allowedTypes.has(
        file.type
      )
    ) {
      setError(
        "Logo must be PNG, JPG or WEBP."
      );
      return;
    }

    if (
      file.size >
      5 * 1024 * 1024
    ) {
      setError(
        "Logo must be 5 MB or smaller."
      );
      return;
    }

    setUploading(true);

    try {
      const formData =
        new FormData();

      formData.append(
        "tenantId",
        tenantId
      );

      formData.append(
        "file",
        file
      );

      const response =
        await fetch(
          "/api/settings/documents/logo",
          {
            method:
              "POST",

            body:
              formData,
          }
        );

      const body =
        await response.json();

      if (!response.ok) {
        throw new Error(
          body.error ||
            "Unable to upload logo."
        );
      }

      setDocumentSettings(
        (current) => ({
          ...current,

          logo_path:
            body.logoPath ??
            null,

          show_logo:
            true,
        })
      );

      setLogoUrl(
        String(
          body.logoSignedUrl ??
            ""
        )
      );

      setMessage(
        "Logo uploaded and saved."
      );
    }
    catch (uploadFailure) {
      setError(
        uploadFailure instanceof Error
          ? uploadFailure.message
          : "Unable to upload logo."
      );
    }
    finally {
      setUploading(
        false
      );
    }
  }
  async function removeLogo() {
    if (!tenantId) {
      setError(
        "Company is not loaded."
      );
      return;
    }

    setUploading(true);
    setError("");
    setMessage("");

    try {
      const response =
        await fetch(
          "/api/settings/documents/logo",
          {
            method:
              "DELETE",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                tenantId,
              }),
          }
        );

      const body =
        await response.json();

      if (!response.ok) {
        throw new Error(
          body.error ||
            "Unable to remove logo."
        );
      }

      setDocumentSettings(
        (current) => ({
          ...current,

          logo_path:
            null,
        })
      );

      setLogoUrl("");

      setMessage(
        "Logo removed."
      );
    }
    catch (removeFailure) {
      setError(
        removeFailure instanceof Error
          ? removeFailure.message
          : "Unable to remove logo."
      );
    }
    finally {
      setUploading(
        false
      );
    }
  }
  const persistSettings =
    useCallback(
      async (
        targetTenantId: string,
        nextDocumentSettings: DocumentSettings,
        nextQuotationTemplate: QuotationTemplate
      ) => {
        const response =
          await fetch(
            "/api/settings/documents",
            {
              method:
                "PUT",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body:
                JSON.stringify({
                  tenantId:
                    targetTenantId,

                  documentSettings:
                    nextDocumentSettings,

                  quotationTemplate:
                    nextQuotationTemplate,
                }),
            }
          );

        const body =
          await response.json();

        if (!response.ok) {
          throw new Error(
            body.error ||
              "Unable to save document settings."
          );
        }

        return body;
      },
      []
    );
  async function save() {
    if (!tenantId) {
      setError(
        "Company is not loaded."
      );
      return;
    }

    if (
      autoSaveTimerRef.current
    ) {
      clearTimeout(
        autoSaveTimerRef.current
      );

      autoSaveTimerRef.current =
        null;
    }

    setSaving(true);
    setMessage("");
    setError("");
    setAutoSaveStatus(
      "saving"
    );

    try {
      await persistSettings(
        tenantId,
        documentSettings,
        quotationTemplate
      );

      lastSavedSnapshotRef.current =
        JSON.stringify({
          tenantId,
          documentSettings,
          quotationTemplate,
        });

      setAutoSaveStatus(
        "saved"
      );

      setMessage(
        "Documents & Branding settings saved."
      );
    }
    catch (saveError) {
      setAutoSaveStatus(
        "error"
      );

      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save document settings."
      );
    }
    finally {
      setSaving(
        false
      );
    }
  }
  useEffect(() => {
    if (
      !hydratedRef.current ||
      loading ||
      !tenantId
    ) {
      return;
    }

    const snapshot =
      JSON.stringify({
        tenantId,
        documentSettings,
        quotationTemplate,
      });

    if (
      snapshot ===
      lastSavedSnapshotRef.current
    ) {
      return;
    }

    setAutoSaveStatus(
      "dirty"
    );

    if (
      autoSaveTimerRef.current
    ) {
      clearTimeout(
        autoSaveTimerRef.current
      );
    }

    const requestId =
      autoSaveRequestRef.current +
      1;

    autoSaveRequestRef.current =
      requestId;

    autoSaveTimerRef.current =
      setTimeout(
        () => {
          void (
            async () => {
              if (
                requestId !==
                autoSaveRequestRef.current
              ) {
                return;
              }

              setAutoSaveStatus(
                "saving"
              );

              try {
                await persistSettings(
                  tenantId,
                  documentSettings,
                  quotationTemplate
                );

                if (
                  requestId !==
                  autoSaveRequestRef.current
                ) {
                  return;
                }

                lastSavedSnapshotRef.current =
                  snapshot;

                setAutoSaveStatus(
                  "saved"
                );
              }
              catch (saveError) {
                if (
                  requestId !==
                  autoSaveRequestRef.current
                ) {
                  return;
                }

                setAutoSaveStatus(
                  "error"
                );

                setError(
                  saveError instanceof Error
                    ? saveError.message
                    : "Autosave failed."
                );
              }
            }
          )();
        },
        1200
      );

    return () => {
      if (
        autoSaveTimerRef.current
      ) {
        clearTimeout(
          autoSaveTimerRef.current
        );

        autoSaveTimerRef.current =
          null;
      }
    };
  }, [
    documentSettings,
    loading,
    persistSettings,
    quotationTemplate,
    tenantId,
  ]);
  const companyAddress =
    [
      company?.address_line_1,
      company?.address_line_2,
      company?.city,
      company?.region,
      company?.postcode,
      company?.country_code,
    ]
      .filter(Boolean)
      .join(", ");

  if (loading) {
    return (
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <Card>
            Loading document settings...
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="ds min-h-screen bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-[1480px] px-6 py-8">
        <header className="mb-5">
          <div className="text-kicker uppercase text-ink-3">
            Settings
          </div>

          <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
            Documents & Branding
          </h1>

          <p className="m-0 max-w-3xl text-sm text-ink-3">
            Configure shared branding and document defaults. Company identity and address details continue to come from Company Profile.
          </p>
        </header>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {message ? (
          <div className="mb-4 rounded-lg border border-line bg-surface p-3 text-sm text-ink">
            {message}
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="grid gap-4">
            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="mb-1 mt-0 text-md font-semibold text-ink">
                Shared Branding
              </h2>

              <p className="mb-4 mt-0 text-sm text-ink-3">
                Used across quotations, invoices, statements, credit notes, purchase orders and other documents.
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-sm font-medium text-ink-2">
                    Company Logo
                  </div>

                  <div className="mt-2 flex min-h-32 items-center justify-center rounded-lg border border-dashed border-line bg-surface-2 p-4">
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt="Company logo"
                        className="max-h-28 max-w-full object-contain"
                      />
                    ) : (
                      <span className="text-sm text-ink-3">
                        No logo uploaded
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <label className="inline-flex cursor-pointer items-center rounded-md border border-line bg-surface-2 px-3 py-2 text-sm font-medium text-ink hover:bg-surface">
                      {uploading
                        ? "Working..."
                        : logoUrl
                          ? "Replace Logo"
                          : "Upload Logo"}

                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        disabled={uploading}
                        onChange={uploadLogo}
                      />
                    </label>

                    {documentSettings.logo_path ? (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={uploading}
                        onClick={() =>
                          void removeLogo()
                        }
                      >
                        Remove Logo
                      </Button>
                    ) : null}
                  </div>

                  <p className="mb-0 mt-2 text-xs text-ink-3">
                    PNG, JPG or WEBP. Maximum 5 MB.
                  </p>
                </div>

                <div className="grid gap-3">
                  <CheckField
                    label="Show logo on documents"
                    checked={documentSettings.show_logo}
                    onChange={(checked) =>
                      setDocumentSettings((current) => ({
                        ...current,
                        show_logo: checked,
                      }))
                    }
                  />

                  <CheckField
                    label="Show company registration number"
                    checked={
                      documentSettings.show_company_registration
                    }
                    onChange={(checked) =>
                      setDocumentSettings((current) => ({
                        ...current,
                        show_company_registration: checked,
                      }))
                    }
                  />

                  <CheckField
                    label="Show VAT number"
                    checked={
                      documentSettings.show_vat_number
                    }
                    onChange={(checked) =>
                      setDocumentSettings((current) => ({
                        ...current,
                        show_vat_number: checked,
                      }))
                    }
                  />

                  <CheckField
                    label="Show company contact details"
                    checked={
                      documentSettings.show_contact_details
                    }
                    onChange={(checked) =>
                      setDocumentSettings((current) => ({
                        ...current,
                        show_contact_details: checked,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <TextArea
                  label="Default Document Footer"
                  value={documentSettings.footer_text}
                  onChange={(value) =>
                    setDocumentSettings((current) => ({
                      ...current,
                      footer_text: value,
                    }))
                  }
                  placeholder="Company registration details, legal footer or general document footer."
                />

                <TextArea
                  label="Bank / Payment Details"
                  value={documentSettings.bank_details}
                  onChange={(value) =>
                    setDocumentSettings((current) => ({
                      ...current,
                      bank_details: value,
                    }))
                  }
                  placeholder="Bank name, account details or payment instructions."
                />

                <div className="md:col-span-2">
                  <TextArea
                    label="Generic Document Note"
                    value={
                      documentSettings.generic_document_note
                    }
                    onChange={(value) =>
                      setDocumentSettings((current) => ({
                        ...current,
                        generic_document_note: value,
                      }))
                    }
                    placeholder="Optional note that can be reused across document types."
                  />
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="mb-1 mt-0 text-md font-semibold text-ink">
                Quotation Defaults
              </h2>

              <p className="mb-4 mt-0 text-sm text-ink-3">
                These settings apply specifically to quotations. Collection and delivery stops remain part of each individual quotation.
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  label="Heading"
                  value={quotationTemplate.heading}
                  onChange={(value) =>
                    setQuotationTemplate((current) => ({
                      ...current,
                      heading: value,
                    }))
                  }
                />

                <NumberInput
                  label="Default Validity (Days)"
                  value={
                    quotationTemplate.default_valid_days
                  }
                  min={1}
                  max={365}
                  onChange={(value) =>
                    setQuotationTemplate((current) => ({
                      ...current,
                      default_valid_days: value,
                    }))
                  }
                />

                <div className="md:col-span-2">
                  <TextArea
                    label="Introduction"
                    value={quotationTemplate.intro_text}
                    onChange={(value) =>
                      setQuotationTemplate((current) => ({
                        ...current,
                        intro_text: value,
                      }))
                    }
                  />
                </div>

                <TextArea
                  label="Default Notes"
                  value={quotationTemplate.default_notes}
                  onChange={(value) =>
                    setQuotationTemplate((current) => ({
                      ...current,
                      default_notes: value,
                    }))
                  }
                />

                <TextArea
                  label="Default Terms"
                  value={quotationTemplate.default_terms}
                  onChange={(value) =>
                    setQuotationTemplate((current) => ({
                      ...current,
                      default_terms: value,
                    }))
                  }
                />

                <div className="md:col-span-2">
                  <Input
                    label="Quotation Email Subject"
                    value={
                      quotationTemplate.email_subject_template
                    }
                    onChange={(value) =>
                      setQuotationTemplate((current) => ({
                        ...current,
                        email_subject_template: value,
                      }))
                    }
                  />

                  <p className="mb-0 mt-1 text-xs text-ink-3">
                    Available variables: {"{{quote_number}}"} and {"{{company_name}}"}.
                  </p>
                </div>

                <div className="md:col-span-2">
                  <TextArea
                    label="Quotation Email Body"
                    value={
                      quotationTemplate.email_body_template
                    }
                    onChange={(value) =>
                      setQuotationTemplate((current) => ({
                        ...current,
                        email_body_template: value,
                      }))
                    }
                  />
                </div>

                <div className="grid gap-3 md:col-span-2 sm:grid-cols-2">
                  <CheckField
                    label="Show route details"
                    checked={
                      quotationTemplate.show_route_details
                    }
                    onChange={(checked) =>
                      setQuotationTemplate((current) => ({
                        ...current,
                        show_route_details: checked,
                      }))
                    }
                  />

                  <CheckField
                    label="Show line VAT"
                    checked={
                      quotationTemplate.show_line_vat
                    }
                    onChange={(checked) =>
                      setQuotationTemplate((current) => ({
                        ...current,
                        show_line_vat: checked,
                      }))
                    }
                  />

                  <CheckField
                    label="Show registration number"
                    checked={
                      quotationTemplate.show_company_registration
                    }
                    onChange={(checked) =>
                      setQuotationTemplate((current) => ({
                        ...current,
                        show_company_registration: checked,
                      }))
                    }
                  />

                  <CheckField
                    label="Show VAT number"
                    checked={
                      quotationTemplate.show_vat_number
                    }
                    onChange={(checked) =>
                      setQuotationTemplate((current) => ({
                        ...current,
                        show_vat_number: checked,
                      }))
                    }
                  />
                </div>
              </div>
            </section>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-ink-3">
                {autoSaveStatus === "dirty"
                  ? "Unsaved changes"
                  : autoSaveStatus === "saving"
                    ? "Saving..."
                    : autoSaveStatus === "saved"
                      ? "Saved"
                      : autoSaveStatus === "error"
                        ? "Autosave failed"
                        : ""}
              </div>

              <Button
                type="button"
                disabled={saving || uploading}
                onClick={() =>
                  void save()
                }
              >
                {saving
                  ? "Saving..."
                  : "Save Document Settings"}
              </Button>
            </div>
          </div>

          <aside className="grid content-start gap-4">
            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="mb-1 mt-0 text-md font-semibold text-ink">
                Company Details
              </h2>

              <p className="mb-4 mt-0 text-sm text-ink-3">
                These details come from Company Profile and are reused across documents.
              </p>

              <Info
                label="Company"
                value={
                  company?.company_name ||
                  "Not configured"
                }
              />

              {company?.trading_name ? (
                <Info
                  label="Trading Name"
                  value={company.trading_name}
                />
              ) : null}

              <Info
                label="Base Address"
                value={
                  companyAddress ||
                  "Not configured"
                }
              />

              <Info
                label="Business Email"
                value={
                  company?.business_email ||
                  "Not configured"
                }
              />

              <Info
                label="Telephone"
                value={
                  company?.business_phone ||
                  "Not configured"
                }
              />

              <Info
                label="Website"
                value={
                  company?.website ||
                  "Not configured"
                }
              />

              <Info
                label="Registration"
                value={
                  company?.registration_number ||
                  "Not configured"
                }
              />

              <Info
                label="VAT"
                value={
                  company?.vat_number ||
                  "Not configured"
                }
              />

              <a
                href="/settings/company"
                className="mt-3 inline-flex text-sm font-medium text-primary hover:underline"
              >
                Edit Company Profile
              </a>
            </section>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="mb-2 mt-0 text-md font-semibold text-ink">
                Document Preview
              </h2>

              <div className="rounded-lg bg-white p-5 text-slate-900 shadow-sm">
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
                  <div>
                    {documentSettings.show_logo &&
                    logoUrl ? (
                      <img
                        src={logoUrl}
                        alt=""
                        className="mb-3 max-h-16 max-w-40 object-contain"
                      />
                    ) : null}

                    <strong className="block text-lg">
                      {company?.company_name ||
                        "Company Name"}
                    </strong>

                    <div className="mt-1 text-xs text-slate-600">
                      {companyAddress ||
                        "Company base address"}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs font-semibold uppercase text-slate-500">
                      {quotationTemplate.heading ||
                        "Quotation"}
                    </div>

                    <div className="mt-1 font-mono text-sm font-bold">
                      QT-2026-00001
                    </div>
                  </div>
                </div>

                <div className="mt-4 text-xs text-slate-700">
                  Customer, route, line items, prices and other transaction-specific details are supplied by the individual quotation.
                </div>

                {documentSettings.footer_text ? (
                  <div className="mt-5 border-t border-slate-200 pt-3 text-xs text-slate-500">
                    {documentSettings.footer_text}
                  </div>
                ) : null}
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange:
    (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink-2">
        {label}
      </span>

      <input
        className="h-10 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value
          )
        }
      />
    </label>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange:
    (value: number) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink-2">
        {label}
      </span>

      <input
        type="number"
        min={min}
        max={max}
        className="h-10 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
        value={value}
        onChange={(event) =>
          onChange(
            Number(
              event.target.value ||
                min
            )
          )
        }
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange:
    (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink-2">
        {label}
      </span>

      <textarea
        className="min-h-28 rounded-md border border-ink-3 bg-surface px-3 py-2 text-base text-ink"
        value={value}
        placeholder={placeholder}
        onChange={(event) =>
          onChange(
            event.target.value
          )
        }
      />
    </label>
  );
}

function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange:
    (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-3 py-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) =>
          onChange(
            event.target.checked
          )
        }
      />

      <span className="text-sm text-ink">
        {label}
      </span>
    </label>
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
    <div className="border-b border-line py-2 last:border-b-0">
      <div className="text-xs font-semibold uppercase text-ink-3">
        {label}
      </div>

      <div className="mt-1 break-words text-sm text-ink">
        {value}
      </div>
    </div>
  );
}