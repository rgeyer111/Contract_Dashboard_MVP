# Contract Dashboard MVP — Project Handoff

**Prepared:** 28 August 2026  
**Repository:** <https://github.com/rgeyer111/Contract_Dashboard_MVP>  
**Primary application:** Contract Dashboard MVP  
**Status:** Functional MVP ready for structured user testing

## 1. Purpose

The Contract Dashboard MVP helps a user upload contract PDFs, extract important renewal information, verify the extracted evidence, assign responsibility, calculate contractual deadlines, and manage contracts through a searchable registry.

The product is designed around trust and traceability:

- extracted values remain linked to page-level source evidence;
- uncertain or conflicting clauses are made visible rather than silently resolved;
- users verify extracted information before adding a contract to the registry;
- deadline calculations are performed consistently on the server;
- uploaded documents are managed independently;
- destructive actions require confirmation and retain source PDFs in controlled waste storage.

## 2. Main User Journey

1. A user signs in.
2. The user uploads one or more PDF contracts.
3. The application validates, stores, and extracts each PDF.
4. Scanned documents are rendered and processed with OCR.
5. The user reviews values, confidence, page references, and verbatim evidence.
6. The user resolves incomplete or ambiguous fields and assigns an owner.
7. The confirmed contract is saved in PostgreSQL.
8. The contract appears in the Contract Registry.
9. The server calculates notice deadlines, action dates, status colours, and alerts.
10. Users can filter, search, reopen, edit, and make renewal decisions.
11. Users can permanently delete a contract record after confirmation.
12. Its retained source PDF is copied and hash-verified in waste storage before the database record is deleted.
13. Administrators can inspect and permanently purge waste files.

## 3. Workspace and Artifacts

The project is a pnpm/TypeScript monorepo.

### Contract Dashboard

Path: `artifacts/contract-dashboard`

React and Vite web application containing:

- signed-out landing and authentication screens;
- contract dashboard and registry;
- multi-PDF upload and resumable ingestion;
- extraction review and editing;
- contract decision history;
- alerts and action items;
- saved and pinned registry views;
- English and Swiss German UI;
- administrator waste-management interface.

Important locations:

- `src/App.tsx` — routing, Clerk wrapper, demo access, and application entry.
- `src/pages/dashboard.tsx` — dashboard, registry, upload, filters, alerts, and deletion UI.
- `src/pages/review-compact.tsx` — extraction review and confirmation.
- `src/pages/contract-decision.tsx` — recurring renewal decisions and history.
- `src/pages/admin-waste.tsx` — administrator waste review and purge.
- `src/lib/i18n.tsx` — English and `de-CH` interface strings and formatting.

### API Server

Path: `artifacts/api-server`

Express API mounted under `/api`.

Responsibilities include:

- authenticated and account-scoped contract access;
- contract CRUD operations;
- PDF extraction and OCR;
- resumable ingest runs;
- SHA-256 deduplication;
- source PDF storage and signed access;
- deadline and alert calculations;
- saved registry views;
- decision history;
- verified deletion to waste;
- cleanup retries;
- administrator waste operations.

Important locations:

- `src/app.ts` — Express application and middleware.
- `src/middlewares/require-auth.ts` — Clerk identity enforcement.
- `src/routes/contracts.ts` — contract, ingest, deletion, and waste routes.
- `src/lib/contract-extraction.ts` — AI extraction.
- `src/lib/contract-computation.ts` — deadline, action-date, and alert rules.
- `src/lib/contract-ingest-storage.ts` — private PDF and waste storage.
- `src/lib/contract-ingest-cleanup.ts` — durable source cleanup and retries.

### Shared Libraries

- `lib/api-spec/openapi.yaml` — API source of truth.
- `lib/api-client-react` — generated React Query API client.
- `lib/api-zod` — generated request and response validation.
- `lib/db` — Drizzle/PostgreSQL schema and database connection.
- `lib/integrations-openai-ai-server` — server-side AI integration.

Generated API files should not be edited as the primary source. Update the OpenAPI specification and regenerate them.

### Other Registered Artifacts

- `artifacts/contract-walkthrough` — product walkthrough video application.
- `artifacts/contract-workflow-video` — product workflow video application.
- `artifacts/mockup-sandbox` — visual design and component preview environment.

### Evaluation Material

The repository root contains:

- 11 representative contract PDFs;
- `ground_truth.json`;
- `ground_truth_verified_answers.xlsx`;
- extraction evaluation material;
- a recorded MVP video.

These are evaluation and demonstration assets, not the production database.

## 4. Authentication and Ownership

The application now uses Replit-managed Clerk authentication.

- Signed-in users access their own account-scoped contract data.
- The Clerk user ID currently acts as the account identifier.
- Contract, ingest, decision, and saved-view queries are scoped on the server.
- Test-only identity headers are permitted only when `NODE_ENV=test`.
- Administrator waste operations require an administrator role from Clerk metadata.
- Demo mode remains isolated and read-only.

Relevant configuration names include:

- `CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `VITE_CLERK_PUBLISHABLE_KEY`

Never commit or document the values of these variables.

### Current account-model limitation

The MVP uses a user-level account model. It does not yet provide a complete organization, team-membership, invitation, or role matrix.

## 5. PDF Upload, Extraction, and OCR

### Upload behavior

- Accepts PDF files.
- Supports multiple files in one batch.
- Current UI limit is 20 PDFs per batch.
- Current maximum is 10 MB per PDF.
- Invalid, encrypted, damaged, unsupported, and oversized files are rejected.
- Individual files can be removed before extraction.
- Failed items can be retried.
- Interrupted ingest runs can resume after refresh.

### Deduplication

- PDFs are deduplicated by SHA-256 file bytes.
- Filenames are not used as the deduplication identity.
- Deduplication is account-scoped.

### Extraction

- Embedded PDF text is extracted when available.
- Scanned pages use Poppler rendering followed by AI OCR.
- Extraction produces structured contract fields.
- Every field receives `High`, `Medium`, or `Low` confidence.
- Evidence includes source page and verbatim quote where available.
- Incomplete OCR is treated as a failure rather than accepted silently.

### Runtime requirements

PDF extraction requires:

- OpenAI integration configuration;
- `pdfinfo`;
- `pdftoppm`;
- `pdftocairo`;
- `qpdf` for malformed-PDF recovery;
- Replit object-storage access.

## 6. Contract Review and Data Rules

Users review extracted contract information before confirmation.

Core review principles:

- source evidence remains verbatim;
- only application interface copy is translated;
- human corrections do not overwrite extraction provenance;
- human resolution is stored separately from original extraction evidence;
- unknown contract values are allowed but stay visibly flagged in red;
- new contracts default to the uploader as owner;
- every uploaded document is managed as an independent contract record.

The intentionally limited MVP taxonomy contains four fixed contract categories.

Contract confirmation requires the core renewal information plus contractual timing and identity data needed for a reliable registry entry.

## 7. Deadlines and Alerts

Deadline calculations are performed server-side using Europe/Zurich calendar semantics.

The application calculates:

- contractual end or renewal date;
- legal notice deadline;
- internal action date;
- days remaining;
- green, amber, or red status;
- pending, due, or overdue alerts.

The negotiation buffer is additional internal runway before the legal notice deadline.

### Blocking rules

The system does not produce a misleading deadline when the underlying contract language is unreliable. Calculation is blocked for cases such as:

- unresolved conflicting notice clauses;
- ambiguous notice language;
- missing required dates or notice periods;
- indefinite or unsupported renewal structures;
- poor or incomplete source evidence;
- unsupported business-day clauses;
- “at any time” notice language.

Blocked and expired contracts do not create actionable alerts.

Alert dismissal survives only while the alert’s deadline and ownership inputs remain unchanged.

## 8. Registry, Search, and Saved Views

The Contract Registry supports:

- contract search;
- document-type filtering;
- shared URL query state;
- saved views;
- pinned view ordering;
- expanded evidence and confidence details;
- contract editing;
- contract decisions;
- per-row permanent deletion.

One known pending item is keeping controlled filters fully synchronized when users navigate with browser Back and Forward.

## 9. Localization and Swiss Defaults

Supported application languages:

- English;
- Swiss German interface locale (`de-CH`).

The selected language is persisted in browser storage.

Swiss defaults include:

- `dd.mm.yyyy` date presentation;
- CHF-first currency formatting;
- Europe/Zurich date calculations;
- Swiss-oriented sample data.

Contract evidence itself must not be translated or mutated.

## 10. Demo Mode

The application includes a read-only sample register available through demo mode.

- Demo data is isolated from customer data.
- Demo access does not permit upload, editing, deletion, decision changes, or saved-view mutations.
- The demo remains available in published builds until the real customer launch decision changes.

## 11. Contract Deletion and Waste

Deletion is intentionally irreversible for the structured contract record.

### Required deletion sequence

1. Serialize deletion for the contract.
2. Read the retained source PDF.
3. Copy it to a deterministic, collision-safe waste path.
4. Read the waste copy and verify its SHA-256 hash.
5. If verification fails, return an error and preserve the contract.
6. Clear stale legacy parent references.
7. Delete dependent decision and ingest-completion data.
8. Permanently delete the contract database record.
9. Queue removal of the original source object.
10. Retry original-object cleanup safely if the first attempt fails.

Concurrent requests are serialized so they cannot duplicate preservation work.

### Retention rule

- Waste PDFs remain indefinitely.
- There is no automatic waste expiration.
- Administrators can inspect and purge waste.
- Ordinary users cannot access administrator waste operations.
- There is no restore operation.

## 12. PostgreSQL and Object Storage

PostgreSQL stores:

- contracts and extracted JSON;
- confidence and provenance;
- ownership;
- decision history;
- saved and pinned views;
- resumable ingest runs and items;
- ingest completion and cleanup state;
- waste metadata and audit information.

Private object storage holds:

- uploaded source PDFs;
- retained waste PDFs.

### Important backup distinction

A GitHub backup includes program code and tracked evaluation assets. It does **not** automatically back up:

- PostgreSQL records;
- production object-storage PDFs;
- waste-storage files;
- Replit Secrets;
- Clerk tenant data;
- deployment configuration stored outside tracked files.

These operational data sources require separate export and recovery procedures.

## 13. API Development

The OpenAPI specification is the source of truth.

After changing `lib/api-spec/openapi.yaml`, regenerate clients with:

```bash
pnpm --filter @workspace/api-spec run codegen
```

Do not hand-maintain generated client and Zod declarations unless correcting a generator-only formatting issue.

## 14. Common Commands

Install dependencies:

```bash
pnpm install
```

Run the API:

```bash
pnpm --filter @workspace/api-server run dev
```

Run the dashboard:

```bash
pnpm --filter @workspace/contract-dashboard run dev
```

Run all type checks:

```bash
pnpm run typecheck
```

Run API tests:

```bash
pnpm --filter @workspace/api-server test
```

Run dashboard browser tests:

```bash
pnpm --filter @workspace/contract-dashboard test:e2e
```

Run production-oriented browser tests:

```bash
pnpm --filter @workspace/contract-dashboard test:e2e:production
```

Run the clean release build and artifact-path validation:

```bash
pnpm run build:clean
```

Apply the development database schema:

```bash
pnpm --filter @workspace/db run push
```

Production schema changes must follow the production database migration procedure rather than assuming a development schema push affects production.

## 15. Verification Completed During Development

The project has been repeatedly checked with:

- API unit and integration tests;
- focused Playwright browser tests;
- full TypeScript checks;
- OpenAPI code generation;
- clean monorepo builds;
- artifact base-path checks;
- running development previews;
- architecture review for destructive deletion.

For the original delete-to-waste implementation:

- 110 API tests passed;
- one intentional API test was skipped;
- the focused browser deletion flow passed;
- the clean monorepo build passed;
- the architecture review approved the corrected implementation.

Subsequent merged work added authentication, administrator waste management, deletion serialization, and cleanup-retry coverage. Run the current full test suite before a customer-facing release because these changes postdate the original validation snapshot.

## 16. Production Cleanup Result

A one-time production search was performed for:

- vendor names related to “Updated Regression Vendor”;
- contracts with contractual end date `31.12.2026`;
- broader normalized variants of those criteria.

No matching production records were found, so no production contracts were deleted during that cleanup.

Development and browser-test databases can contain regression fixtures with similar names. Those are not evidence of matching production records.

## 17. Linear and Project History

Key Linear work items included:

- **TEA-9** — LLM extraction with the provenance schema.
- **TEA-15** — extraction review, verification, assignment, and provenance.
- **TEA-17** — alert computation without scheduled sending.
- **TEA-23** — sample development register.
- **TEA-24** — Contract Registry columns, sorting, and status colours.
- **TEA-25** — source page, verbatim quote, and confidence display.
- **TEA-26** — deadline arithmetic, negotiation buffer, and alert colours.
- **TEA-27** — demo bulk load.
- **TEA-29** — multi-file upload, deduplication, and source abstraction.
- **TEA-31** — verified contract evaluation set.
- **TEA-33** — explanations for blocked or unresolvable contracts.
- **TEA-39** — persistent contracts across refresh.
- **TEA-40** — Swiss defaults and formatting.
- **TEA-41** — contract decision-first page design.
- **TEA-42** — conflicting and ambiguous notice-clause handling.
- **TEA-43** — recovery of readable vendor PDFs.
- **TEA-44 / Project Task #62** — permanent contract deletion with verified waste retention.

The later authentication, administrator waste-management, and deletion-resilience follow-ups were merged as project work. No matching Linear identifier was found for those project-generated follow-up titles at the time this handoff was prepared.

Two proposed project items remained visible:

- remove the dormant parent-agreement logic;
- keep shared filters correct with browser Back and Forward.

The source code and current tests are authoritative when old task descriptions conflict with merged behavior.

## 18. GitHub Backup Status

GitHub repository:

<https://github.com/rgeyer111/Contract_Dashboard_MVP>

Backup tag:

```text
contract-dashboard-mvp-test-2026-08-28
```

The tag is confirmed on GitHub and points to commit:

```text
af9a80bbf045f0df8aadf7124582485b340d9e41
```

At handoff preparation time:

- GitHub `main` pointed to `d33f145`;
- local Replit `main` pointed to the newer publish commit `e035182`;
- creating this document introduces an additional workspace change.

Therefore, push `main` again after committing this document if the GitHub repository should contain the latest publish commit and this handoff file.

Never use force push for this repository unless the divergent histories and data-loss consequences have been reviewed explicitly.

## 19. Current Limitations and Risks

### Product limitations

- No full organization or team-membership model.
- No invitation or account-transfer workflow.
- No restore from waste.
- No automatic waste expiration.
- No demonstrated scheduled email or notification-delivery worker.
- No local OCR fallback when AI extraction is unavailable.
- Browser Back/Forward filter synchronization remains pending.
- The dormant legacy parent field remains in the schema until explicitly removed.

### Operational dependencies

- PostgreSQL availability.
- Replit object storage and sidecar availability.
- Clerk configuration.
- AI integration availability.
- Poppler and qpdf system binaries.
- Correct artifact base paths and `/api` routing.

### Testing cautions

- Browser tests can leave development fixture contracts unless explicitly cleaned.
- OCR and AI extraction results can vary between model runs.
- Evaluation totals must be regenerated from each complete run.
- Production and development databases must not be confused.

## 20. Recommended Testing Plan

Before expanding the scope, test the current MVP with real user journeys:

1. Sign up and sign in with two separate users.
2. Confirm each user sees only their own contracts.
3. Upload embedded-text and scanned PDFs.
4. Test mixed valid and invalid multi-file batches.
5. Interrupt and resume an ingest run.
6. Confirm duplicate files are handled correctly.
7. Review High, Medium, and Low confidence fields.
8. Verify source pages and verbatim evidence.
9. Test ambiguous and conflicting notice clauses.
10. Confirm Swiss dates, currencies, and language switching.
11. Save, pin, reopen, and share registry views.
12. Test browser Back and Forward with active filters.
13. Record renewal decisions and verify history.
14. Delete a contract and verify it disappears for that account.
15. Verify an administrator can inspect and purge waste.
16. Verify a non-administrator cannot access waste.
17. Test demo mode and confirm it remains read-only.
18. Run the clean release build before publishing.

## 21. Suggested Next Decisions

After user testing, decide:

1. whether accounts should represent individuals or organizations;
2. how administrators are assigned and governed;
3. whether waste needs restoration or retention periods;
4. whether automated email/calendar notifications belong in the next release;
5. whether the dormant parent-agreement field should be removed;
6. how production database and object-storage backups will be performed;
7. which findings from user testing should become the next Linear issues.

## 22. Source of Truth

Use these sources in this order:

1. current source code and database schema;
2. automated tests;
3. OpenAPI specification;
4. this handoff document;
5. persistent project memory;
6. older task descriptions and chat summaries.

Older task files can describe planned behavior that was later changed or superseded.