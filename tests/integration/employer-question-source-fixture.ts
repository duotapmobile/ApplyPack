import type { PaidSearchSourceFixture } from "./verified-paid-search-setup";

// Fictional HTTP responses only. The registered source, current authorization,
// adapter, capture hashes, run archive and source promotion remain production code.
export function employerQuestionSourceFixture() {
  const sourceId = "duolingo", boardToken = "duolingo";
  const origin = "https://boards-api.greenhouse.io";
  const listPath = `/v1/boards/${boardToken}/jobs`;
  const jobIds = Array.from({ length: 10 }, (_, index) => String(117000 + index));
  const listingText = "Fictional résumé fixture — not an actual employer opening. "
    + "Remote full-time role in Virginia. Required: proficient with Excel. "
    + "Responsibilities: coordinate service recovery. Salary: $60000 per year. "
    + "Resume required. Cover letter optional. Accepted formats: DOCX and PDF. Submission method: HTTPS upload.";
  const questions = [
    { label: "Describe how you helped a customer solve a problem. Limit your response to 200 words.", required: true,
      fields: [{ name: "question_customer_recovery_117", type: "textarea", max_length: 1200 }], word_limit: 200 },
    { label: "Describe your experience analyzing student assessment data.", required: false,
      fields: [{ name: "question_student_analysis_117", type: "textarea" }] },
  ];
  const listings = jobIds.map((jobId, index) => ({ id: Number(jobId), title: `Operations Coordinator ${index + 1}`,
    absolute_url: `https://job-boards.greenhouse.io/${boardToken}/jobs/${jobId}`,
    content: listingText, location: { name: "Remote, Virginia" } }));
  const responses = new Map(listings.map((listing) => [String(listing.id), { ...listing, questions }]));
  const requests: { method: string; url: string; kind: "LIST" | "QUESTIONS"; jobId: string | null }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== origin || url.username || url.password || url.hash)
      throw new Error("fictional_employer_source_request_rejected");
    if (url.pathname === listPath && url.search === "?content=true") {
      requests.push({ method: request.method, url: url.href, kind: "LIST", jobId: null });
      return Response.json({ jobs: listings });
    }
    const jobId = url.pathname.startsWith(`${listPath}/`) ? url.pathname.slice(listPath.length + 1) : "";
    const response = responses.get(jobId);
    if (!response || url.search !== "?questions=true") throw new Error("fictional_employer_question_request_rejected");
    requests.push({ method: request.method, url: url.href, kind: "QUESTIONS", jobId });
    return Response.json(response);
  };
  const sourceFixture: PaidSearchSourceFixture = { sourceId, allowedActions: ["ENUMERATE_JOBS", "READ_APPLICATION_QUESTIONS"],
    allowedHosts: ["boards-api.greenhouse.io", "job-boards.greenhouse.io"], requestBound: 11, durationMsBound: 60000, fetch };
  return { sourceFixture, boardToken, jobIds, listingText, questions, responses, requests };
}

export type EmployerQuestionSourceFixture = ReturnType<typeof employerQuestionSourceFixture>;
