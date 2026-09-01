# ApplyPack Consolidated Preflight Questions and Credentials

The executing agent must ask this information in one organized message before implementation. It must not ask for passwords, secret keys, API keys, recovery codes, or payment information in ordinary chat.

The user should authenticate directly in provider dashboards, use approved connector or CLI login flows, or place secrets in local and hosting-provider secret stores when instructed.

## A. Repository and authority

1. What is the exact local path of the ApplyPack site repository?
2. What is the exact GitHub repository URL?
3. Which branch is the implementation branch?
4. Is the agent authorized to create branches, commit, push, open a pull request, merge, deploy preview, and deploy production? Answer each separately.
5. Are there protected branches or files that must not be changed?
6. What is the current public site URL and current preview URL?
7. Is the user-created `DESIGN.md` ready? If yes, where is it? If no, should backend work proceed while preserving the existing design?

## B. Current site and hosting

8. Which provider hosts the site?
9. Is the agent already logged in to that provider on this computer?
10. Which project and production environment correspond to ApplyPack?
11. Is there an existing backend, database, authentication provider, storage provider, or serverless-function layer?
12. Are separate preview and production environments required?
13. Is the agent authorized to create new hosted projects when no compatible backend exists?

## C. Domain and DNS

14. Is `applypack.work` registered and owned by the user?
15. Which registrar holds the domain?
16. Which provider currently controls authoritative DNS?
17. Is the agent authorized to change nameservers and DNS records?
18. Should the canonical site be `https://applypack.work` with `www` redirected to the apex?
19. Are there any existing DNS records that must be preserved?
20. Is DNSSEC already enabled or should it be enabled after the zone is stable?

## D. Business identity and legal display

21. Is DuoTap LLC the legal seller and site operator?
22. What legal business name, address, and contact email must appear on payment receipts and legal pages?
23. What customer-facing payment descriptor should appear on card statements?
24. Is the initial service limited to customers and jobs in the United States?
25. Has the user approved the current Privacy Policy, Terms, refund language, and accessibility statement, or should they be treated as implementation drafts pending legal review?

## E. Stripe and payment decisions

26. Does the user already have a Stripe account for this business?
27. Is the Stripe account fully verified for live payments and payouts?
28. Is the agent authorized to create products, prices, webhooks, restricted keys, and test-mode data?
29. Is the agent authorized to activate live mode and run a real payment smoke test?
30. Confirm prices: $20 for one 10-job search, $8 for each selected Apply Pack.
31. Should payment methods be limited to methods that confirm immediately, so the 24-hour clock can begin immediately?
32. Should Stripe Tax be enabled, or has a tax professional advised a different approach?
33. Confirm the exact cancellation, refund, missed-deadline, job-closure, and replacement policy.
34. Is the agent authorized to implement admin-triggered Stripe refunds?

## F. Email and sender identity

35. What existing personal or business inbox should receive forwarded support mail?
36. Confirm desired public addresses, recommended defaults:

```text
support@applypack.work
accessibility@applypack.work
privacy@applypack.work
```

37. Confirm desired transactional sender, recommended default:

```text
ApplyPack <orders@mail.applypack.work>
Reply-To: support@applypack.work
```

38. Does the user want a paid mailbox provider, or free inbound forwarding plus a transactional sending provider?
39. Does the user already have a Resend account, or should the agent create and configure one when authorized?
40. Is the agent authorized to add SPF, DKIM, MX, and DMARC DNS records?
41. Should email open and click tracking remain disabled to minimize personal-data collection? Recommended default: yes.

## G. Backend provider and authentication

42. If the current site has no suitable backend, may the agent use the recommended default stack: Supabase for Postgres, passwordless authentication, private storage, and row-level security; Stripe for payments; Resend for transactional email?
43. Which email addresses are authorized ApplyPack administrators?
44. Confirm customer authentication method. Recommended default: email one-time code before private upload and portal access.
45. Confirm admin authentication. Recommended default: separate admin role plus MFA.
46. Is the agent authorized to create database migrations, storage buckets, RLS policies, scheduled jobs, and server-side functions?

## H. Product decisions that must be locked

47. Does 24 hours mean actual clock hours, including weekends and holidays?
48. What timezone should public deadlines use? Recommended default: America/New_York, store all timestamps in UTC.
49. What is the maximum number of new 10-job searches that may be accepted in a rolling 24-hour period?
50. What is the maximum number of Apply Packs that may be accepted in a rolling 24-hour period?
51. Can one customer purchase all 10 Apply Packs in one checkout when capacity allows?
52. Is a current resume required for the $20 search and $8 Apply Packs? Recommended default: yes.
53. Is a current cover letter optional? Recommended default: yes.
54. Should a resume-from-scratch customer be blocked with a clear separate-service message until pricing is defined?
55. Confirm accepted uploads and limits. Recommended default: one DOCX or text-based PDF resume, one optional DOCX or text-based PDF cover letter, 10 MB each.
56. Confirm source-document retention after order completion. Recommended default: 30 days, unless the customer requests earlier deletion or longer retention.
57. Confirm customer workspace retention and job-result retention.
58. Confirm one round of factual corrections per Apply Pack. Recommended request window: three calendar days.
59. Confirm the Match Promise and the distinction between Not for Me and Conflicts With Approved Criteria.
60. Confirm whether a closed job at Apply Pack checkout blocks purchase until another job is selected.
61. Confirm whether a job that closes after Apply Pack payment but before drafting can be transferred or refunded.
62. Confirm whether the job search itself is performed manually by the ApplyPack admin for launch. Recommended default: yes, with no automated scraping in the first release.
63. Confirm whether resumes and cover letters are produced manually and uploaded by the admin for launch. Recommended default: yes, with no automatic customer-facing AI generation.
64. Confirm whether the customer must review and approve exact search criteria before paying. Recommended default: yes.
65. Confirm whether customer job results are delivered only in the private portal, with email linking to the portal. Recommended default: yes.

## I. File security and monitoring

66. Is the user willing to use an external malware-scanning provider if the current hosting environment cannot run a private scanner?
67. If no scanner is available, does the user accept a launch with strict type validation, private storage, limited file size, and documented residual risk?
68. Which error-monitoring provider should be used, if any?
69. Is the agent authorized to create monitoring projects and alerts?
70. Which email address should receive urgent deadline, failed-payment, failed-email, security, and production alerts?
71. What backup and restore expectations apply to the database and private files?

## J. Analytics and search

72. Which analytics provider, if any, is approved?
73. Should session replay and heatmaps be prohibited on all intake, payment, portal, admin, and upload routes? Recommended default: yes.
74. Is the agent authorized to verify Google Search Console and Bing Webmaster Tools?
75. Is the agent authorized to submit sitemaps and configure IndexNow?
76. Which public social profile URLs should be included in structured data, if any?

## K. Production verification

77. May the agent create test customers and synthetic resumes that contain no real personal information?
78. May the agent run a complete Stripe test-mode transaction?
79. May the agent run one live $20 search purchase and one live $8 Apply Pack purchase, then refund them, for production verification?
80. Who gives final approval to declare the site ready to ship?

## Required preflight behavior

The agent must:

- Ask all questions in one message.
- Group them so the user can answer quickly.
- Pre-fill facts already established in these documents and ask only for confirmation where needed.
- Clearly separate login actions from business decisions.
- Never ask the user to paste a secret into chat.
- Tell the user exactly which dashboards or CLI login flows must be opened.
- Ask for all external-action authorizations before implementation.
- After the user answers, write the confirmed answers to `docs/applypack/IMPLEMENTATION_DECISIONS.md` and continue without stopping.
