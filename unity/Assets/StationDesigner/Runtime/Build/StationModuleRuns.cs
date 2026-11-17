using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// One placement run's verdict: the panels the release will lay and the cells it refuses.
    /// It is what a 围栏 / 盲道 / floor-mark drag previews and what its release commits, so the
    /// ghost and the commit cannot disagree (plan 27 §5).
    /// </summary>
    public sealed class StationModuleRunPlan {
        /// <summary>The candidates the release will place, in run order.</summary>
        public readonly List<StationEditDraft> Accepted = new List<StationEditDraft>();
        /// <summary>The cells a run candidate occupies, parallel to <see cref="Accepted"/>.</summary>
        public readonly List<StationCellKey> AcceptedCells = new List<StationCellKey>();
        /// <summary>The cells the run refuses, for the red boxes.</summary>
        public readonly List<StationCellKey> Blocked = new List<StationCellKey>();
        /// <summary>Placed pieces standing in the way, boxed in red beside the refusal.</summary>
        public readonly List<string> ColliderIds = new List<string>();
        /// <summary>The first refusal's code, for a notice line.</summary>
        public string Reason = "";
        /// <summary>`add` for a fresh run, `remove` for the erase direction.</summary>
        public string Kind = "add";
        /// <summary>Modules the run would remove (an erase drag lifts same-type panels).</summary>
        public readonly List<string> RemoveIds = new List<string>();

        public bool HasWork => Accepted.Count > 0 || RemoveIds.Count > 0;
        public bool Ok => Accepted.Count > 0 && Blocked.Count == 0;
    }

    /// <summary>
    /// The catalogue's **run** tools (plan 27 §5): a dragged line of one family rather than one
    /// piece per press. Ported from `EquipmentTool.ts`'s `beginLineAdd` / `lineCandidates` /
    /// `lineAccepted` / `finishLine` and `beginLineRemove` for the families the C# resolver can
    /// already build — a 围栏 panel, a 盲道 tile and a floor mark.
    ///
    /// The run is a **straight axis-aligned line** along the drag's dominant axis (the same rule
    /// the 墙 tool uses), because a fence or a tactile path is laid cell by cell and a diagonal
    /// run would leave the panels unjoined. Each cell is resolved by the one candidate resolver,
    /// so a panel that meets a 闸机 or a reserved opening is refused by the same rules a single
    /// placement is.
    /// </summary>
    public static class StationModuleRuns {
        /// <summary>The families a drag lays as a run (the rest stay press-to-place).</summary>
        static readonly HashSet<string> LineFamilies = new HashSet<string>(StringComparer.Ordinal) {
            "fence", "tactile", "floor-mark",
        };

        /// <summary>True when this module type is laid as a dragged run.</summary>
        public static bool IsLineType(string type) => !string.IsNullOrEmpty(type) && LineFamilies.Contains(type);

        /// <summary>
        /// True when the armed palette id is a run family. The palette id is what the shell sends
        /// (`tool.set.settings.moduleType`), so this is the one question the gesture needs before
        /// there is a candidate.
        /// </summary>
        public static bool IsLinePalette(string paletteId) =>
            StationModuleFamilies.TryParse(paletteId ?? "", "", 0, out var family) && IsLineType(family.Type);

        /// <summary>The straight run through two cells, along the drag's dominant axis.</summary>
        public static List<StationCellKey> LineCells(StationCellKey anchor, StationCellKey target, int z) =>
            StationCellPlanner.StraightLineCells(new StationCellKey(anchor.X, anchor.Y, z),
                new StationCellKey(target.X, target.Y, z), z);

        /// <summary>The whole 10,000-cell budget, shared with the block brush.</summary>
        public const int MaxRunCells = StationCellPlanner.MaxDragCells;

        /// <summary>
        /// Resolve one run: every cell of the line through the one candidate resolver, keeping
        /// the accepted drafts (with unique ids) and the refused cells. `template` carries the
        /// tool's settings; its `Hit` is replaced per cell.
        /// </summary>
        public static StationModuleRunPlan PlanAdd(StationIndex index, StationPlacementRequest template,
            StationModuleRecord carried, IReadOnlyList<StationCellKey> cells, bool remove) {
            var plan = new StationModuleRunPlan { Kind = remove ? "remove" : "add" };
            if (index == null || template == null) { plan.Reason = "no-document"; return plan; }
            if (cells == null || cells.Count == 0) { plan.Reason = "no-cells"; return plan; }
            if (cells.Count > MaxRunCells) { plan.Reason = "over-limit"; return plan; }
            if (remove) {
                RemoveRun(index, plan, template, cells);
                return plan;
            }
            var taken = new HashSet<string>(StringComparer.Ordinal);
            int next = index.Document.ModuleCount + 1;
            foreach (var cell in cells) {
                var request = CloneForCell(template, cell);
                request.Id = NextRunId(index, template.ToolType, ref next, taken);
                var placement = StationModulePlacement.Resolve(index, request);
                if (placement.Candidate == null) {
                    plan.Blocked.Add(cell);
                    if (plan.Reason.Length == 0) plan.Reason = placement.Reason;
                    continue;
                }
                if (!placement.Ok) {
                    plan.Blocked.Add(cell);
                    if (plan.Reason.Length == 0) plan.Reason = placement.Reason;
                    foreach (var id in placement.ColliderIds)
                        if (!plan.ColliderIds.Contains(id)) plan.ColliderIds.Add(id);
                    continue;
                }
                // The batch allocates its own ids: the committed index does not yet hold the
                // pieces this run is about to add, so `NextId` alone would collide inside it.
                placement.Candidate.Id = request.Id;
                plan.Accepted.Add(placement.Candidate);
                plan.AcceptedCells.Add(cell);
            }
            return plan;
        }

        /// <summary>
        /// The erase direction: lift the same family's placed pieces along the run, one per cell.
        /// The pieces are found by their authored anchor (a panel is one cell), so a drag lifts
        /// exactly the run it was laid as.
        /// </summary>
        static void RemoveRun(StationIndex index, StationModuleRunPlan plan, StationPlacementRequest template,
            IReadOnlyList<StationCellKey> cells) {
            string type = template.ToolType;
            string variant = "";
            // The palette id names a variant; the placed record is the same type at that cell.
            if (StationModuleFamilies.TryParse(template.ToolType ?? "", template.Variant ?? "", template.Width,
                out var family)) {
                type = family.Type;
                variant = family.Variant ?? "";
                if (type == "tactile" && variant.Length == 0) variant = "guide";
                if (type == "floor-mark" && variant.Length == 0) variant = "boarding";
            }
            foreach (var cell in cells) {
                bool found = false;
                foreach (var module in index.Document.Modules) {
                    if (!string.Equals(module.Type, type, StringComparison.Ordinal)) continue;
                    if (module.X != cell.X || module.Y != cell.Y || module.Z != cell.Z) continue;
                    // One run lifts its own variant only: a warning strip beside a guide path is
                    // not what the player dragged over (`TactileTool`'s erase).
                    if (variant.Length > 0) {
                        var placed = module.Config.Text("variant");
                        if (placed.Length == 0) placed = type == "tactile" ? "guide" : type == "floor-mark" ? "boarding" : "";
                        if (!string.Equals(placed, variant, StringComparison.Ordinal)) continue;
                    }
                    found = true;
                    if (!plan.RemoveIds.Contains(module.Id)) plan.RemoveIds.Add(module.Id);
                }
                if (found) plan.AcceptedCells.Add(cell);
                else plan.Blocked.Add(cell);
            }
        }

        /// <summary>The patch a run's release commits: its drafts, or the pieces it lifts.</summary>
        public static StationCellPatch ToPatch(StationModuleRunPlan plan) {
            var patch = new StationCellPatch();
            if (plan == null) return patch;
            foreach (var draft in plan.Accepted) patch.AddModule(draft);
            foreach (var id in plan.RemoveIds) {
                if (patch.RemoveModuleIds.Contains(id)) continue;
                patch.RemoveModuleIds.Add(id);
                patch.Changed++;
            }
            foreach (var id in plan.ColliderIds) patch.Unverified.Add(id);
            return patch;
        }

        /// <summary>The plan's cells as a block-style check, so the ghost draws the same boxes.</summary>
        public static StationCellCheck ToCheck(StationModuleRunPlan plan) {
            var check = new StationCellCheck();
            if (plan == null) return check;
            check.Accepted.AddRange(plan.AcceptedCells);
            check.Blocked.AddRange(plan.Blocked);
            foreach (var cell in plan.AcceptedCells) check.Cells.Add(cell);
            foreach (var cell in plan.Blocked) check.Cells.Add(cell);
            check.ColliderIds.AddRange(plan.ColliderIds);
            check.Reason = plan.Reason;
            return check;
        }

        static StationPlacementRequest CloneForCell(StationPlacementRequest template, StationCellKey cell) {
            var point = new StationPoint(cell.X + 0.5, cell.Y + 0.5, cell.Z + 1);
            return new StationPlacementRequest {
                ToolType = template.ToolType,
                Variant = template.Variant,
                Rotation = template.Rotation,
                Width = template.Width,
                LineId = template.LineId,
                RunLength = template.RunLength,
                RunRise = template.RunRise,
                CurtainHeight = template.CurtainHeight,
                TargetModuleId = "",
                ModulePoint = point,
                // A run cell is the **air** the panel goes into, and the resolver reads a placement
                // hit the way the picker hands it over: the block under the piece (`Cell`) plus the
                // cell it steps into (`Place`). The run families are all floor-standing, so the
                // block below the run cell is the floor the panel stands on.
                Hit = new StationPlacementHit(cell.X, cell.Y, cell.Z - 1, cell.X, cell.Y, cell.Z, true,
                    point, cell.Z, new StationPoint(0, 0, 1)),
            };
        }

        static string NextRunId(StationIndex index, string paletteId, ref int next, HashSet<string> taken) {
            string type = paletteId ?? "piece";
            if (StationModuleFamilies.TryParse(paletteId ?? "", "", 0, out var family) && family.Type.Length > 0)
                type = family.Type;
            while (true) {
                var id = type + "-" + next;
                next++;
                if (index.GetModule(id) != null) continue;
                if (!taken.Add(id)) continue;
                return id;
            }
        }
    }
}
