# Repository rules

Use `.agents/skills/metro-repo/SKILL.md` to route work to the owning game, test,
web or model skill.

For performance changes, read
`.agents/skills/metro-repo/references/performance.md`. Measure the reported user
interaction, including its first invocation, and preserve a deterministic regression
for the work that caused the stall. Keep measured results in `game/PERFORMANCE.md`
and raw profiles/reports in ignored `.preview/perf/`.

Pointer handlers must resolve scene picks once per event and reuse the result.
Do not invoke a scene raycast inside a document search predicate. Keep preview
work separate from document commits and simulation routing rebuilds; preserve
the owning tool's placement/refusal contract when deferring work.
