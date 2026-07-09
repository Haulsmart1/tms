"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { createClient } from "../lib/supabase/browser";

export default function HomePage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);

    const params = new URLSearchParams(window.location.search);
    if (params.get("submitted") === "1") {
      setRegistrationSuccess(true);
    }

    if (params.get("error")) {
      setMessage(
        "That sign-in link didn't work or has expired. Enter your email below and we'll send you a fresh one."
      );
    }
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setMessage("Please enter your email address.");
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();

      const redirectTo = `${window.location.origin}/api/auth/callback?next=/dashboard`;

      const { error } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: {
          emailRedirectTo: redirectTo,
        },
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      setMessage("Login link sent. Check your email.");
      setEmail("");
    } catch (error: unknown) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to start login. Check Supabase environment variables."
      );
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: CSSProperties = {
    padding: "14px 16px",
    borderRadius: 12,
    border: "1px solid #d1d5db",
    fontSize: 16,
    width: "100%",
    boxSizing: "border-box",
  };

  const cardStyle: CSSProperties = {
    background: "white",
    borderRadius: 20,
    padding: 32,
    border: "1px solid #e5e7eb",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.12)",
  };

  const glassCardStyle: CSSProperties = {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 20,
    padding: 32,
    color: "white",
  };

  const sectionTitleStyle: CSSProperties = {
    fontSize: 30,
    margin: "0 0 16px 0",
    lineHeight: 1.2,
  };

  const seoParagraphStyle: CSSProperties = {
    fontSize: 17,
    lineHeight: 1.7,
    color: "rgba(255,255,255,0.88)",
    margin: 0,
  };

  return (
    <>
      <Script
        id="tmswizzard-ld-json"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "TMS Wizzard",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            description:
              "Cloud transport management software for jobs, proof of delivery, invoicing, vehicles, drivers, subcontractors, dispatch, and fleet management.",
            offers: {
              "@type": "Offer",
              price: "0",
              priceCurrency: "GBP",
            },
          }),
        }}
      />

      <main
        style={{
          minHeight: "100vh",
          background:
            "linear-gradient(135deg, #0f172a 0%, #111827 45%, #1f2937 100%)",
          padding: 24,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 1180,
            display: "grid",
            gap: 24,
            alignContent: "start",
          }}
        >
          <div
            style={{
              width: "100%",
              display: "grid",
              gridTemplateColumns: "1.2fr 0.8fr",
              gap: 24,
              alignItems: "start",
            }}
          >
            <section style={glassCardStyle}>
              <div
                style={{
                  display: "inline-flex",
                  padding: "8px 14px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.10)",
                  marginBottom: 20,
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                All-in-One Cloud Transport Management Software
              </div>

              <h1
                style={{
                  fontSize: "clamp(36px, 6vw, 64px)",
                  lineHeight: 1,
                  margin: "0 0 16px 0",
                }}
              >
                TMS Wizzard
              </h1>

              <p
                style={{
                  fontSize: 20,
                  lineHeight: 1.6,
                  color: "rgba(255,255,255,0.90)",
                  margin: "0 0 16px 0",
                  maxWidth: 760,
                  fontWeight: 600,
                }}
              >
                Cloud-based transport management software for haulage companies,
                logistics operators, dispatch teams, fleet operators, and
                delivery businesses.
              </p>

              <p style={seoParagraphStyle}>
                Manage transport jobs, proof of delivery, invoicing, vehicles,
                drivers, subcontractors, tracking, customer records, and
                operational workflows in one cloud platform.
              </p>

              <div
                style={{
                  marginTop: 18,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  fontSize: 15,
                  color: "rgba(255,255,255,0.86)",
                }}
              >
                <span>Jobs Management</span>
                <span>•</span>
                <span>POD Capture</span>
                <span>•</span>
                <span>Fleet Management</span>
                <span>•</span>
                <span>Driver Management</span>
                <span>•</span>
                <span>Transport Invoicing</span>
                <span>•</span>
                <span>Subcontractor Control</span>
              </div>

              <div
                style={{
                  marginTop: 24,
                  height: 260,
                  borderRadius: 16,
                  backgroundImage: "url('/Truck.jpg')",
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              />
            </section>

            <div style={{ display: "grid", gap: 20 }}>
              <section style={cardStyle}>
                <h2 style={{ marginTop: 0 }}>Sign in</h2>

                <form onSubmit={handleLogin} style={{ display: "grid", gap: 14 }}>
                  <input
                    type="email"
                    placeholder="your email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    style={inputStyle}
                    required
                  />

                  <button
                    type="submit"
                    disabled={loading}
                    style={{
                      padding: "14px 16px",
                      borderRadius: 12,
                      border: "none",
                      background: "#111827",
                      color: "white",
                      fontSize: 16,
                      fontWeight: 700,
                      cursor: loading ? "not-allowed" : "pointer",
                    }}
                  >
                    {loading ? "Sending..." : "Send Login Link"}
                  </button>
                </form>

                {message ? (
                  <p style={{ marginTop: 14, marginBottom: 0 }}>{message}</p>
                ) : null}
              </section>

              <section style={cardStyle}>
                <h2 style={{ marginTop: 0 }}>Register your interest</h2>

                <form
                  action="https://formsubmit.co/stuart@adrcarriers.net"
                  method="POST"
                  style={{ display: "grid", gap: 14 }}
                >
                  <input
                    type="hidden"
                    name="_subject"
                    value="New registration request - TMS Wizzard"
                  />
                  <input type="hidden" name="_captcha" value="false" />
                  <input
                    type="hidden"
                    name="_next"
                    value={origin ? `${origin}/?submitted=1` : ""}
                  />

                  <input
                    type="text"
                    name="companyName"
                    placeholder="Company name"
                    required
                    style={inputStyle}
                  />

                  <input
                    type="text"
                    name="contactName"
                    placeholder="Contact name"
                    required
                    style={inputStyle}
                  />

                  <input
                    type="email"
                    name="email"
                    placeholder="Email address"
                    required
                    style={inputStyle}
                  />

                  <input
                    type="text"
                    name="phone"
                    placeholder="Phone number"
                    style={inputStyle}
                  />

                  <input
                    type="number"
                    name="vehicleCount"
                    min="0"
                    step="1"
                    placeholder="How many vehicles?"
                    required
                    style={inputStyle}
                  />

                  <textarea
                    name="notes"
                    placeholder="Tell us about your haulage, transport, delivery, or fleet operation"
                    rows={4}
                    style={{ ...inputStyle, resize: "vertical" }}
                  />

                  <button
                    type="submit"
                    style={{
                      padding: "14px 16px",
                      borderRadius: 12,
                      border: "none",
                      background: "#2563eb",
                      color: "white",
                      fontSize: 16,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Request Registration
                  </button>
                </form>

                {registrationSuccess ? (
                  <p style={{ marginTop: 14, marginBottom: 0, color: "#166534" }}>
                    Registration request sent successfully. We will contact you shortly.
                  </p>
                ) : null}
              </section>
            </div>
          </div>

          <section style={glassCardStyle}>
            <h2 style={sectionTitleStyle}>
              All-in-One Cloud Transport Management System
            </h2>

            <p style={seoParagraphStyle}>
              TMS Wizzard is built as an all-in-one cloud transport management
              system for modern road transport and logistics businesses.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}