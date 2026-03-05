# Security Risk Acceptance

Date: 2026-03-05

## Scope

This document records the security decisions and residual risk posture after hardening work on:

- Authentication and ERP proxy controls.
- Firestore authorization rules.
- Client-side security controls.
- Dependency vulnerability remediation.

## Actions Completed

1. Removed vulnerable spreadsheet and PDF libraries from runtime dependencies.
   - Removed: `xlsx`, `jspdf`, `jspdf-autotable`
   - Added/standardized safer alternatives already used in the codebase:
     - `exceljs` for Excel read/write workflows.
     - `pdf-lib` for PDF generation.

2. Refactored export and parsing services to use safe alternatives.
   - `src/services/excelMacroService.ts`
   - `src/services/excelPriorityService.ts`
   - `src/services/priorityExportService.ts`
   - `src/services/exports/unproductivityExportService.ts`
   - `src/services/vacationManagementExportService.ts`
   - `src/services/pdfExportService.ts`
   - `src/services/jobAuditExportService.ts`

3. Preserved previously applied application-layer controls.
   - Session hardening and Firebase token verification.
   - ERP proxy auth + path validation + CORS allowlist.
   - Firestore RBAC tightening.
   - Production safeguards for sensitive client config.

## Verification Evidence

- Root dependencies audit (`npm audit --omit=dev`): **0 vulnerabilities**
- Functions dependencies audit (`functions/npm audit --omit=dev`): **0 vulnerabilities**
- Frontend build (`npm run build`): **passes**
- Functions syntax check (`node --check functions/index.js`): **passes**

## Residual Risk Statement

At the time of this review, no known production dependency vulnerabilities are reported by npm audit.

Residual risk remains limited to:

- Future disclosures in third-party dependencies.
- Business logic regressions introduced by library migration.

These risks are accepted with the following controls in place:

- CI/CD build and audit checks before release.
- Controlled deployment workflow.
- Ongoing dependency monitoring and periodic re-audit.

## Acceptance

Risk owner acceptance is required before production release.

- Risk owner: __________________
- Date: __________________
- Decision: Accept / Reject
