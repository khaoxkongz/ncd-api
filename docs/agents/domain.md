# Domain Docs

This repo uses a single-context layout: `GLOSSARY.md` at the repo root and architecture decision records under `docs/adr/`.

## Before exploring the codebase

1. Read the root `GLOSSARY.md` if it exists.
2. Read ADRs in `docs/adr/` that concern the area being explored.

If a domain document is absent, proceed silently. The `/domain-modeling` skill creates glossary entries and ADRs as terms and decisions are resolved.

## File structure

```text
/
├── GLOSSARY.md
├── docs/adr/
│   └── 0001-<decision-slug>.md
└── src/
```

## Use the glossary's vocabulary

Use the glossary's defined terms in issue titles, proposals, hypotheses, and test names. Follow its preferred terms rather than synonyms it explicitly avoids.

If a needed concept is absent, check whether the codebase already names it. Record a real terminology gap for `/domain-modeling`.

## Flag ADR conflicts

When a proposal contradicts an existing ADR, identify the ADR and explain why its decision should be reconsidered.
