import { NextResponse } from "next/server";
import { Resend } from "resend";
import { RequestAccessValidation } from "../../../lib/validation/requestAccess";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const parsed = RequestAccessValidation.safeParse(body);
  if (!parsed.success) {
    // Field-keyed so the client can render each message under its own input.
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ ok: false, fieldErrors }, { status: 400 });
  }

  const { companyName, contactName, email, phone, vehicles, notes } = parsed.data;

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  const to = process.env.LEAD_INBOX;
  if (!apiKey || !from || !to) {
    // Deliberately vague to the client, specific in the log: the response is
    // public and must not disclose which piece of config is missing.
    console.error("request-access: missing RESEND_API_KEY / MAIL_FROM / LEAD_INBOX");
    return NextResponse.json(
      { ok: false, error: "Server is not configured to receive requests." },
      { status: 500 },
    );
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    replyTo: email,
    subject: `New access request: ${companyName}`,
    text: [
      `Company: ${companyName}`,
      `Contact: ${contactName}`,
      `Email: ${email}`,
      `Phone: ${phone ?? "-"}`,
      `Vehicles: ${vehicles}`,
      `Notes: ${notes ?? "-"}`,
    ].join("\n"),
  });

  if (error) {
    console.error("request-access: Resend send failed", error);
    return NextResponse.json(
      { ok: false, error: "Could not send your request. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
