import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntakeWizard } from "@/app/get-started/wizard-v3";
import { FactFieldsEditor } from "@/components/intake/fact-fields-editor";
import { useState } from "react";
import type { EditableFactValues } from "@/lib/intake/four-step";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function background() {
  render(<IntakeWizard fixtureMode />);
  await screen.findByLabelText("Full name required");
  fireEvent.change(screen.getByLabelText("Full name required"), { target: { value: "Synthetic Customer" } });
  fireEvent.change(screen.getByLabelText(/^Account access email required/), { target: { value: "synthetic@example.invalid" } });
  fireEvent.click(screen.getByLabelText("Build my background without a resume"));
  fireEvent.click(screen.getByRole("button", { name: /save and continue/i }));
  await screen.findByRole("heading", { name: "Choose the work you want" });
  fireEvent.click(screen.getAllByRole("checkbox", { name: /Supporting customers/ })[0]);
  fireEvent.click(screen.getByRole("button", { name: /save and continue/i }));
  await screen.findByRole("heading", { name: "Confirm experience and skills" });
}
async function addRole() {
  fireEvent.click(screen.getByRole("button", { name: "Add experience" }));
  fireEvent.change(screen.getByLabelText("Employer, organization, school or project"), { target: { value: "Fixture Store" } });
  fireEvent.change(screen.getByLabelText("Your actual role or relationship"), { target: { value: "Cashier" } });
}
async function requirements() {
  fireEvent.click(screen.getByLabelText(/I checked for missing or outdated/));
  fireEvent.click(screen.getByRole("button", { name: /save and continue/i }));
  await screen.findByRole("heading", { name: "Set requirements and review" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Remote" }));
  fireEvent.change(screen.getByLabelText(/^U.S. state or District/), { target: { value: "VA" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Full Time" }));
  fireEvent.click(screen.getByLabelText(/I agree to the Terms/));
}
describe("guided intake and actual review", () => {
  it("commits edited lines before immediate review, keeps blank typing lines, and follows an external reset", () => {
    const review = vi.fn();
    function Editor() {
      const [fields, setFields] = useState<EditableFactValues>({ bullets: ["Original task"] });
      return <><FactFieldsEditor value={fields} onChange={setFields} /><button onClick={() => review(fields)}>Review now</button><button onClick={() => setFields({ bullets: ["Restored task"] })}>Restore prior correction</button></>;
    }
    render(<Editor />);
    const input = screen.getByLabelText("Correct bullets (one per line)");
    fireEvent.change(input, { target: { value: "New task\n\nSecond task\n" } });
    expect(input).toHaveValue("New task\n\nSecond task\n");
    fireEvent.click(screen.getByRole("button", { name: "Review now" }));
    expect(review).toHaveBeenCalledWith({ bullets: ["New task", "Second task"] });
    fireEvent.click(screen.getByRole("button", { name: "Restore prior correction" }));
    expect(input).toHaveValue("Restored task");
  });
  it("edits several fields of one uploaded record together with plain inputs", async () => {
    window.history.replaceState(null, "", "/get-started?source=compound");
    try {
      render(<IntakeWizard fixtureMode />);
      await screen.findByRole("radio", { name: "Correct it" });
      fireEvent.click(screen.getByRole("radio", { name: "Correct it" }));
      fireEvent.change(screen.getByLabelText("Correct employer"), { target: { value: "Corrected Store" } });
      fireEvent.change(screen.getByLabelText("Correct historical title"), { target: { value: "Team lead" } });
      fireEvent.change(screen.getByLabelText("Correct phone"), { target: { value: "555 0199" } });
      await requirements();
      fireEvent.click(screen.getByRole("button", { name: "Review my information" }));
      await screen.findByRole("heading", { name: "Confirm your saved information" });
      const review = screen.getByRole("region", { name: "Document facts and corrections" });
      for (const value of ["Corrected Store", "Team lead", "555 0199"]) expect(review).toHaveTextContent(value);
    } finally { window.history.replaceState(null, "", "/"); }
  });
  it("starts without a resume and never preselects contextual duties", async () => {
    await background(); await addRole();
    expect(screen.getByText("Your answers are the starting point.")).toBeVisible();
    expect(screen.queryByText("Resume extraction is not ready yet.")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Handled payments" })).not.toBeChecked();
    expect(screen.getByText("Add supporting detail (optional)")).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: "Handled payments" }));
    expect(screen.getByRole("checkbox", { name: "Handled payments" })).toBeChecked();
  });
  it("asks for missing factual tasks before final review", async () => {
    await background(); await addRole();
    fireEvent.click(screen.getByLabelText(/I checked for missing or outdated/));
    fireEvent.click(screen.getByRole("button", { name: /save and continue/i }));
    expect(await screen.findAllByText(/Choose or briefly describe at least one task/)).not.toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Confirm experience and skills" })).toBeVisible();
  });
  it("preserves customer-written duties when the role changes and clears only suggested selections", async () => {
    await background(); await addRole();
    fireEvent.click(screen.getByRole("checkbox", { name: "Handled payments" }));
    fireEvent.blur(screen.getByLabelText("Other tasks you actually did (optional, one per line)"), { target: { value: "Maintained the stock notebook" } });
    fireEvent.change(screen.getByLabelText("Your actual role or relationship"), { target: { value: "Office assistant" } });
    expect(screen.queryByRole("checkbox", { name: "Handled payments" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Other tasks you actually did (optional, one per line)")).toHaveValue("Maintained the stock notebook");
    expect(screen.getByRole("checkbox", { name: "Organized records" })).not.toBeChecked();
  });
  it("shows actual facts, requires explicit final confirmation, and invalidates it on section edit", async () => {
    await background(); await addRole(); fireEvent.click(screen.getByRole("checkbox", { name: "Handled payments" }));
    await requirements();
    fireEvent.click(screen.getByRole("button", { name: "Review my information" }));
    expect(await screen.findByRole("heading", { name: "Confirm your saved information" })).toHaveFocus();
    const section = screen.getByRole("region", { name: "Experience 1: Cashier" });
    expect(within(section).getByText("Organization or project: Fixture Store")).toBeVisible();
    expect(within(section).getByText("Tasks actually done: Handled payments")).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm and submit intake" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I reviewed the actual information/));
    expect(screen.getByRole("button", { name: "Confirm and submit intake" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Edit contact and documents" }));
    expect(await screen.findByLabelText("Full name required")).toHaveFocus();
    expect(screen.queryByLabelText(/I reviewed the actual information/)).not.toBeInTheDocument();
  });
});
