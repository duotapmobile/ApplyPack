import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateQuestions } from "@/components/intake/candidate-questions";
const question = { id: "10000000-0000-4000-8000-000000000001", prompt: "Which scheduling tools did you actually use?", answered: false, review_required: false };
const receipt = { state: "FULL_REVIEW_REQUIRED", draftId: "10000000-0000-4000-8000-000000000002", version: 2, expiresAt: "2026-10-26T00:00:00+00:00", replayed: false };
const reply = (body: unknown, ok = true) => ({ ok, json: async () => body });
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open() {
  render(<CandidateQuestions expectedDraftId="10000000-0000-4000-8000-000000000009" />);
  fireEvent.click(screen.getByRole("button", { name: "Check saved profile questions" }));
  return screen.findByLabelText(question.prompt);
}
async function answer() {
  const input = await open();
  fireEvent.change(input, { target: { value: "A paper calendar; I do not know the software." } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Save factual answer" }));
}
describe("customer clarification answers", () => {
  it("does not redisplay answered questions and clearly requests the separate complete review", async () => {
    fetchMock.mockResolvedValueOnce(reply({ questions: [{ ...question, answered: true, review_required: true }] }))
      .mockResolvedValueOnce(reply({ ...receipt, replayed: true }));
    render(<CandidateQuestions signedIn />);
    fireEvent.click(screen.getByRole("button", { name: "Check saved profile questions" }));
    expect(await screen.findByRole("link", { name: "Choose your saved intake to review and confirm" })).toHaveAttribute("href", "/get-started?choose=1");
    expect(screen.queryByRole("button", { name: "Open saved complete intake review" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(question.prompt)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/customer/candidate-questions", { cache: "no-store" });
  });
  it("saves an answer without claiming final confirmation or changing the job requirement", async () => {
    fetchMock.mockResolvedValueOnce(reply({ questions: [question] })).mockResolvedValueOnce(reply(receipt));
    await answer();
    expect(await screen.findByRole("link", { name: "Review and confirm your updated intake" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Review every section");
    expect(screen.queryByLabelText(question.prompt)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("invalidates the answer checkbox as soon as the text changes", async () => {
    fetchMock.mockResolvedValue(reply({ questions: [question] }));
    const input = await open();
    fireEvent.change(input, { target: { value: "Paper calendar" } }); fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Save factual answer" })).toBeEnabled();
    fireEvent.change(input, { target: { value: "I am not sure" } });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save factual answer" })).toBeDisabled();
  });
  it.each(["lost", "malformed"])("preserves typed text after an uncertain %s result and never retries automatically", async (kind) => {
    fetchMock.mockResolvedValueOnce(reply({ questions: [question] }));
    if (kind === "lost") fetchMock.mockRejectedValueOnce(new Error("network"));
    else fetchMock.mockResolvedValueOnce(reply({ state: "FULL_REVIEW_REQUIRED" }));
    await answer();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("save result is uncertain"));
    expect(screen.getByLabelText(question.prompt)).toHaveValue("A paper calendar; I do not know the software.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("retains the bounded historical factual-answer response", async () => {
    fetchMock.mockResolvedValueOnce(reply({ questions: [question] })).mockResolvedValueOnce(reply({ state: "REVIEW_REQUIRED", factId: question.id }));
    await answer();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("does not change a job requirement"));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("rejects an unbounded question collection without rendering it", async () => {
    fetchMock.mockResolvedValue(reply({ questions: Array.from({ length: 101 }, () => question) }));
    render(<CandidateQuestions expectedDraftId="10000000-0000-4000-8000-000000000009" />); fireEvent.click(screen.getByRole("button", { name: "Check saved profile questions" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Questions are unavailable"));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("recovers a lost answer response through a saved-review check without resending typed text", async () => {
    fetchMock.mockResolvedValueOnce(reply({ questions: [question] })).mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce(reply({ questions: [{ ...question, answered: true, review_required: true }] }))
      .mockResolvedValueOnce(reply({ ...receipt, replayed: true }));
    await answer(); await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("save result is uncertain"));
    fireEvent.click(screen.getByRole("button", { name: "Check saved profile questions" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open saved complete intake review" }));
    expect(await screen.findByRole("link", { name: "Review and confirm your updated intake" })).toBeVisible();
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ action: "RESUME", questionId: question.id });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("does not link to the wrong old draft when review-cookie recovery fails", async () => {
    fetchMock.mockResolvedValueOnce(reply({ questions: [{ ...question, answered: true, review_required: true }] }))
      .mockResolvedValueOnce(reply({ error: "unavailable" }, false));
    render(<CandidateQuestions expectedDraftId="10000000-0000-4000-8000-000000000009" />); fireEvent.click(screen.getByRole("button", { name: "Check saved profile questions" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open saved complete intake review" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Review access could not be confirmed"));
    expect(screen.queryByRole("link", { name: "Review and confirm your updated intake" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose your saved intake to restore access" })).toHaveAttribute("href", "/get-started?choose=1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
