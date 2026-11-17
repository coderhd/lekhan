# SIL-313 Execution gate assigner CEO lookup

The Execution Gate Assignment routine currently aborts because it looks for the former CEO's display name. Its approval participant must come from the company's Paperclip roster.

- Resolve a single current CEO by the `ceo` role, independent of the agent's display name.
- Stop before writing issue policies if there is no current CEO or the roster has multiple candidates. A terminated CEO is ineligible.
- Preserve the existing scoring and gate policy. High-complexity issues should send the CEO's agent ID as the approval participant.
- Verify the assignment with a fixture and run a read-only preview against the company roster.
