"use client";

import {
  useMemo,
  useState,
} from "react";

type Clause = {
  key: string;
  title: string;
  text: string;
  required: boolean;
};

type Props = {
  token: string;
  clauses: Clause[];
  adrRequired: boolean;
  adrText: string | null;
  initialEmail: string;
  alreadyAccepted: boolean;
  alreadyDeclined: boolean;
};

export default function AcceptanceClient({
  token,
  clauses,
  adrRequired,
  adrText,
  initialEmail,
  alreadyAccepted,
  alreadyDeclined,
}: Props) {
  const [name, setName] =
    useState("");

  const [email, setEmail] =
    useState(initialEmail);

  const [companyName, setCompanyName] =
    useState("");

  const [position, setPosition] =
    useState("");

  const [
    acceptedKeys,
    setAcceptedKeys,
  ] =
    useState<Set<string>>(
      new Set()
    );

  const [
    adrAccepted,
    setAdrAccepted,
  ] =
    useState(false);

  const [
    busy,
    setBusy,
  ] =
    useState(false);

  const [
    message,
    setMessage,
  ] =
    useState("");

  const requiredClauses =
    useMemo(
      () =>
        clauses.filter(
          (clause) =>
            clause.required !== false
        ),
      [clauses]
    );

  const allClausesAccepted =
    requiredClauses.every(
      (clause) =>
        acceptedKeys.has(
          clause.key
        )
    );

  const canAccept =
    Boolean(name.trim()) &&
    Boolean(email.trim()) &&
    Boolean(companyName.trim()) &&
    Boolean(position.trim()) &&
    allClausesAccepted &&
    (!adrRequired ||
      adrAccepted) &&
    !busy &&
    !alreadyAccepted &&
    !alreadyDeclined;

  function toggleClause(
    key: string
  ) {
    setAcceptedKeys(
      (current) => {
        const next =
          new Set(current);

        if (next.has(key)) {
          next.delete(key);
        }
        else {
          next.add(key);
        }

        return next;
      }
    );
  }

  async function submit(
    action: "accept" | "decline"
  ) {
    if (!name.trim()) {
      setMessage(
        "Please enter your name."
      );
      return;
    }

    if (!email.trim()) {
      setMessage(
        "Please enter your email address."
      );
      return;
    }

    if (
      action === "accept" &&
      !companyName.trim()
    ) {
      setMessage(
        "Please enter your company name."
      );
      return;
    }

    if (
      action === "accept" &&
      !position.trim()
    ) {
      setMessage(
        "Please enter your position."
      );
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const response =
        await fetch(
          `/api/public/quotation-share/${encodeURIComponent(
            token
          )}`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                action,
                name:
                  name.trim(),
                email:
                  email.trim(),
                companyName:
                  companyName.trim(),
                position:
                  position.trim(),
                clauseKeys:
                  Array.from(
                    acceptedKeys
                  ),
                adrAccepted,
              }),
          }
        );

      const payload =
        await response.json();

      if (!response.ok) {
        throw new Error(
          payload.error ||
            "Unable to update quotation."
        );
      }

      if (action === "accept") {
        setMessage(
          "Quotation accepted successfully. Thank you."
        );
      }
      else {
        setMessage(
          "Quotation declined."
        );
      }

      window.setTimeout(
        () => {
          window.location.reload();
        },
        800
      );
    }
    catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update quotation."
      );
    }
    finally {
      setBusy(false);
    }
  }

  if (alreadyAccepted) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5 text-sm">
        This quotation has already been accepted.
      </div>
    );
  }

  if (alreadyDeclined) {
    return (
      <div className="rounded-xl border border-slate-300 bg-slate-50 p-5 text-sm">
        This quotation has already been declined.
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          Terms &amp; Conditions
        </h2>

        <p className="mt-2 text-sm text-slate-600">
          Please read and acknowledge every required section before accepting this quotation.
        </p>
      </div>

      <div className="space-y-4">
        {clauses.map(
          (clause) => (
            <label
              key={clause.key}
              className="block rounded-xl border border-slate-200 p-4"
            >
              <div className="flex gap-3">
                <input
                  type="checkbox"
                  checked={
                    acceptedKeys.has(
                      clause.key
                    )
                  }
                  onChange={() =>
                    toggleClause(
                      clause.key
                    )
                  }
                  className="mt-1 h-5 w-5"
                />

                <div>
                  <div className="font-semibold">
                    {clause.key}.{" "}
                    {clause.title}
                  </div>

                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {clause.text}
                  </p>
                </div>
              </div>
            </label>
          )
        )}
      </div>

      {adrRequired && (
        <label className="block rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <div className="flex gap-3">
            <input
              type="checkbox"
              checked={
                adrAccepted
              }
              onChange={(event) =>
                setAdrAccepted(
                  event.target.checked
                )
              }
              className="mt-1 h-5 w-5"
            />

            <div>
              <div className="font-semibold">
                ADR Dangerous Goods Acceptance
              </div>

              <p className="mt-2 text-sm">
                {adrText ||
                  "I confirm acceptance of all ADR Dangerous Goods transport conditions."}
              </p>
            </div>
          </div>
        </label>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="min-w-0">
          <span className="mb-1 block text-sm font-medium">
            Your name
          </span>

          <input
            value={name}
            onChange={(event) =>
              setName(
                event.target.value
              )
            }
            autoComplete="name"
            className="block w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2"
            maxLength={150}
          />
        </label>

        <label className="min-w-0">
          <span className="mb-1 block text-sm font-medium">
            Position
          </span>

          <input
            value={position}
            onChange={(event) =>
              setPosition(
                event.target.value
              )
            }
            autoComplete="organization-title"
            className="block w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2"
            maxLength={150}
          />
        </label>

        <label className="min-w-0">
          <span className="mb-1 block text-sm font-medium">
            Company name
          </span>

          <input
            value={companyName}
            onChange={(event) =>
              setCompanyName(
                event.target.value
              )
            }
            autoComplete="organization"
            className="block w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2"
            maxLength={200}
          />
        </label>

        <label className="min-w-0">
          <span className="mb-1 block text-sm font-medium">
            Email address
          </span>

          <input
            type="email"
            value={email}
            onChange={(event) =>
              setEmail(
                event.target.value
              )
            }
            autoComplete="email"
            className="block w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2"
            maxLength={254}
          />
        </label>
      </div>

      {message && (
        <div className="rounded-lg bg-slate-100 p-3 text-sm">
          {message}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={
            !canAccept
          }
          onClick={() =>
            submit("accept")
          }
          className="rounded-lg bg-slate-900 px-5 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy
            ? "Please wait..."
            : "Accept Quotation"}
        </button>

        <button
          type="button"
          disabled={
            busy ||
            !name.trim()
          }
          onClick={() =>
            submit("decline")
          }
          className="rounded-lg border border-slate-300 px-5 py-3 font-medium disabled:opacity-40"
        >
          Decline Quotation
        </button>
      </div>
    </section>
  );
}