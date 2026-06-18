# Comparisons

Data-backed comparisons that are too large or too detailed to live inline in an ADR. An ADR
should link here when it needs a deep evaluation (benchmarks, cost models, library matrices,
model evals) to justify its decision.

Keep comparisons **data-backed**: numbers, sources, dates. State the criteria up front and
weight them by the requirement they serve.

## Index

_None yet. The initial stack comparisons (backend framework, frontend, LLM, storage,
integration surface) were small enough to live inline in [ADR-0002](../decisions/0002-tech-stack.md)._

## Template

```markdown
# Comparison: <topic>

- **For ADR:** ADR-NNNN
- **Date:** YYYY-MM-DD
- **Decision criteria (weighted by requirement):** ...

| Candidate | Criterion 1 | Criterion 2 | ... | Score |
|-----------|-------------|-------------|-----|-------|

## Sources
- links / benchmarks / dates

## Conclusion
What the data says, and the recommendation passed back to the ADR.
```
