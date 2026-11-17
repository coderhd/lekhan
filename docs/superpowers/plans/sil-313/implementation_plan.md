# SIL-313 Implementation plan

1. Exercise the assigner's normal entry point with a fixture containing the current CEO, the former display name on another role, and a terminated CEO. Check the approval participant in the policy payload.
2. Verify that missing and ambiguous CEO rosters stop before any policy writes. Resolve the CEO from the company roster and rerun the fixture.
3. Run the live dry-run and repository verification, then obtain clean-room and external review before merging.
