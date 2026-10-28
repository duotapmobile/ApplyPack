import { describe, expect, it } from "vitest";
import { invitationAuthRedirect, invitationFragment, invitationSignInHref, parseInvitationFragment } from "@/lib/commerce/invitation-fragment";

const id = "51000000-0000-4000-8000-000000000021";
const secret = "i".repeat(43);
const fragment = `#invitationId=${id}&invitationSecret=${secret}`;

describe("private invitation fragments", () => {
  it("shares one strict parser and keeps the sign-in next parameter free of the invitation", () => {
    expect(parseInvitationFragment(fragment)).toEqual({ id, secret });
    expect(invitationFragment(`#invitationSecret=${secret}&invitationId=${id}`)).toBe(fragment);
    const href = new URL(invitationSignInHref(fragment), "https://applypack.invalid");
    expect(href.searchParams.get("next")).toBe("/get-started");
    expect(href.search).not.toContain(secret);
    expect(href.hash).toBe(fragment);
  });
  it.each(["", fragment.slice(1), `${fragment}&other=value`, `${fragment}&invitationId=${id}`, `#invitationId=bad&invitationSecret=${secret}`, fragment.slice(0, -1), `${fragment}%20`, `${fragment}#another`, "#candidate-questions"])("rejects invalid, mixed and duplicate fragments (%#)", value => {
    expect(parseInvitationFragment(value)).toBeNull();
    expect(invitationSignInHref(value)).toBe("/sign-in?next=%2Fget-started");
  });
  it("only appends the browser invitation to a validated intake destination", () => {
    expect(invitationAuthRedirect("/get-started", fragment)).toBe(`/get-started${fragment}`);
    expect(invitationAuthRedirect("/get-started?choose=1", fragment)).toBe(`/get-started?choose=1${fragment}`);
    expect(invitationAuthRedirect("/my-applypack", fragment)).toBe("/my-applypack");
    expect(invitationAuthRedirect("https://attacker.invalid/get-started", fragment)).toBe("/get-started");
    expect(invitationAuthRedirect("//attacker.invalid/get-started", fragment)).toBe("/get-started");
    expect(invitationAuthRedirect(`/get-started${fragment}`)).toBe("/get-started");
    expect(invitationAuthRedirect(`/contact${fragment}`, fragment)).toBe("/contact");
    expect(invitationAuthRedirect("/my-applypack#historical-delivery-123", fragment)).toBe("/my-applypack#historical-delivery-123");
  });
});
