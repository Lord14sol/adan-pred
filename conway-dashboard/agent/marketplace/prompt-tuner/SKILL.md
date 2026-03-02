---
name: prompt-tuner
displayName: Prompt Tuner
version: 0.1.0
description: Analyzes and optimizes an agent's SOUL.md for clarity, economy, and effectiveness.
category: meta-skill
priceCents: 50
priceUSDC: "0.50"
author: skill-vendor
tags:
  - prompt-engineering
  - optimization
  - soul
  - meta
---

# Prompt Tuner

You are now equipped with a prompt analysis and optimization skill. When asked to tune a prompt (or when you detect your own SOUL.md could be improved), follow this procedure.

## Analysis Phase

Read the target SOUL.md (or prompt document) and score it on five dimensions, each 1–10:

1. **Clarity** — Can the agent unambiguously understand what it should do? Are there contradictions or vague directives?
2. **Economy** — Does every sentence earn its place? Are there redundant instructions that burn tokens on every turn?
3. **Actionability** — Are the instructions concrete enough to act on, or do they require interpretation?
4. **Safety** — Are boundaries and constraints clearly stated? Could the prompt lead to unsafe behavior under edge cases?
5. **Adaptability** — Does the prompt allow the agent to learn and evolve, or is it rigidly prescriptive?

Output a score table:

```
| Dimension     | Score | Notes                        |
|---------------|-------|------------------------------|
| Clarity       | ?/10  | ...                          |
| Economy       | ?/10  | ...                          |
| Actionability | ?/10  | ...                          |
| Safety        | ?/10  | ...                          |
| Adaptability  | ?/10  | ...                          |
| **Overall**   | ?/10  |                              |
```

## Optimization Phase

Produce three outputs:

### 1. Revised Prompt

Rewrite the SOUL.md applying these principles:
- Remove redundant instructions (saves tokens per turn)
- Sharpen vague directives into concrete actions
- Add missing safety boundaries
- Preserve the agent's voice and identity
- Keep it under 80% of the original token count when possible

### 2. Changelog

List every change made and why:

```
- Removed: [what] — [why]
- Reworded: [what] — [why]
- Added: [what] — [why]
```

### 3. Estimated Savings

Calculate approximate token savings per turn:
- Original token count (estimate)
- Revised token count (estimate)
- Savings per turn
- Projected savings over 1,000 turns at current inference rates

## Usage

To invoke this skill, send your SOUL.md content and say: "Please tune this prompt."

The skill works on any prompt-style document, not just SOUL.md files. System prompts, genesis prompts, and task instructions all benefit from the same analysis.
