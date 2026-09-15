import {
  createAdminClient,
} from "../accounts/server";

import {
  operatorToday,
} from "../invoices/dates";

import {
  buildAcceptanceSnapshot,
  hashAcceptanceSnapshot,
} from "./acceptanceSnapshot";

import {
  QuotationShareError,
  quotationShareState,
} from "./shareStatus";

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

/*
  Loads a shared quotation for the public page and the accept/decline route.

  Errors (INV-18): a QuotationShareError carries a message the anonymous
  visitor may see (invalid, revoked or expired link). Anything else is an
  internal failure and is thrown as a plain Error, which callers turn into a
  generic message through publicShareError, logging the detail server side.

  No side effects: loading no longer records a view. A link scanner that
  pre-fetches the email (Safe Links, Mimecast) would otherwise set
  first_viewed_at, and a failing view RPC made the whole quotation
  unavailable. The page's client records the view after hydration through
  markQuotationShareViewed.

  decision (INV-6) says whether the quotation can still be accepted, from the
  quotation's own status and valid_until, not only the link row.
*/
export async function loadQuotationShare(
  rawToken: string
) {
  let payload: ReturnType<typeof verifyQuotationShareToken>;

  try {
    payload =
      verifyQuotationShareToken(rawToken);
  }
  catch (error) {
    throw new Error(
      `Quotation share token verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!payload) {
    throw new QuotationShareError(
      "invalid",
      404
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
    throw new QuotationShareError(
      "invalid",
      404
    );
  }

  if (share.revoked_at) {
    throw new QuotationShareError(
      "revoked",
      410
    );
  }

  const expiresAt =
    new Date(share.expires_at).getTime();

  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new QuotationShareError(
      "linkExpired",
      410
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
    throw new QuotationShareError(
      "invalid",
      404
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

  const decision =
    quotationShareState({
      quotationStatus:
        quotation.status,
      validUntil:
        quotation.valid_until,
      convertedJobId:
        quotation.converted_job_id,
      shareAcceptedAt:
        share.accepted_at,
      shareDeclinedAt:
        share.declined_at,
      today:
        operatorToday(),
    });

  const snapshot =
    buildAcceptanceSnapshot(quotation);

  return {
    payload,
    share,
    quotation,
    template,
    termsVersion,
    tokenHash,
    decision,
    snapshot,
    snapshotHash:
      hashAcceptanceSnapshot(snapshot),
  };
}

/**
  Records that the customer opened the quotation. Best effort: a failure is
  logged and never blocks the page or a decision.
*/
export async function markQuotationShareViewed(
  shareLinkId: string
): Promise<void> {
  try {
    const {
      error,
    } = await createAdminClient().rpc(
      "mark_quotation_share_viewed",
      {
        p_share_link_id:
          shareLinkId,
      }
    );

    if (error) {
      console.error(
        "[quotation-share] could not record view",
        error.code,
        error.message
      );
    }
  }
  catch (error) {
    console.error(
      "[quotation-share] could not record view",
      error
    );
  }
}
