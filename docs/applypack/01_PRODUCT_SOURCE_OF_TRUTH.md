# ApplyPack Product Source of Truth

Last updated: September 1, 2026

## Product definition

ApplyPack is a done-for-you job-search and application-preparation service.

It performs three connected functions:

### Searching

ApplyPack finds 10 current job opportunities selected around the customer's approved experience, priorities, preferences, and non-negotiables.

### Connecting

ApplyPack identifies the honest connection between what the customer has already done and what a different employer needs, including connections the customer may not recognize from an unfamiliar title or corporate wording.

### Writing

For each customer-selected job, ApplyPack prepares a resume and cover letter tailored to that job and employer.

## Core public promise

```text
We find the jobs. We get you ready to apply.
```

Supporting promise:

```text
Your search in 24 hours. Your application in the next 24.
```

## Initial audience

The initial customer may be a woman or mother who:

- Has useful work experience but does not want to return to the same field.
- Has spent time outside traditional employment.
- Does not know which modern job titles match her skills.
- Knows what she does not want, even when she cannot name the exact job she wants.
- Has priorities such as remote work, a salary threshold, benefits, flexibility, or limited phone work.
- Does not have time to scroll through thousands of postings.
- Does not understand modern resume screening systems.
- Does not want a generic AI-written resume or cover letter.
- Needs help making legitimate connections between prior work, side businesses, volunteer work, education, caregiving periods, and a different career direction.

The brand must remain broad enough to serve people beyond mothers.

## Locked pricing model

### Job Match Search

```text
Price: $20
Deliverable: 10 matched job opportunities
Turnaround: within 24 hours
Payment timing: paid before research begins
```

### Apply Pack

```text
Price: $8 per selected job
Deliverable: one tailored resume and one tailored cover letter for the selected job
Turnaround: within 24 hours of successful payment and valid job selection
Payment timing: paid after the customer sees the job matches and selects the jobs she wants
```

Example:

```text
$20 search + 10 Apply Packs at $8 each = $100 total
```

There is no subscription and no obligation to purchase an Apply Pack for every delivered job.

## Turnaround rules

The public promise is 24 hours. The system must show an exact deadline, not only the phrase within 24 hours.

### Search deadline

```text
search_work_ready_at = later of:
- completed and approved intake timestamp
- successful payment timestamp

search_due_at = search_work_ready_at + 24 hours
```

Payment must not be available before the required intake is complete and the customer has approved the search criteria. Therefore, in the normal flow, successful payment starts the search clock.

### Apply Pack deadline

```text
apply_pack_work_ready_at = later of:
- valid selected-job confirmation timestamp
- successful payment timestamp
- any required customer update completed before checkout

apply_pack_due_at = apply_pack_work_ready_at + 24 hours
```

### Required clarification before implementation

The user must confirm in the initial preflight whether 24 hours means actual clock hours including weekends and holidays. The recommended default is actual clock hours because that is what the public wording ordinarily communicates.

### Capacity rule

Do not accept an order when current capacity makes the displayed 24-hour deadline impossible.

The system must:

- Calculate capacity before checkout.
- Reserve capacity briefly while checkout is open.
- Release the reservation when checkout expires or fails.
- Allow the admin to configure maximum search orders and Apply Pack units per rolling 24-hour period.
- Temporarily pause checkout when capacity is full.
- Never accept payment and quietly weaken the deadline afterward.

## Existing-document rule

Recommended launch rule, subject to user confirmation in the initial preflight:

```text
Current resume: required
Current cover letter: optional
```

The resume may be old, poorly formatted, written for another career, or incomplete. It is the factual starting point.

A resume built entirely from scratch is a separate service because it can require a much longer employment-history intake. Do not silently include a from-scratch resume inside the $8 price.

## What a matched job means

Use this definition consistently:

```text
A matched job is a current opportunity selected around the criteria the customer approved and a reasonable overlap with the customer's actual experience. A match does not guarantee that an employer will agree with ApplyPack's assessment, review the application, invite the customer to interview, or make an offer.
```

A matched job should include:

- Job title
- Company
- Direct employer application URL when available
- Work location
- Remote eligibility and geographic restriction
- Compensation when listed
- Employment type
- Date posted when available
- Date checked by ApplyPack
- Why the role may fit
- Customer experience that overlaps
- Important requirements
- Honest gaps or concerns
- Private internal snapshot of the job description used for the fit analysis and application work

## Search criteria structure

The intake must distinguish:

### Non-negotiables

A delivered match may not materially violate these.

Examples:

- Remote required
- Minimum posted salary required
- No sales
- No marketing
- No cold calling
- Full-time required
- Specific work authorization or location rule

### Preferences

These should influence ranking but do not automatically disqualify an otherwise strong match.

Examples:

- Flexible schedule preferred
- Benefits preferred when not listed
- Limited phone work
- Independent work
- Monday through Friday

### Hard exclusions

These are work types, industries, schedules, locations, or conditions the customer said never to include.

### Soft exclusions

These are things to avoid when possible but not automatic disqualifiers.

The customer must review and approve the rendered criteria before paying.

## Match Promise

Recommended public policy, subject to user confirmation:

```text
Every job is selected using the priorities and dealbreakers the customer approved before the search begins.

If a result materially conflicts with an approved non-negotiable, ApplyPack will review it and replace it at no charge.
```

Examples that should qualify for review and replacement:

- Remote was required, but the delivered job is on-site.
- No sales was a hard exclusion, but the job is substantively a sales role.
- A minimum posted salary was required, but the employer's listed maximum is below it.
- The customer cannot legally work in the required jurisdiction.
- The employer page was already closed when ApplyPack delivered it.

Examples that do not automatically qualify:

- The customer dislikes the company after delivery.
- The customer changes her salary target after delivery.
- The customer decides she no longer wants an activity that was not an approved non-negotiable.
- The customer dislikes the job title even though the duties match approved criteria.
- The employer closes the job after ApplyPack delivered a live opening.
- The customer simply chooses not to apply.

The customer must be able to choose either:

```text
Not for Me
```

or:

```text
This Conflicts With My Approved Criteria
```

These actions have different consequences. Not for Me does not automatically create a replacement.

## Apply Pack selection model

After the 10 jobs are delivered, each job card includes:

```text
Get My Apply Pack for $8
```

The customer can select one or more jobs. Selected jobs enter a cart. The cart total is exactly:

```text
selected job count x $8
```

The customer pays once for the selected group. The backend creates one Apply Pack order per selected job.

Before accepting payment, the system must:

- Confirm each selected job is still eligible for purchase.
- Recheck job availability or require an admin-confirmed recent check.
- Confirm capacity for the entire selected quantity.
- Show the exact delivery deadline.
- Collect optional emphasis and do-not-mention notes.
- Ask whether any factual background changed since the original intake.

## Writing rules

Each Apply Pack must:

- Use the customer's real experience.
- Preserve truthful historical employers, titles, dates, education, certifications, and tools.
- Emphasize the strongest legitimate overlap with the selected job.
- Make an unfamiliar connection easy for the employer to recognize.
- Use the employer's relevant language naturally when it truthfully applies.
- Surface important gaps rather than disguising them.
- Avoid generic AI voice.
- Avoid invented metrics, revenue, percentages, team sizes, tools, or results.
- Be defensible in an interview.
- Provide editable Word files.

ApplyPack does not submit applications on the customer's behalf.

## Human review and AI disclosure

Approved concept:

```text
Not just another AI resume.
```

ApplyPack may use technology and AI-assisted tools to speed up research, comparison, and drafting. A person makes the fit decisions, reviews every claim, edits the writing, and approves delivery.

Do not claim AI-free unless that becomes factually true.

Do not expose private resumes, job notes, or customer information to a model or vendor whose retention and training policies have not been reviewed and approved.

## Corrections and revisions

Recommended launch rule, subject to user confirmation:

```text
One round of factual corrections per Apply Pack, requested within three calendar days of delivery.
```

A factual correction covers:

- Incorrect name or contact detail
- Incorrect date
- Incorrect historical title
- Missing fact the customer already supplied
- Wrong company or target position
- Similar objective factual error

It does not cover:

- A new target job
- A new career direction
- New experience provided after delivery
- A complete tone or strategy rewrite
- Unlimited subjective revisions

## Outcomes disclaimer

This must be visible on the public site, pricing page, checkout, FAQ, and Terms:

```text
ApplyPack does not guarantee interviews, offers, compensation, or employment.
```

Approved public framing:

```text
No one can promise you the job. ApplyPack can make sure you're ready to apply.
```

Supporting distinction:

```text
What ApplyPack handles:
- Jobs selected around approved criteria
- Honest explanations of why they may fit
- Job-specific resumes and cover letters
- Human review before delivery

What employers decide:
- Who reviews an application
- Who receives an interview
- Who receives an offer
- What compensation is offered
- How long a job remains open
```

## Refund and cancellation principles

The final policy requires user confirmation and legal review. The recommended product logic is:

- The $20 fee pays for research and delivery of the 10-job shortlist.
- The customer does not receive a refund merely because she chooses not to apply to a delivered job.
- A result that materially violates an approved non-negotiable is reviewed and replaced at no charge.
- A changed preference after research begins does not invalidate the original approved search.
- If ApplyPack cannot complete an unfinished order, it may offer a replacement, partial refund, or full refund depending on the unfinished work.
- If ApplyPack misses a posted 24-hour deadline for a reason within its control, the customer may cancel the unfinished item and receive a refund for that unfinished item.
- If a selected job closes before ApplyPack begins the paid Apply Pack work, the customer may transfer the $8 to another eligible job or request a refund.
- If the employer closes the job after the completed Apply Pack is delivered, the completed Apply Pack is not automatically refundable.

Do not implement refund automation until the user approves the exact policy.

## Data and privacy principles

- Customer resumes and cover letters are private.
- ApplyPack does not sell customer personal information.
- Do not request a Social Security number, full date of birth, banking information, marital status, children's names, health information, or other information that is not needed.
- Use private storage and short-lived signed access links.
- Do not put customer names, email addresses, resume text, file names, or job notes in analytics events.
- Do not put customer PII in payment metadata.
- Do not publish customer job-match pages.
- Use clear retention and deletion rules.

## Business identity

The current project context indicates DuoTap LLC may be the legal operating entity. This must be confirmed in the preflight before it appears in checkout, receipts, footer text, Terms, Privacy Policy, payment descriptors, or provider verification.

## Non-goals for the first production release

Do not add unless the user expressly authorizes them:

- Automatic job applications
- Employer accounts
- Recruiter marketplace
- Customer-to-employer messaging
- Interview scheduling
- Automated scraping of large job boards
- Subscription plans
- Mobile app
- LinkedIn profile rewriting
- Public customer profiles
- Customer chat system
- Automatic AI generation and delivery without human review
- A promise to find a job
- A promise to beat or bypass an applicant tracking system
