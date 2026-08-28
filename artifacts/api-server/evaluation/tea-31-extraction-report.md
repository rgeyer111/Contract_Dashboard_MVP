# TEA-31 contract extraction evaluation

Run date: 28 August 2026

## Validation set

- Source: `rgeyer111/Contract_Dashboard_MVP`
- 11 real-format vendor contract PDFs
- Languages: German and English
- Includes an auto-renewing contract, quarter-end language, one scanned PDF, and an agreement/amendment pair
- Human-verified answers: `ground_truth.json` and `ground_truth_verified_answers.xlsx`
- Ground-truth fields checked per document: 17

The source PDFs and verified-answer files were read from the public GitHub repository for this evaluation. They are intentionally not copied into this workspace.

## Method

Each PDF was processed through the application's current extraction implementation. PDFs with a text layer used embedded-text extraction. The scan used the production OCR path before structured extraction.

For every field, the run compared:

1. expected extraction status (`found`, `not_found`, `ambiguous`, or `conflicting`);
2. normalized structured value when the ground truth expected a value.

This is intentionally conservative. Semantically close values such as `12 months` versus `1 year`, an address with an additional country suffix, or an expanded title versus the shorter verified title are listed as disagreements. Optional notice CC values are normalized to the application schema before comparison: missing, null, and empty values all become `[]`, while a single CC string becomes a one-item array. Ambiguous and conflicting notice-period results count as exact only when every expected typed candidate has positive-page, verbatim evidence in the source text.

## Result

- Documents processed: **11 / 11**
- Field checks: **187**
- Exact agreements: **154**
- Exact agreement rate: **82.4%**
- Disagreements: **33**
- OCR document: **13 / 17** exact agreements

## Exact agreement by document

| ID | Language | Difficulty | Source | Exact fields |
| --- | --- | --- | --- | ---: |
| D01 | German | Medium | Text | 15 / 17 |
| D02 | German | Medium | Text | 15 / 17 |
| D03 | English | Clean | Text | 15 / 17 |
| D04 | German | Medium | Text | 14 / 17 |
| D05 | English | Hard | Text | 13 / 17 |
| D06 | English | Medium | Text | 14 / 17 |
| D07 | German | Hard | OCR | 13 / 17 |
| D08 | German | Clean | Text | 16 / 17 |
| D09 | German | Hard | Text | 11 / 17 |
| D10 | English | Hard | Text | 14 / 17 |
| D11 | German | Clean | Text | 14 / 17 |

## Disagreements by field

| Field | Count |
| --- | ---: |
| Contract title | 8 |
| Notice delivery | 6 |
| Notice period | 5 |
| Contract type | 3 |
| Contract value | 2 |
| Document type | 2 |
| Initial term length | 2 |
| Renewal term length | 2 |
| Billing frequency | 1 |
| Effective date | 1 |
| Vendor legal name | 1 |

The complete expected-versus-actual disagreement list is in `tea-31-disagreements.csv`.

## Notice-delivery result

Strict notice-delivery disagreements fell from **9 to 6**. More importantly for operational reliability, missing or unresolved delivery destinations fell from **6 to 0**. The run resolved referenced header addresses, retained required email/post copy destinations, and normalized empty CC values. Resolved mismatches retain operational destinations but differ from the strict ground-truth representation through formatting, country suffixes, or reference expansion. D05 resolves the generic registered-office copy reference to the recipient's full postal address.

## High-risk notice-period findings

- **Unresolved:** D05 must return `conflicting` with both candidate periods and source-backed alternatives.
- **Unresolved:** D09 must return `ambiguous` with the business-day period and source-backed evidence.

## Interpretation

The extraction pipeline successfully processed the complete set, including OCR. The focused notice-delivery recovery materially improved the highest-risk operational field, while the **82.4%** overall exact agreement rate still shows that extraction needs human review.
