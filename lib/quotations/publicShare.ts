import {
  createAdminClient,
} from "../accounts/server";

import {
  hashQuotationShareToken,
  verifyQuotationShareToken,
} from "./shareToken";

export type QuotationTermsClause = {
  key: string;
  title: string;
  text: string;
  required: boolean;
};

export async function loadQuotationShare(
  rawToken: string,
  markViewed = false
) {
  const payload =
    verifyQuotationShareToken(rawToken);

  if (!payload) {
    throw new Error(
      "This quotation link is invalid or has expired."
    );
  }

  const admin =
    createAdminClient();

  const tokenHash =
    hashQuotationShareToken(rawToken);

  const {
    data: share,
    error: shareError,
  } = await admin
    .from("quotation_share_links")
    .select(`
      id,
      tenant_id,
      quotation_id,
      token_hash,
      sent_to_email,
      sent_at,
      expires_at,
      first_viewed_at,
      last_viewed_at,
      accepted_at,
      accepted_by_name,
      accepted_by_email,
      declined_at,
      declined_by_name,
      declined_by_email,
      revoked_at,
      created_at,
      terms_version_id,
      terms_snapshot,
      terms_hash,
      adr_required
    `)
    .eq("id", payload.shareLinkId)
    .eq("tenant_id", payload.tenantId)
    .eq("quotation_id", payload.quotationId)
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (shareError) {
    throw new Error(shareError.message);
  }

  if (!share) {
    throw new Error(
      "This quotation link is invalid."
    );
  }

  if (share.revoked_at) {
    throw new Error(
      "This quotation link has been revoked."
    );
  }

  if (
    new Date(share.expires_at).getTime() <=
    Date.now()
  ) {
    throw new Error(
      "This quotation link has expired."
    );
  }

  const {
    data: quotation,
    error: quotationError,
  } = await admin
    .from("quotations")
    .select(`
      id,
      tenant_id,
      customer_id,
      quote_number,
      status,
      quote_date,
      valid_until,
      proposed_service_date,
      customer_reference,
      po_reference,
      currency_code,
      subtotal,
      vat_total,
      total,
      notes,
      terms,
      requires_adr_acceptance,
      converted_job_id,
      converted_at,
      sent_at,
      first_viewed_at,
      accepted_at,
      accepted_by_name,
      accepted_by_email,
      declined_at,
      declined_by_name,
      declined_by_email,
      customers (
        id,
        name
      ),
      quotation_lines (
        id,
        line_number,
        description,
        quantity,
        unit_price,
        vat_rate,
        line_subtotal,
        line_vat,
        line_total
      ),
      quotation_stops (
        id,
        stop_order,
        type,
        address_line,
        city,
        postcode,
        recipient_name,
        contact_phone,
        notes
      )
    `)
    .eq("id", payload.quotationId)
    .eq("tenant_id", payload.tenantId)
    .maybeSingle();

  if (quotationError) {
    throw new Error(
      quotationError.message
    );
  }

  if (!quotation) {
    throw new Error(
      "Quotation not found."
    );
  }

  const {
    data: template,
    error: templateError,
  } = await admin
    .from("quotation_template_settings")
    .select(`
      heading,
      intro_text,
      default_notes,
      default_terms,
      footer_text,
      default_valid_days,
      email_subject_template,
      email_body_template,
      auto_create_job_on_accept,
      show_company_registration,
      show_vat_number,
      show_route_details,
      show_line_vat
    `)
    .eq("tenant_id", payload.tenantId)
    .maybeSingle();

  if (templateError) {
    throw new Error(
      templateError.message
    );
  }

  let termsVersion: {
    id: string;
    version_number: number;
    title: string;
    clauses: QuotationTermsClause[];
    adr_acceptance_text: string | null;
    content_hash: string;
  } | null = null;

  if (share.terms_version_id) {
    const {
      data,
      error,
    } = await admin
      .from("quotation_terms_versions")
      .select(`
        id,
        version_number,
        title,
        clauses,
        adr_acceptance_text,
        content_hash
      `)
      .eq("id", share.terms_version_id)
      .eq("tenant_id", payload.tenantId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (data) {
      termsVersion = {
        id: data.id,
        version_number:
          Number(data.version_number),
        title: data.title,
        clauses: Array.isArray(data.clauses)
          ? (data.clauses as QuotationTermsClause[])
          : [],
        adr_acceptance_text:
          data.adr_acceptance_text,
        content_hash:
          data.content_hash,
      };
    }
  }

  if (markViewed) {
    const {
      error: viewedError,
    } = await admin.rpc(
      "mark_quotation_share_viewed",
      {
        p_share_link_id:
          share.id,
      }
    );

    if (viewedError) {
      throw new Error(
        viewedError.message
      );
    }
  }

  return {
    payload,
    share,
    quotation,
    template,
    termsVersion,
  };
}