# Repository rules

Use `.agents/skills/metro-repo/SKILL.md` to route work to the owning game, test,
unity, web or model skill. For live Unity Editor C# and scene checks, use
`unity/scripts/metro-editor.ps1` (see
[the live-editor workflow](unity/plan/12-live-editor-workflow.md)); keep WebGL
builds and isolated batches in `unity/scripts/metro-unity.ps1`. The
[performance reference](.agents/skills/metro-repo/references/performance.md) is
the measured-state record for performance investigations. When a task actually
addresses performance, measure the reported interaction and record relevant,
reproducible performance findings there. Functional fixes and incidental test or
loading timings do not require an entry. Keep deterministic regressions, resolve
one scene pick per event, and keep preview work separate from document commits.
