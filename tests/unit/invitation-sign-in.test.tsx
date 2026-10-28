import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
import { EmailCodeSignIn } from "@/components/auth/email-code-sign-in";
const secret = "j".repeat(43);
const fragment = `#invitationId=51000000-0000-4000-8000-000000000021&invitationSecret=${secret}`;
const fetchMock = vi.fn();
const reply = (body: unknown, ok = true) => ({ ok, json: async () => body });
beforeEach(() => { fetchMock.mockReset(); router.push.mockReset(); router.refresh.mockReset(); vi.stubGlobal("fetch", fetchMock); window.history.replaceState(null, "", `/sign-in?next=%2Fget-started${fragment}`); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function request(email = "owner@example.invalid") {
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Send My Sign-In Code" }));
  await screen.findByLabelText("Six-digit code");
}
function verify() { fireEvent.change(screen.getByLabelText("Six-digit code"), { target: { value: "123456" } }); fireEvent.click(screen.getByRole("button", { name: "Continue Securely" })); }
describe("invitation sign-in continuity", () => {
  it("carries the invitation only in the final client redirect and removes it from the sign-in history entry", async () => {
    fetchMock.mockResolvedValueOnce(reply({ ok: true })).mockResolvedValueOnce(reply({ ok: true, redirectTo: "/get-started" }));
    const storage = vi.spyOn(Storage.prototype, "setItem");
    render(<EmailCodeSignIn />); await request(); verify();
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/get-started${fragment}`));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ email: "owner@example.invalid", code: "123456", next: "/get-started" });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(secret);
    expect(storage).not.toHaveBeenCalled(); storage.mockRestore();
    expect(window.location.hash).toBe("");
  });
  it("preserves the fragment during a failed code and an explicit account correction without granting intake access", async () => {
    fetchMock.mockResolvedValueOnce(reply({ ok: true })).mockResolvedValueOnce(reply({ error: "That code is invalid." }, false)).mockResolvedValueOnce(reply({ ok: true }));
    render(<EmailCodeSignIn />); await request("wrong@example.invalid"); verify();
    expect(await screen.findByText("That code is invalid.")).toBeVisible(); expect(window.location.hash).toBe(fragment); expect(router.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" })); await request();
    expect(window.location.hash).toBe(fragment); expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(secret);
  });
  it.each([`${fragment}&other=value`, "#invitationId=bad&invitationSecret=bad"])("ignores and removes invalid mixed fragments (%#)", async hash => {
    window.history.replaceState(null, "", `/sign-in?next=%2Fget-started${hash}`);
    fetchMock.mockResolvedValueOnce(reply({ ok: true })).mockResolvedValueOnce(reply({ redirectTo: "/get-started" }));
    render(<EmailCodeSignIn />); await waitFor(() => expect(window.location.hash).toBe("")); await request(); verify();
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/get-started"));
  });
  it("does not forward an invitation to another local page or an unsafe returned destination", async () => {
    fetchMock.mockResolvedValueOnce(reply({ ok: true })).mockResolvedValueOnce(reply({ redirectTo: "https://attacker.invalid/get-started" }));
    render(<EmailCodeSignIn />); await request(); verify();
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/get-started"));
    expect(window.location.hash).toBe("");
  });
});
