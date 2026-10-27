"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- A new secure draft cookie requires a full reload, including when already on /get-started. */
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { clarificationAnswerReceiptSchema, clarificationQuestionsSchema as questionsSchema } from "@/lib/intake/clarification-contract";
import { privateIntakeRequest } from "@/lib/intake/private-request";

export function CandidateQuestions({ signedIn = false, expectedDraftId, autoLoad = false }: { signedIn?: boolean; expectedDraftId?: string; autoLoad?: boolean }) {
  const [questions, setQuestions] = useState<z.infer<typeof questionsSchema>>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [reviewQuestionId, setReviewQuestionId] = useState<string | null>(null);
  const [reviewAccessReady, setReviewAccessReady] = useState(false);
  const [selectionRequired, setSelectionRequired] = useState(false);
  const endpoint = signedIn ? "/api/customer/candidate-questions" : "/api/intake/anonymous-draft/questions";
  const request = useCallback((init: RequestInit) => signedIn ? fetch(endpoint, init) : privateIntakeRequest(expectedDraftId || "", endpoint, init), [endpoint, expectedDraftId, signedIn]);
  const load = useCallback(async () => {
    setBusy(true);
    setReviewAccessReady(false);
    try {
      const response = await request({ cache: "no-store" });
      const data = await response.json();
      const parsed = questionsSchema.safeParse(data.questions);
      if (!response.ok && [401, 404, 409].includes(response.status)) setSelectionRequired(true);
      if (!response.ok || !parsed.success) throw new Error("unavailable");
      setSelectionRequired(false);
      const pending = parsed.data.filter((question) => !question.answered);
      setQuestions(pending);
      setReviewRequired(parsed.data.some((question) => question.review_required));
      setReviewQuestionId(parsed.data.find((question) => question.review_required && question.answered)?.id ?? null);
      setStatus(pending.length ? "Answer only what you know. Tell us when you are unsure." : "No unanswered clarification questions.");
    } catch { setStatus("Questions are unavailable. Your answers remain here. Try again."); }
    finally { setBusy(false); }
  }, [request]);
  useEffect(() => { if (!autoLoad) return; const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [autoLoad, load]);
  async function answer(id: string) {
    setBusy(true);
    try {
      const response = await request({ method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: id, answer: answers[id], confirmed: confirmed[id] }) });
      const data = await response.json();
      if (!response.ok) { if ([401, 404, 409].includes(response.status)) setSelectionRequired(true); setStatus(typeof data.error === "string" ? data.error : "This answer could not be saved. Your text remains here."); return; }
      const receipt = clarificationAnswerReceiptSchema.safeParse(data);
      if (!receipt.success) throw new Error("unconfirmed_receipt");
      setQuestions((current) => current.filter((question) => question.id !== id));
      if (receipt.data.state === "FULL_REVIEW_REQUIRED") {
        setReviewRequired(true);
        setReviewQuestionId(id);
        setReviewAccessReady(!signedIn);
        setStatus("Answer saved. Review every section of your updated intake and confirm it before we continue. You can edit the answer during that review.");
      } else setStatus("Answer saved for evidence review. This does not change a job requirement. Contact support if you need to correct it.");
    } catch { setStatus("The save result is uncertain. Your text remains here. Check saved questions before trying again."); }
    finally { setBusy(false); }
  }
  async function resumeReview() {
    if (!reviewQuestionId || signedIn) return;
    setBusy(true); setReviewAccessReady(false);
    try {
      const response = await request({ method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RESUME", questionId: reviewQuestionId }) });
      const data = await response.json(), receipt = clarificationAnswerReceiptSchema.safeParse(data);
      if (!response.ok || !receipt.success || receipt.data.state !== "FULL_REVIEW_REQUIRED") throw new Error("review_access_unconfirmed");
      setReviewAccessReady(true);
      setStatus("Your saved review is available. Check every section and confirm the complete updated intake before we continue.");
    } catch { setSelectionRequired(true); setStatus("Review access could not be confirmed. Choose your saved intake to restore access. Your answers remain saved."); }
    finally { setBusy(false); }
  }
  return <section id="candidate-questions" aria-labelledby="candidate-questions-title" aria-busy={busy}>
    <h2 id="candidate-questions-title">Questions about your experience</h2>
    <button type="button" disabled={busy || reviewAccessReady} onClick={() => void load()}>Check saved profile questions</button>
    {questions.map((question) => <div key={question.id}>
      <label htmlFor={`question-${question.id}`}>{question.prompt}</label>
      <textarea id={`question-${question.id}`} disabled={busy || reviewAccessReady} maxLength={5_000} value={answers[question.id] || ""}
        onChange={(event) => { setAnswers((current) => ({ ...current, [question.id]: event.target.value })); setConfirmed((current) => ({ ...current, [question.id]: false })); }} />
      <label><input type="checkbox" disabled={busy || reviewAccessReady} checked={!!confirmed[question.id]}
        onChange={(event) => setConfirmed((current) => ({ ...current, [question.id]: event.target.checked }))} />I confirm this answer accurately describes what I know.</label>
      <button type="button" disabled={busy || reviewAccessReady || !confirmed[question.id] || !answers[question.id]?.trim()} onClick={() => void answer(question.id)}>Save factual answer</button>
    </div>)}
    <p role="status">{status}</p>
    {reviewRequired && <p>{signedIn ? <a href="/get-started?choose=1">Choose your saved intake to review and confirm</a> : reviewAccessReady ? <a href="/get-started">Review and confirm your updated intake</a>
      : <button type="button" disabled={busy || !reviewQuestionId} onClick={() => void resumeReview()}>Open saved complete intake review</button>}</p>}
    {selectionRequired && !signedIn && <p><a href="/get-started?choose=1">Choose your saved intake to restore access</a></p>}
  </section>;
}
