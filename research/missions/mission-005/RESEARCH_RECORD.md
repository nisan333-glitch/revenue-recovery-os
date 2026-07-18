# Mission #005 — Research Record (human-readable; mirrors dataset.json)

> Same IDs as `research/exports/mission-005/dataset.json` (the join key). Verdict/confidence/type/status
> values are drawn **only** from the frozen NH-ROP controlled vocabularies. As-of 2026-07-18.

## Claims
| ID | Statement | Type | Verdict | Confidence | Scope | Supporting |
|---|---|---|---|---|---|---|
| M005-C1 | On OLED/AMOLED displays, dark mode reduces display power (black pixels emit ~no light). | Technical | Supported | High | OLED/AMOLED phones | E1, E2 |
| M005-C2 | At ~100% brightness, dark mode saves ~39–47% of OLED display power (tested phones). | Performance | Supported | Moderate | OLED @100%; Purdue set | C2-E1 |
| M005-C3 | At ~30–50% brightness, dark mode saves only ~3–9% of OLED display power. | Performance | Supported | Moderate | OLED @30–50%; Purdue set | C3-E1 |
| M005-C4 | On LCD displays, dark mode yields negligible savings (backlight always on). | Comparative | Supported | Moderate | LCD phones | C4-E1 |
| M005-C5 | The unqualified "dark mode saves battery" is over-general. | Universal | Partially Supported | High | the universal claim | C5-E1 |
| M005-C6 | Some vendor/popular framing presents dark mode as a broad battery saver, conditions omitted. | Adoption | Supported | Moderate | vendor/popular comms | C6-E1 |
| M005-C7 | Dark mode meaningfully extends whole-device runtime under typical use. | Performance | Inconclusive | Low | whole-device runtime | — |

## Evidence
| ID | Claim | Source | Finding (short) | Direction | Verification | Lineage | Strength |
|---|---|---|---|---|---|---|---|
| M005-C1-E1 | C1 | S001 | OLED dark mode reduces display power (brightness-dependent) | Supports | Partially-Verified | L01 | Strong |
| M005-C1-E2 | C1 | S003 | vendor: dark theme saves power on OLED | Supports | Vendor-Claim | L02 | Moderate |
| M005-C2-E1 | C2 | S001 | 100% brightness → 39–47% saving | Supports | Partially-Verified | L01 | Strong |
| M005-C3-E1 | C3 | S001 | 30–50% brightness → 3–9% saving | Supports | Partially-Verified | L01 | Strong |
| M005-C4-E1 | C4 | S004 | LCD backlight always on → negligible | Supports | Partially-Verified | L03 | Moderate |
| M005-C5-E1 | C5 | S001 | savings conditional on OLED + high brightness | Supports | Partially-Verified | L01 | Strong |
| M005-C6-E1 | C6 | S003 | vendor/popular framing omits conditions | Supports | Vendor-Claim | L02 | Limited |

## Sources (lineage)
| ID | Title | Type | Primary? | Lineage | Note |
|---|---|---|---|---|---|
| S001 | Purdue 2021 dark-mode OLED measurement (news release) | Independent-technical-test-or-audit | Primary | L01 | secondary access; primary paper not fetched |
| S003 | Google/Android dark-theme guidance | Company-documentation | Primary | L02 | vendor framing |
| S004 | Tech explainer: LCD backlight vs OLED | Journalism | Secondary | L03 | corroborated physics |

*(S001, C2-E1, C3-E1, C5-E1 share lineage **L01** — one Purdue origin — so they are **one** confirmation, not
several; only C1 draws on two lineages, L01 + L02.)*

## Assumptions
| ID | Statement | Risk if false | Status | Affects |
|---|---|---|---|---|
| M005-A1 | 2021 OLED measurements generalize to current mainstream OLED phones. | Moderate | Accepted-risk | C2, C3 |

## Unknowns
| ID | Open question | Blocks decision? | Status | Affects |
|---|---|---|---|---|
| M005-U1 | Whole-device runtime effect (vs display-only power) under typical use? | No | Isolated | C7 |

## Contradictions
| ID | In conflict | Nature | Resolution |
|---|---|---|---|
| M005-X1 | C6 ↔ C2 | popular/vendor universal framing vs measured brightness-conditional magnitude | Scope-qualified (OLED + brightness) → supports C5 |

## Verdicts
One `verdict` object per claim in `dataset.json` (status/confidence mirror the claim; `outcome_ladder_classification` = N/A — no revenue claim). Founder = author-reviewer (L2).

## Findings (plain language)
Dark mode's battery benefit is **real but conditional**: material on **OLED at high brightness** (~39–47%),
**small at typical indoor brightness** (~3–9%), and **negligible on LCD**. The unqualified "dark mode saves
battery" is therefore over-general (C5). Whole-device runtime effect under typical use is **not established**
(C7, Inconclusive; U1). This is a pilot record, not an NH position.
