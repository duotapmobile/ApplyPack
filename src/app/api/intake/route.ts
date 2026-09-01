import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { extensionMatchesMimeType, hasExpectedFileSignature } from "@/lib/files/signatures";
import { allowedResumeTypes, parseIntakeForm } from "@/lib/schemas/intake";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_RESUME_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) {
    return NextResponse.json({ error: "Private account storage is not connected yet." }, { status: 503 });
  }
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ error: "Secure email sign-in is required.", authRequired: true }, { status: 401 });
  }

  const rate = await consumeRateLimit({ request, scope: "intake_submit", identity: authData.user.id, limit: 10, windowSeconds: 60 * 60 });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many intake attempts. Try again later." }, { status: 429 });
  }
  const formData = await request.formData();
  let parsed;
  try {
    parsed = parseIntakeForm(formData);
  } catch {
    return NextResponse.json({ error: "The intake data could not be read." }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "Complete every required intake field.", details: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.email.toLowerCase() !== (authData.user.email || "").toLowerCase()) {
    return NextResponse.json({ error: "Use the email address that received your secure sign-in link." }, { status: 403 });
  }

  const resume = formData.get("resume");
  const coverLetter = formData.get("coverLetter");
  if (!(resume instanceof File) || resume.size === 0) {
    return NextResponse.json({ error: "Attach your current resume." }, { status: 400 });
  }
  if (resume.size > MAX_RESUME_BYTES || !allowedResumeTypes.has(resume.type) || !extensionMatchesMimeType(resume.name, resume.type) || !(await hasExpectedFileSignature(resume))) {
    return NextResponse.json({ error: "Upload a PDF or DOCX resume no larger than 10 MB." }, { status: 400 });
  }
  if (coverLetter instanceof File && coverLetter.size > 0 && (
    coverLetter.size > MAX_RESUME_BYTES || !allowedResumeTypes.has(coverLetter.type) ||
    !extensionMatchesMimeType(coverLetter.name, coverLetter.type) || !(await hasExpectedFileSignature(coverLetter))
  )) {
    return NextResponse.json({ error: "The optional cover letter must be a valid PDF or DOCX no larger than 10 MB." }, { status: 400 });
  }

  const intakeId = randomUUID();
  const resumeExtension = resume.name.toLowerCase().split(".").pop();
  const storagePath = authData.user.id + "/intakes/" + intakeId + "/source/resume." + resumeExtension;
  const coverPath = coverLetter instanceof File && coverLetter.size > 0 ? authData.user.id + "/intakes/" + intakeId + "/source/cover-letter." + coverLetter.name.toLowerCase().split(".").pop() : null;
  const { error: uploadError } = await admin.storage.from("customer-source-documents").upload(storagePath, resume, {
    contentType: resume.type,
    upsert: false,
  });
  if (uploadError) {
    return NextResponse.json({ error: "Your resume could not be stored securely." }, { status: 502 });
  }
  if (coverPath && coverLetter instanceof File) {
    const { error: coverError } = await admin.storage.from("customer-source-documents").upload(coverPath, coverLetter, {
      contentType: coverLetter.type,
      upsert: false,
    });
    if (coverError) {
      await admin.storage.from("customer-source-documents").remove([storagePath]);
      return NextResponse.json({ error: "Your cover letter could not be stored securely." }, { status: 502 });
    }
  }

  const { error: insertError } = await admin.from("intakes").insert({
    id: intakeId,
    customer_id: authData.user.id,
    email: parsed.data.email.toLowerCase(),
    direction: [parsed.data.directionChoice, parsed.data.targetTitles].filter(Boolean).join(": "),
    priorities: [...parsed.data.employmentTypes, ...parsed.data.schedulePreferences, ...parsed.data.requiredBenefits, ...parsed.data.preferredBenefits],
    dealbreakers: [...parsed.data.neverInclude, parsed.data.oldCareerExclusion].filter(Boolean).join("; "),
    location_preference: [parsed.data.city, parsed.data.state, parsed.data.remoteRequirement, parsed.data.remoteDetail].filter(Boolean).join("; "),
    schedule_preference: parsed.data.schedulePreferences.join("; ") || "No specific schedule preference",
    minimum_salary: parsed.data.minimumSalary || null,
    cover_letter_path: coverPath,
    experience_summary: parsed.data.backgroundDetails,
    notes: [parsed.data.tools, parsed.data.credentials, parsed.data.resumeCorrections].filter(Boolean).join("\n\n") || null,
    resume_path: storagePath,
    status: "ready_for_payment",
    criteria_version: 1,
    criteria_approved_at: new Date().toISOString(),
  });
  if (insertError) {
    await admin.storage.from("customer-source-documents").remove([storagePath, ...(coverPath ? [coverPath] : [])]);
    return NextResponse.json({ error: "Your intake could not be saved." }, { status: 502 });
  }
  const [profileResult, answersResult, criteriaResult] = await Promise.all([
    admin.from("profiles").update({ display_name: parsed.data.fullName }).eq("id", authData.user.id),
    admin.from("intake_answers").insert({ intake_id: intakeId, customer_id: authData.user.id, answers: parsed.data }),
    admin.from("criteria_versions").insert({
      intake_id: intakeId,
      version: 1,
      approved_by: authData.user.id,
      snapshot: parsed.data,
    }),
  ]);
  if (profileResult.error || answersResult.error || criteriaResult.error) {
    await admin.from("intakes").delete().eq("id", intakeId);
    await admin.storage.from("customer-source-documents").remove([storagePath, ...(coverPath ? [coverPath] : [])]);
    return NextResponse.json({ error: "Your approved search criteria could not be preserved." }, { status: 502 });
  }
  return NextResponse.json({ intakeId });
}
