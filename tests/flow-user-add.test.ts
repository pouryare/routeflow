import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow, answerStep } from "@/lib/crm/flows/machine";
import { ROLES } from "@/lib/roles";
import { userAddFlow, userAddRequest, userAddChips, credentialsMessage, ASSIGNABLE_ROLES } from "@/lib/flows/userAdd";
import { generatePassword, generateUsername, PASSWORD_ALPHABET } from "@/lib/credentials";
import { assertFlowBudget, assertNoRawEnumLabels } from "./helpers/flowAssert";

const flow = userAddFlow(ROLES);
const ctx: FlowContext = {
  ...EMPTY_CONTEXT,
  entry: "user_add",
  lists: { group: [{ id: 3, label: "گروه شمال" }, { id: 4, label: "گروه جنوب" }] },
  vars: { username: "user-abc12", password: "Pw12345678" },
};

describe("user add flow", () => {
  it("meets its budget and never offers the platform owner", () => {
    assertFlowBudget(flow, [{ ctx, values: { name: "علی", phonenum: "0912" } }], { common: 4, longest: 5 });
    assertNoRawEnumLabels(flow);
    expect(ASSIGNABLE_ROLES(ROLES)).not.toContain("platform_owner");
  });
  it("a non-owner picks a group; the request carries the generated credentials", () => {
    let st = startFlow(flow, ctx);
    st = answerStep(flow, ctx, st, ROLES.find((r) => r !== "owner" && r !== "platform_owner")!);
    st = answerStep(flow, ctx, st, "g3");
    st = answerStep(flow, ctx, st, "ok", "  علی رضایی ");
    st = answerStep(flow, ctx, st, "nophone");
    expect(st.saved).toBe(true);
    expect(userAddRequest(ctx, st)).toMatchObject({ username: "user-abc12", password: "Pw12345678", display_name: "علی رضایی", group_id: 3, phone: null });
    expect(userAddChips(ctx, st)).toContain("گروه شمال");
  });
  it("an owner skips the group question and has no group", () => {
    let st = startFlow(flow, ctx);
    st = answerStep(flow, ctx, st, "owner");
    st = answerStep(flow, ctx, st, "ok", "مدیر");
    st = answerStep(flow, ctx, st, "addphone");
    st = answerStep(flow, ctx, st, "ok", "09121234567");
    expect(userAddRequest(ctx, st)).toMatchObject({ group_id: null, phone: "09121234567", role: "owner" });
  });
  it("the message to the new person has the name, username and password", () => {
    expect(credentialsMessage("علی", "u", "p")).toBe("علی\nنام کاربری: u\nرمز عبور: p");
  });
});

describe("generated credentials", () => {
  const fixed = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256);
  it("passwords are 10 characters from the unambiguous alphabet and meet the server minimum", () => {
    const p = generatePassword(fixed);
    expect(p).toHaveLength(10);
    for (const ch of p) expect(PASSWORD_ALPHABET).toContain(ch);
    expect(p.length).toBeGreaterThanOrEqual(8);
  });
  it("usernames fit the server rule (3-40 letters, digits, dot, dash, underscore)", () => {
    expect(generateUsername(fixed)).toMatch(/^[A-Za-z0-9._-]{3,40}$/);
  });
  it("different random input gives a different password", () => {
    expect(generatePassword(fixed)).not.toBe(generatePassword((n) => Uint8Array.from({ length: n }, (_, i) => (i * 91 + 5) % 256)));
  });
});
