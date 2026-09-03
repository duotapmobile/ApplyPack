# ApplyPack Customer and Admin Workflows

Last updated: September 1, 2026

## End-to-end customer flow

```text
Public site

↓

Get Started

↓

Verify email address

↓

Upload current resume and optional cover letter

↓

Complete background and preference intake

↓

Review and approve exact search criteria

↓

Pay $20

↓

24-hour search order begins

↓

Receive 10 jobs in private My ApplyPack workspace

↓

Review each fit explanation, gap, and employer link

↓

Select one or more jobs for Apply Packs

↓

Review selected jobs, optional notes, exact total, and deadline

↓

Pay $8 per selected job

↓

24-hour Apply Pack orders begin

↓

Download tailored resume and cover letter for each job

↓

Review before applying

↓

Optionally request one bounded factual correction
```

## Customer authentication

Recommended default, subject to preflight confirmation:

- Passwordless email one-time code.
- Verify the email address before accepting a private resume upload.
- The same verified identity accesses My ApplyPack.
- Do not require a password.
- Do not reveal whether an email has an account when requesting a code.
- Rate-limit code requests and verification attempts.
- Use accessible authentication that permits copy, paste, password managers, and assistive technology.

Public access route:

```text
/my-applypack/
```

Copy:

```text
ACCESS YOUR APPLYPACK

Enter the email address you used when you ordered.

We'll send you a secure one-time code.

No password required.

Email address
[________________________]

[Send My Access Code]
```

Verification state:

```text
CHECK YOUR EMAIL

Enter the 6-digit code we sent to:

customer@email.com

Code
[________________]

[Open My ApplyPack]

[Send a New Code]
```

## Intake progress

Recommended visible steps:

```text
Step 1 of 7: Your account
Step 2 of 7: Upload what you have
Step 3 of 7: Your background
Step 4 of 7: What needs to stay
Step 5 of 7: What needs to go
Step 6 of 7: Where should we look?
Step 7 of 7: Review your search
```

Payment follows the seven-step intake and is not counted as an intake step.

The intake must save after each completed step and allow the customer to return.

## Step 1: Customer account and contact

Fields:

```text
Full name, required
Email address, required and verified
City, required
State, required
Timezone, derived with customer confirmation when needed
```

Do not collect a full street address unless a confirmed tax or legal requirement makes it necessary.

Supporting copy:

```text
We will not sell your resume or personal information.
```

## Step 2: Upload what you have

Recommended launch requirement:

```text
Current resume, required
Current cover letter, optional
LinkedIn profile, optional
```

Copy:

```text
UPLOAD WHAT YOU HAVE.

Your resume does not need to be current, pretty, or perfect.

That is what ApplyPack is here for.
```

Upload controls:

```text
CURRENT RESUME
Required
Accepted files: Microsoft Word or PDF
Maximum file size: 10 MB
[Choose Resume]
```

```text
CURRENT COVER LETTER
Optional

Have a cover letter that includes useful background or sounds like you?
Upload it here.

Do not have one?
No problem.

[Choose Cover Letter]
```

```text
LINKEDIN PROFILE
Optional
[https://www.linkedin.com/in/________________]
```

Formatting preference:

```text
HOW SHOULD WE HANDLE YOUR CURRENT RESUME FORMAT?

○ Keep the existing look when it remains clear and hiring-system friendly.

○ Move my information into ApplyPack's clean resume format.

○ Decide what works best.
```

Recommended default:

```text
Decide what works best.
```

Cover-letter preference, shown only when a file is uploaded:

```text
HOW SHOULD WE USE THIS COVER LETTER?

○ I like how it sounds. Use it as a guide to my voice.

○ Use it for background facts only.

○ I do not like it. Please start fresh.
```

Upload warning:

```text
Before uploading, remove Social Security numbers, full birth dates, banking information, and other highly sensitive information.
```

## Step 3: Background not captured by the resume

Copy:

```text
WHAT DOESN'T YOUR RESUME SHOW?

A job title rarely tells us everything you actually did.

Tell us about useful experience that may be missing, outdated, or easy to overlook.
```

Checkboxes:

```text
Run a small business
Sold products online
Freelance or contract work
Volunteer work
School or community leadership
Managed vendors or suppliers
Trained or supervised people
Organized events or programs
Completed recent courses or certifications
Managed major family or caregiving responsibilities
Other
```

Follow-up prompts:

```text
Tell us what you actually did.

What did you organize?
Who did you communicate with?
What problems did you solve?
What tools did you use?
What deadlines, orders, people, or information did you manage?
```

Additional fields:

```text
Software, tools, or platforms you have actually used

Certifications, licenses, or education not listed correctly on your resume

Resume facts that are wrong or outdated
```

Trust note:

```text
Time outside traditional employment may still include volunteering, side work, courses, school involvement, organization, research, or other useful experience.

ApplyPack uses what is relevant without turning unpaid family responsibilities into a job title you never held.
```

## Step 4: What needs to stay

The interface must distinguish required from preferred.

Copy:

```text
WHAT NEEDS TO FIT YOUR LIFE NOW?

Mark what is required and what would simply be nice to have.
```

### Work setting

```text
Remote
Required | Preferred | Not important

Hybrid
Open to it | Do not include

On-site
Open to it | Do not include
```

Remote detail:

```text
Remote anywhere in the United States
Remote only in my state
Remote with occasional travel
Remote with occasional office visits
```

### Compensation

```text
Minimum annual salary
Preferred annual salary
Minimum hourly rate
Preferred hourly rate
```

Unknown-salary policy:

```text
What should we do when the employer does not list compensation?

○ Exclude the job.

○ Include it when the role otherwise appears strong, but clearly mark compensation as unknown.
```

### Employment type

```text
Full-time
Required | Preferred | Do not include

Part-time
Open to it | Do not include

Contract
Open to it | Do not include

Temporary
Open to it | Do not include
```

### Schedule

```text
Monday through Friday required
No nights
No weekends
Flexible hours preferred
School-hours preference
Specific time zone
Other
```

### Benefits

```text
Health insurance
Required | Preferred | Not important

Paid time off
Required | Preferred | Not important

Retirement benefits
Required | Preferred | Not important
```

Unknown-benefits policy:

```text
What should we do when benefits are not described in the posting?

○ Exclude the job.

○ Include it, but mark benefits as unknown.
```

## Step 5: What needs to go

Copy:

```text
WHAT ARE YOU DONE DOING?

Sometimes knowing what you do not want is the clearest place to start.
```

Two groups:

```text
NEVER INCLUDE
```

and:

```text
TRY TO AVOID
```

Options:

```text
Sales
Cold calling
Commission-only work
Marketing
Social media
Heavy phone work
Customer-facing work
Managing people
Travel
Nights
Weekends
On-site work
Temporary work
Contract work
Teaching
Healthcare
Retail
Other
```

Supporting definition:

```text
Never include means a non-negotiable.

Try to avoid means a preference that may be outweighed by an otherwise strong opportunity.
```

Open fields:

```text
What did you dislike most about your previous work?

Are there industries or companies you do not want included?
```

## Step 6: Search direction and eligibility

Copy:

```text
HOW CLEAR IS YOUR NEXT DIRECTION?

You do not need to know the exact title.
```

Choices:

```text
I know the exact roles I want.

I have a few ideas but am open to related roles.

I want a different direction and need ApplyPack to make the connections.

I have no idea what the job is called yet.
```

Conditional target-title field:

```text
Roles or titles you already want us to consider
```

Search-distance choices:

```text
CLOSE TO MY PAST WORK
Find a similar kind of role in a different company or setting.

ADJACENT TO MY EXPERIENCE
Use many of the same skills in a different type of role.

OPEN TO A BIGGER CHANGE
Show me less obvious roles when there is a reasonable connection.
```

Explicit old-career exclusion:

```text
Is there a previous career or role you specifically do not want to return to?
```

Eligibility and logistics:

```text
Where are you legally authorized to work?

Will you now or in the future need employer sponsorship?

Are you willing to travel?

If hybrid or on-site work is acceptable, how far are you willing to travel from home?

Are there required licenses, certifications, physical requirements, or schedule restrictions we should know about?
```

Do not ask about disability, pregnancy, age, religion, race, marital status, family status, or health history.

## Step 7: Criteria review and approval

The system renders a plain-language summary grouped as:

```text
NON-NEGOTIABLES
PREFERENCES
EXPERIENCE WE WILL BUILD FROM
SEARCH DIRECTION
```

Example:

```text
NON-NEGOTIABLES

✓ Remote
✓ Full-time
✓ Minimum posted salary of $80,000
✓ Health benefits
✓ No sales
✓ No marketing
✓ No cold calling
```

```text
PREFERENCES

Flexible schedule
Independent work
Limited phone work
Monday through Friday
```

```text
EXPERIENCE WE WILL BUILD FROM

Teaching
Private-label e-commerce
Vendor coordination
Training
Documentation
Operations
```

```text
SEARCH DIRECTION

Open to adjacent and less obvious roles

Do not include classroom teaching positions
```

Each section has a Change action that returns to the relevant intake step without losing data.

Search agreement:

```text
YOUR $20 COVERS:

ApplyPack's research

10 current job opportunities selected around the approved criteria above

Direct employer links

An explanation of why each job may fit

Important requirements and possible concerns

Delivery within 24 hours
```

Required acknowledgments:

```text
I approve the search criteria shown above.
```

```text
I understand that the $20 pays for ApplyPack's research and delivery of 10 matched opportunities. It does not guarantee that I will personally like or apply to every job.
```

```text
I understand that ApplyPack does not guarantee interviews, offers, compensation, or employment.
```

```text
I understand that job listings can change or close after ApplyPack checks them.
```

Button:

```text
Continue to Secure Payment
```

## Search checkout

Summary:

```text
YOUR 24-HOUR JOB MATCH SEARCH

10 matched job opportunities

$20

Your turnaround begins after successful payment.
```

When capacity is available, show exact deadline before payment.

When capacity is full:

```text
TODAY'S 24-HOUR DELIVERY SPOTS ARE FULL.

ApplyPack is temporarily pausing new orders so current customers receive their work on time.

[Notify Me When a Spot Opens]
```

## Search confirmation

```text
YOUR SEARCH HAS STARTED.

ApplyPack is reviewing your experience, priorities, and dealbreakers.

Your 10 matched job opportunities will be delivered by:

[DATE]
[TIME AND TIMEZONE]

We sent your confirmation and private ApplyPack access link to:

[CUSTOMER EMAIL]

[Open My ApplyPack]
```

## Customer dashboard

Navigation:

```text
Overview
My Search Criteria
My 10 Jobs
My Apply Packs
My Files
Corrections
```

Search in progress:

```text
YOUR JOB SEARCH IS IN PROGRESS.

Due:
[DATE AND TIME]

Current status:

Intake received
Payment received
Research in progress
Quality review
Ready
```

Do not expose internal notes.

## Delivered 10-job results

Header:

```text
YOUR 10 JOBS ARE READY.

Selected around:
[SUMMARY OF KEY CRITERIA]

Checked on:
[DATE]

Job listings can change quickly. Always review the employer's current posting before applying.
```

Each job card contains:

```text
Match number
Job title
Company
Location
Remote eligibility
Compensation when listed
Employment type
Date posted when available
Date checked by ApplyPack
Why this may fit
Your matching experience
What to know, including gaps
Important requirements
Direct employer link
```

Actions:

```text
View the Employer's Job Posting
Get My Apply Pack for $8
Save for Later
Not for Me
This Conflicts With My Approved Criteria
```

### Not for Me

Meaning:

```text
This job met the approved criteria, but I personally do not want to pursue it.
```

Behavior:

- Record the decision.
- Allow an optional reason for product learning.
- Do not promise a replacement.
- Do not automatically refund.

### Conflicts With Approved Criteria

Form reasons:

```text
Wrong work setting
Below approved minimum salary
Includes excluded sales work
Includes excluded marketing work
Wrong schedule
Wrong location
Other
```

Behavior:

- Create a review request.
- Show status Pending Review.
- Admin compares the result with the versioned approved criteria.
- If conflict is valid, admin replaces the match at no charge.
- Preserve an audit record of the decision.

## Apply Pack selection

The customer clicks:

```text
Get My Apply Pack for $8
```

Selected state:

```text
APPLY PACK SELECTED

Resume + cover letter

$8

[Remove]
```

Sticky cart summary:

```text
YOUR APPLY PACKS

3 jobs selected

$24 total

[Review Selected Jobs]
```

The control must remain accessible at 320 CSS pixels and must not obscure keyboard focus or critical content.

## Apply Pack cart and review

Each selected job shows:

```text
Job title
Company
Resume + cover letter
$8
Remove
```

Optional per-job fields:

```text
Anything you want us to emphasize for this job?
Optional, maximum 500 characters
```

```text
Anything you do not want mentioned?
Optional, maximum 500 characters
```

Global update question:

```text
Has anything changed since your original intake?

No

Yes, I need to update something
```

If yes, collect and store changed facts before payment. Do not silently alter the approved search criteria after the search was delivered.

Order summary:

```text
3 Apply Packs
$8 each
Total: $24
```

Show the exact deadline calculated from current capacity and payment rules.

Required acknowledgments:

```text
I confirm that these are the jobs I want ApplyPack to prepare materials for.
```

```text
I understand that ApplyPack does not submit applications for me.
```

```text
I understand that ApplyPack cannot guarantee employer review, interviews, offers, or employment.
```

## Apply Pack checkout and capacity

Before checkout:

- Revalidate all selected job records.
- Confirm the employer URL remains available when technically and legally feasible.
- Confirm the admin's recent job-check timestamp satisfies the configured freshness threshold.
- Confirm capacity for the entire selected quantity.
- Reserve capacity for the checkout session.
- Show the exact total and deadline.

If the customer selects more units than available:

```text
ONLY [NUMBER] MORE 24-HOUR SPOTS ARE AVAILABLE.

You selected [NUMBER] jobs.

Select up to [AVAILABLE] now, or return when another 24-hour spot opens.

[Choose Jobs]
```

## Apply Pack confirmation

```text
YOUR APPLY PACKS ARE IN PROGRESS.

[COUNT] jobs selected

Total paid:
[AMOUNT]

Your tailored resumes and cover letters will be delivered by:

[DATE]
[TIME AND TIMEZONE]

[View My Apply Packs]
```

## Apply Pack delivery

Completed card:

```text
YOUR APPLY PACK IS READY.

[JOB TITLE]
[COMPANY]

Delivered:
[DATE AND TIME]
```

Downloads:

```text
RESUME
[DESCRIPTIVE FILE NAME]
[Download Resume]
```

```text
COVER LETTER
[DESCRIPTIVE FILE NAME]
[Download Cover Letter]
```

Review notice:

```text
REVIEW BEFORE SUBMITTING

Read both documents carefully.

Confirm that every date, title, responsibility, certification, and result is accurate.

You are responsible for approving and submitting your application.
```

Actions:

```text
View the Employer's Job Posting
Everything Is Accurate
Request a Factual Correction
```

## Factual correction workflow

Copy:

```text
REQUEST A FACTUAL CORRECTION

One round of factual corrections is included.
```

Fields:

```text
Which document needs correction?
Resume | Cover letter | Both

What information is incorrect?

What should the correct information say?

Where does it appear?
```

Clarification:

```text
This form is for factual errors, missing facts you already provided, names, dates, titles, contact information, and similar corrections.

A new job target, different strategy, new experience, or complete rewrite is not a factual correction.
```

## Admin authentication

Recommended default:

- Separate admin authorization, not a customer-controlled flag.
- MFA required for admin accounts.
- Server-side authorization for every admin operation.
- No service-role or admin secret in browser code.
- Log significant admin actions without logging resume content.

## Admin dashboard

Main views:

```text
24-Hour Searches
24-Hour Apply Packs
Replacement Reviews
Correction Requests
Customers
Orders and Payments
Capacity Settings
Email Delivery
Audit Log
System Health
```

### Search queue columns

```text
Customer
Order ID
Paid at
Due at
Time remaining
Status
Assigned admin
Match count
Blocking issue
```

### Apply Pack queue columns

```text
Customer
Company
Position
Paid at
Due at
Time remaining
Status
Assigned admin
Files ready
Blocking issue
```

### Required search statuses

```text
payment_pending
ready_for_research
researching
selecting_matches
quality_review
ready_to_deliver
delivered
replacement_requested
completed
cancelled
refunded
```

### Required Apply Pack statuses

```text
payment_pending
ready_to_draft
resume_drafting
cover_letter_drafting
quality_review
ready_to_deliver
delivered
correction_requested
completed
cancelled
refunded
```

State changes must be validated server-side. Do not let a client send an arbitrary status string.

## Admin match builder

Fields:

```text
Job title
Company
Direct employer URL
Location
Remote status and geographic restrictions
Salary minimum and maximum
Compensation source text
Employment type
Date posted
Date checked
Full private job-description snapshot or operator-supplied text
Why the role may fit
Matching customer experience
Important requirements
Possible gaps or concerns
Internal notes
```

Actions:

```text
Save Draft
Preview Customer View
Validate Against Approved Criteria
Add to Customer's 10 Jobs
Remove From Delivery Set
```

The system must prevent delivery until:

- Exactly 10 customer-visible matches are approved.
- Every match has a date checked.
- Every match has a direct URL or a documented exception.
- Every match has a fit explanation.
- Every match has at least one requirement or a documented none-listed state.
- Every match has a gap or a documented no-material-gap state.
- None materially violates approved non-negotiables.
- The quality checklist is complete.

## Admin Apply Pack production view

Display together:

```text
Customer profile
Approved search criteria
Current resume
Optional old cover letter
Additional background
Formatting preference
Cover-letter voice preference
Target job snapshot
Fit reasoning
Matching evidence
Important gaps
Customer emphasis notes
Customer do-not-mention notes
```

Upload controls:

```text
Upload tailored resume
Upload tailored cover letter
Replace file
Preview metadata
```

Required quality checklist:

```text
Correct customer name and contact information
Correct target company and position
No invented metrics
No invented tools or certifications
Historical employers and titles remain truthful
Relevant job language is used naturally
Important gap is not disguised
Resume is readable and editable
Cover letter sounds human
File names are correct
Both documents open successfully
Employer job link was rechecked
No customer PII appears in logs or analytics
```

Delivery remains unavailable until every checklist item is complete.

## Admin deadline behavior

Internal thresholds:

```text
More than 12 hours remaining: normal
12 hours remaining: approaching
6 hours remaining: priority
2 hours remaining: urgent
Past due: missed deadline alert
```

The exact threshold values may be configurable, but must not change the contractual due time.

Notifications:

- Email admin when an order enters the queue.
- Email or alert at configured deadline thresholds.
- Alert immediately when a payment webhook, email delivery, upload, or document-delivery event fails.
- Do not expose customer PII in third-party alert titles.

## Manual-first operating model

Recommended first release:

- The job search is performed manually by the ApplyPack admin.
- The admin enters the 10 matches into the dashboard.
- Resumes and cover letters are prepared and quality-checked by the admin.
- The admin uploads finished DOCX files.
- The backend controls intake, payments, deadlines, private delivery, job selection, corrections, and records.
- Do not build automated job scraping or automatic document generation unless separately authorized.

This model is faster to ship, easier to supervise, and consistent with the public human-review promise.

## Approved source-assisted research amendment

The owner subsequently authorized bounded official-source discovery. Automated source output is candidate research, not automatic customer delivery. The admin still verifies the posting, restrictions, employment relationship, costs, fit, and freshness before delivering exactly 10 matches.

Customer job details display W-2/contractor/staffing status, work mode and state/timezone limits, phone intensity, sales/marketing/commission labels, benefits, pay model, equipment responsibility, applicant-paid costs, source category, and an accurately labeled official or third-party link. Source operations follow `docs/runbooks/JOB_SOURCE_OPERATIONS.md`.
