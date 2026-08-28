# TEA-31 contract extraction evaluation

Run date: 27 August 2026

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

This is intentionally conservative. Semantically close values such as `12 months` versus `1 year`, `null` versus an empty CC list, or an expanded title versus the shorter verified title are listed as disagreements.

## Result

- Documents processed: **11 / 11**
- Field checks: **187**
- Exact agreements: **153**
- Exact agreement rate: **81.8%**
- Disagreements: **34**
- OCR document: **14 / 17** exact agreements

## Exact agreement by document

| ID | Language | Difficulty | Source | Exact fields |
| --- | --- | --- | --- | ---: |
| D01 | German | Medium | Text | 14 / 17 |
| D02 | German | Medium | Text | 14 / 17 |
| D03 | English | Clean | Text | 15 / 17 |
| D04 | German | Medium | Text | 13 / 17 |
| D05 | English | Hard | Text | 15 / 17 |
| D06 | English | Medium | Text | 16 / 17 |
| D07 | German | Hard | OCR | 14 / 17 |
| D08 | German | Clean | Text | 15 / 17 |
| D09 | German | Hard | Text | 10 / 17 |
| D10 | English | Hard | Text | 14 / 17 |
| D11 | German | Clean | Text | 13 / 17 |

## Disagreements by field

| Field | Count |
| --- | ---: |
| Notice delivery | 9 |
| Contract title | 6 |
| Notice period | 5 |
| Contract type | 3 |
| Contract value | 2 |
| Document type | 2 |
| Initial term length | 2 |
| Renewal term length | 2 |
| Billing frequency | 1 |
| Contract number | 1 |
| Signature date | 1 |

The complete expected-versus-actual disagreement list is in `tea-31-disagreements.csv`.

## Highest-risk findings

- D05 expected a **conflicting** notice period but extraction returned `not_found`, losing both competing notice clauses.
- D09 expected an **ambiguous** notice period but extraction returned `not_found`.
- D10 omitted a verified variable contract value.
- D02 inferred annual billing even though the amendment itself did not state billing frequency, and missed the verified amendment contract number.
- D03 was classified as an order form instead of a master agreement.
- Notice delivery was the largest error cluster: nine documents had missing, incomplete, or structurally different delivery details.

## Interpretation

The extraction pipeline successfully processed the complete set, including OCR, but the 81.8% exact agreement rate shows that extraction accuracy is not yet production-reliable without human review. Notice handling is the highest-priority improvement area because missed conflicts and ambiguities can directly produce unsafe deadline assumptions.