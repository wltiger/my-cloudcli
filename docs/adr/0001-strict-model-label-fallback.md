# Strict pattern match for model label prettification, not fuzzy substring matching

When a raw model id doesn't exactly match CloudCLI's hardcoded model catalog (e.g. a model set via the Claude Code CLI's own session, not CloudCLI's own switcher), the model selector prettifies it into a short label only when the id matches a recognizable Claude model-id shape (family + optional version + optional trailing date). An id that doesn't match is left as the raw string, not guessed at.

**Considered Options**: fuzzy/substring matching against the existing alias catalog (e.g. "contains `sonnet` → label `Sonnet`") — simpler, but can silently collapse meaningfully different models (a future major version, a different family sharing a substring) into the same short label, hiding real differences from the user. Strict pattern match with raw-string fallback was chosen instead — it only prettifies ids it can confidently parse.
