import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntakeWizard } from "@/app/get-started/wizard-v3";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

beforeEach(() => {
  frames = new Map(); nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextFrame; frames.set(id, callback); return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function deliverFrames() {
  act(() => {
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(performance.now());
  });
}

async function reachSecondStep() {
  const view = render(<IntakeWizard fixtureMode />);
  await screen.findByRole("heading", { name: "Start with your documents" });
  fireEvent.change(screen.getByLabelText("Full name required"), { target: { value: "Keyboard Customer" } });
  fireEvent.change(screen.getByLabelText(/^Email address required/), { target: { value: "keyboard@example.invalid" } });
  fireEvent.change(screen.getByLabelText(/^Current resume required/), {
    target: { files: [new File(["%PDF-1.7\n%%EOF"], "synthetic-resume.pdf", { type: "application/pdf" })] },
  });
  fireEvent.click(screen.getByRole("button", { name: /save and continue/i }));
  await screen.findByRole("heading", { name: "Choose the work you want" });
  return view;
}

describe("intake step focus", () => {
  it("focuses the initially loaded step before animation frames run", async () => {
    render(<IntakeWizard fixtureMode />);
    const heading = await screen.findByRole("heading", { name: "Start with your documents" });
    expect(heading).toHaveFocus();
    deliverFrames();
    expect(heading).toHaveFocus();
  });

  it("keeps typing focus through the draft autosave", async () => {
    const user = userEvent.setup();
    render(<IntakeWizard fixtureMode />);
    const field = await screen.findByLabelText("Full name required");
    await user.type(field, "Keyboard Customer");
    expect(field).toHaveFocus();
    await screen.findByText("Saved", {}, { timeout: 2_000 });
    deliverFrames();
    expect(field).toHaveFocus();
    expect(field).toHaveValue("Keyboard Customer");
  });

  it("preserves Tab and Space on the new step while delayed frames run between keydown and keyup", async () => {
    const user = userEvent.setup();
    await reachSecondStep();
    const activity = screen.getAllByRole("checkbox", { name: /Coordinating projects/ })[0];
    await user.tab();
    expect(activity).toHaveFocus();
    await user.keyboard("[Space>]");
    deliverFrames();
    expect(activity).toHaveFocus();
    await user.keyboard("[/Space]");
    expect(activity).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /save and continue/i }));
    const heading = await screen.findByRole("heading", { name: "Confirm experience and skills" });
    expect(heading).toHaveFocus();
  });

  it("focuses the requested review edit control when returning to an earlier step", async () => {
    await reachSecondStep();
    fireEvent.click(screen.getAllByRole("checkbox", { name: /Coordinating projects/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: /save and continue/i }));
    await screen.findByRole("heading", { name: "Confirm experience and skills" });
    fireEvent.click(screen.getByRole("button", { name: /save and continue/i }));
    await screen.findByRole("heading", { name: "Set requirements and review" });
    fireEvent.click(screen.getByRole("button", { name: "Edit contact and documents" }));
    await screen.findByRole("heading", { name: "Start with your documents" });
    expect(screen.getByLabelText("Full name required")).toHaveFocus();
    deliverFrames();
    expect(screen.getByLabelText("Full name required")).toHaveFocus();
  });

  it("leaves no delayed step focus that can affect a replacement screen after unmount", async () => {
    const view = await reachSecondStep();
    view.unmount();
    render(<button>Replacement screen</button>);
    const replacement = screen.getByRole("button", { name: "Replacement screen" });
    replacement.focus();
    deliverFrames();
    expect(replacement).toHaveFocus();
  });
});
