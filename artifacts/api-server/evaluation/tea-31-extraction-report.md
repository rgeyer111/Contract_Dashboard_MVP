# TEA-31 contract extraction evaluation

Initial run date: 27 August 2026

TEA-42 rerun date: 28 August 2026

## Validation set

- Source: `rgeyer111/Contract_Dashboard_MVP`
- 11 real-format vendor contract PDFs
- Languages: German and English
- Includes an auto-renewing contract, quarter-end language, one scanned PDF, and an agreement/amendment pair
- Human-verified answers: `ground_truth.json` and `ground_truth_verified_answers.xlsx`
- Ground-truth fields checked per document: 17

The source PDFs and verified-answer files were read from the public GitHub repository for this evaluation. They are intentionally not copied into this workspace.

## Method

Each PDF was processed through the application's current extraction implementation. PDFs with a text layer used embedded-text extraction. The scan used the production OCR path before structured extraction. The TEA-42 rerun used extraction prompt `provenance-v4`.

For every field, the run compared:

1. expected extraction status (`found`, `not_found`, `ambiguous`, or `conflicting`);
2. normalized structured value when the ground truth expected a value.

This is intentionally conservative. Semantically close values such as `12 months` versus `1 year`, `null` versus an empty CC list, or an expanded title versus the shorter verified title are listed as disagreements. Accepted schema representations are also compared literally, so a singleton notice array versus one notice object remains listed even when the status and typed notice are equivalent.

## Result

- Documents processed: **11 / 11**
- Field checks: **187**
- Exact agreements: **150**
- Exact agreement rate: **80.2%**
- Disagreements: **37**
- OCR document: **13 / 17** exact agreements
- Renewal-safety status checks fixed by TEA-42: **2 / 2**

## Exact agreement by document

| ID | Language | Difficulty | Source | Exact fields |
| --- | --- | --- | --- | ---: |
| D01 | German | Medium | Text | 14 / 17 |
| D02 | German | Medium | Text | 15 / 17 |
| D03 | English | Clean | Text | 13 / 17 |
| D04 | German | Medium | Text | 13 / 17 |
| D05 | English | Hard | Text | 15 / 17 |
| D06 | English | Medium | Text | 15 / 17 |
| D07 | German | Hard | OCR | 13 / 17 |
| D08 | German | Clean | Text | 13 / 17 |
| D09 | German | Hard | Text | 11 / 17 |
| D10 | English | Hard | Text | 14 / 17 |
| D11 | German | Clean | Text | 14 / 17 |

## Disagreements by field

| Field | Count |
| --- | ---: |
| Notice delivery | 10 |
| Notice period | 8 |
| Contract title | 7 |
| Contract type | 3 |
| Document type | 2 |
| Initial term length | 2 |
| Renewal term length | 2 |
| Contract value | 2 |
| Billing frequency | 1 |

The complete expected-versus-actual disagreement list is in `tea-31-disagreements.csv`.

## TEA-42 renewal-safety result

- D05 now returns **conflicting**, preserves both the three-month body clause and six-month annex clause with page, clause, and verbatim quote evidence, and blocks deadline computation with `TIMING_VALUES_CONFLICT`.
- D09 now returns **ambiguous**, preserves the literal `30 business_days` notice without converting it to calendar days, and blocks deadline computation with `NOTICE_TIMING_AMBIGUOUS`.
- These two rows remain in the conservative disagreement CSV only for non-safety representation differences: D05's verified value carries ground-truth-only `source` properties, and D09 uses a singleton array where the API returned the equivalent single notice object. Their expected and actual safety statuses now agree.

## Remaining findings

- D10 still omitted a verified variable contract value.
- D03 was still classified as an order form instead of a master agreement.
- Notice delivery remains the largest error cluster: ten documents had missing, incomplete, or structurally different delivery details.
- The full-run exact score changed from 81.8% to 80.2% because generative extraction varied in unrelated fields. TEA-42 fixes the two targeted renewal-safety failures; it does not establish deterministic extraction across the other fields.

## Interpretation

The extraction pipeline successfully processed the complete set, including OCR. TEA-42 removed both targeted silent deadline gaps, and the application now blocks rather than calculates when it sees competing clauses or literal business-day wording. The 80.2% conservative exact agreement rate still shows that extraction is not production-reliable without human review. Notice delivery remains the largest error cluster and is tracked separately.