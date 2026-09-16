import { describe, expect, it } from "vitest";
import {
  SIGNUP_SENT_MESSAGE,
  runSignup,
  signupFailedResponse,
  signupSentResponse,
  type SignupDeps,
  type SignupResponse,
} from "./signup";

type Call = { name: string; args: unknown[] };

type FakeOptions = {
  ipAllowed?: boolean;
  emailAllowed?: boolean;
  existingId?: string | null;
  confirmed?: boolean;
  createdId?: string;
  createUserError?: Error;
  racedId?: string | null;
  companyOutcome?: string;
  companyError?: Error;
  deleteError?: Error;
  inviteError?: Error;
  magicLinkError?: Error;
  lookupError?: Error;
};

function fakeDeps(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const logs: { level: string; message: string; meta?: unknown }[] = [];
  let lookups = 0;
  const record = (name: string, ...args: unknown[]) => calls.push({ name, args });

  const deps: SignupDeps = {
    checkIpLimit: async (key) => {
      record("checkIpLimit", key);
      return options.ipAllowed ?? true;
    },
    checkEmailLimit: async (email) => {
      record("checkEmailLimit", email);
      return options.emailAllowed ?? true;
    },
    findUserIdByEmail: async (email) => {
      record("findUserIdByEmail", email);
      if (options.lookupError) throw options.lookupError;
      lookups += 1;
      if (lookups > 1 && options.racedId !== undefined) return options.racedId;
      return options.existingId ?? null;
    },
    getUserConfirmed: async (id) => {
      record("getUserConfirmed", id);
      return options.confirmed ?? true;
    },
    createUser: async (email) => {
      record("createUser", email);
      if (options.createUserError) throw options.createUserError;
      return options.createdId ?? "new-user-id";
    },
    deleteUser: async (id) => {
      record("deleteUser", id);
      if (options.deleteError) throw options.deleteError;
    },
    createCompany: async (args) => {
      record("createCompany", args);
      if (options.companyError) throw options.companyError;
      return options.companyOutcome ?? "created";
    },
    sendInvite: async (email) => {
      record("sendInvite", email);
      if (options.inviteError) throw options.inviteError;
    },
    sendMagicLink: async (email) => {
      record("sendMagicLink", email);
      if (options.magicLinkError) throw options.magicLinkError;
    },
    log: {
      warn: (message, meta) => logs.push({ level: "warn", message, meta }),
      error: (message, meta) => logs.push({ level: "error", message, meta }),
    },
  };

  return { deps, calls, logs, names: () => calls.map((c) => c.name) };
}

const validBody = {
  companyName: "Northgate Haulage Ltd",
  contactName: "Sam Founder",
  email: "Sam@Northgate.example",
};

const request = (body: unknown = validBody, ipKey = "203.0.113.9") => ({ body, ipKey });

function serialize(response: SignupResponse): string {
  return `${response.status}\n${JSON.stringify(response.body)}`;
}

describe("runSignup: byte-identical responses", () => {
  it("answers the same status and body for a new address, an existing confirmed one, an existing unconfirmed one, a honeypot hit, and both rate limits", async () => {
    const fresh = await runSignup(fakeDeps().deps, request());
    const existing = await runSignup(fakeDeps({ existingId: "u-1" }).deps, request());
    const unconfirmed = await runSignup(fakeDeps({ existingId: "u-2", confirmed: false }).deps, request());
    const honeypot = await runSignup(fakeDeps().deps, request({ ...validBody, companyWebsite: "http://bot" }));
    const ipLimited = await runSignup(fakeDeps({ ipAllowed: false }).deps, request());
    const emailLimited = await runSignup(fakeDeps({ emailAllowed: false }).deps, request());
    const inviteFailed = await runSignup(fakeDeps({ inviteError: new Error("smtp") }).deps, request());
    const magicLinkFailed = await runSignup(
      fakeDeps({ existingId: "u-1", magicLinkError: new Error("smtp") }).deps,
      request(),
    );

    const expected = serialize(signupSentResponse());
    for (const response of [fresh, existing, unconfirmed, honeypot, ipLimited, emailLimited, inviteFailed, magicLinkFailed]) {
      expect(serialize(response)).toBe(expected);
    }
    expect(fresh.body).toEqual({ ok: true, message: SIGNUP_SENT_MESSAGE });
  });
});

describe("runSignup: order and branching", () => {
  it("checks the honeypot first, then the IP limit, and never validates or looks anything up when either trips", async () => {
    const hp = fakeDeps();
    await runSignup(hp.deps, request({ ...validBody, companyWebsite: "x" }));
    expect(hp.names()).toEqual([]);

    const ip = fakeDeps({ ipAllowed: false });
    await runSignup(ip.deps, request({ garbage: true }));
    expect(ip.names()).toEqual(["checkIpLimit"]);
    expect(ip.calls[0].args).toEqual(["203.0.113.9"]);
  });

  it("checks the per-IP limit before the per-email limit, and the email limit before the lookup", async () => {
    const f = fakeDeps({ emailAllowed: false });
    await runSignup(f.deps, request());
    expect(f.names()).toEqual(["checkIpLimit", "checkEmailLimit"]);
    expect(f.calls[1].args).toEqual(["sam@northgate.example"]);
  });

  it("rejects invalid input with field errors after the IP check and before any lookup", async () => {
    const f = fakeDeps();
    const response = await runSignup(f.deps, request({ ...validBody, email: "nope" }));
    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(Object.keys(response.body.fieldErrors as object)).toEqual(["email"]);
    expect(f.names()).toEqual(["checkIpLimit"]);
  });

  it("rejects an unknown key", async () => {
    const f = fakeDeps();
    const response = await runSignup(f.deps, request({ ...validBody, role: "admin" }));
    expect(response.status).toBe(400);
    expect(f.names()).toEqual(["checkIpLimit"]);
  });

  it("existing confirmed address: sends a magic link and never creates a user or a company", async () => {
    const f = fakeDeps({ existingId: "u-1", confirmed: true });
    await runSignup(f.deps, request());
    expect(f.names()).toEqual([
      "checkIpLimit",
      "checkEmailLimit",
      "findUserIdByEmail",
      "getUserConfirmed",
      "sendMagicLink",
    ]);
    expect(f.calls.at(-1)?.args).toEqual(["sam@northgate.example"]);
  });

  it("existing unconfirmed address: re-sends the invite and never creates a user or a company", async () => {
    const f = fakeDeps({ existingId: "u-2", confirmed: false });
    await runSignup(f.deps, request());
    expect(f.names()).toEqual([
      "checkIpLimit",
      "checkEmailLimit",
      "findUserIdByEmail",
      "getUserConfirmed",
      "sendInvite",
    ]);
  });

  it("new address: creates the user, then the company, then sends the invite, in that order", async () => {
    const f = fakeDeps({ createdId: "u-new" });
    await runSignup(f.deps, request());
    expect(f.names()).toEqual([
      "checkIpLimit",
      "checkEmailLimit",
      "findUserIdByEmail",
      "createUser",
      "createCompany",
      "sendInvite",
    ]);
    const company = f.calls.find((c) => c.name === "createCompany");
    expect(company?.args[0]).toEqual({
      userId: "u-new",
      email: "sam@northgate.example",
      companyName: "Northgate Haulage Ltd",
      contactName: "Sam Founder",
    });
  });

  it("treats already_member from the RPC as success", async () => {
    const f = fakeDeps({ companyOutcome: "already_member" });
    const response = await runSignup(f.deps, request());
    expect(serialize(response)).toBe(serialize(signupSentResponse()));
    expect(f.names()).toContain("sendInvite");
    expect(f.names()).not.toContain("deleteUser");
  });

  it("never passes tenant, company or role to createUser or sendInvite", async () => {
    const f = fakeDeps();
    await runSignup(f.deps, request({ ...validBody }));
    for (const call of f.calls.filter((c) => c.name === "createUser" || c.name === "sendInvite")) {
      expect(call.args).toEqual(["sam@northgate.example"]);
      const text = JSON.stringify(call.args);
      for (const forbidden of ["tenant", "company", "role", "data"]) {
        expect(text).not.toContain(forbidden);
      }
    }
  });
});

describe("runSignup: failures and compensation", () => {
  it("RPC failure deletes the auth user this request created and answers the failure response", async () => {
    const f = fakeDeps({ createdId: "u-new", companyError: new Error("role_missing") });
    const response = await runSignup(f.deps, request());
    expect(serialize(response)).toBe(serialize(signupFailedResponse()));
    expect(f.names()).toEqual([
      "checkIpLimit",
      "checkEmailLimit",
      "findUserIdByEmail",
      "createUser",
      "createCompany",
      "deleteUser",
    ]);
    expect(f.calls.at(-1)?.args).toEqual(["u-new"]);
    expect(f.names()).not.toContain("sendInvite");
  });

  it("an unexpected RPC outcome is treated as a failure, with compensation", async () => {
    const f = fakeDeps({ createdId: "u-new", companyOutcome: "other_company" });
    const response = await runSignup(f.deps, request());
    expect(response.status).toBe(500);
    expect(f.names()).toContain("deleteUser");
    expect(f.names()).not.toContain("sendInvite");
  });

  it("a failed compensating delete is logged and the response is still the same failure response", async () => {
    const f = fakeDeps({ createdId: "u-new", companyError: new Error("boom"), deleteError: new Error("gone") });
    const response = await runSignup(f.deps, request());
    expect(serialize(response)).toBe(serialize(signupFailedResponse()));
    expect(f.logs.some((l) => l.level === "error" && l.message.includes("cleanup"))).toBe(true);
    expect((f.logs.find((l) => l.message.includes("cleanup"))?.meta as { userId: string }).userId).toBe("u-new");
  });

  it("a lookup failure answers the failure response before any side effect", async () => {
    const f = fakeDeps({ lookupError: new Error("PGRST202") });
    const response = await runSignup(f.deps, request());
    expect(serialize(response)).toBe(serialize(signupFailedResponse()));
    expect(f.names()).toEqual(["checkIpLimit", "checkEmailLimit", "findUserIdByEmail"]);
  });

  it("a lost createUser race falls through to the existing-address branch", async () => {
    const f = fakeDeps({ createUserError: new Error("email_exists"), racedId: "u-winner", confirmed: false });
    const response = await runSignup(f.deps, request());
    expect(serialize(response)).toBe(serialize(signupSentResponse()));
    expect(f.names()).toEqual([
      "checkIpLimit",
      "checkEmailLimit",
      "findUserIdByEmail",
      "createUser",
      "findUserIdByEmail",
      "getUserConfirmed",
      "sendInvite",
    ]);
    expect(f.names()).not.toContain("createCompany");
  });

  it("a createUser failure with no winner answers the failure response", async () => {
    const f = fakeDeps({ createUserError: new Error("down"), racedId: null });
    const response = await runSignup(f.deps, request());
    expect(serialize(response)).toBe(serialize(signupFailedResponse()));
    expect(f.names()).not.toContain("createCompany");
  });

  it("an invite send failure after provisioning is logged, not surfaced, and nothing is deleted", async () => {
    const f = fakeDeps({ inviteError: new Error("smtp") });
    const response = await runSignup(f.deps, request());
    expect(serialize(response)).toBe(serialize(signupSentResponse()));
    expect(f.names()).not.toContain("deleteUser");
    expect(f.logs.some((l) => l.message.includes("invite email not sent"))).toBe(true);
  });

  it("logs never include the address", async () => {
    const f = fakeDeps({ createdId: "u-new", companyError: new Error("boom"), deleteError: new Error("gone") });
    await runSignup(f.deps, request());
    expect(JSON.stringify(f.logs)).not.toContain("northgate");
  });
});
