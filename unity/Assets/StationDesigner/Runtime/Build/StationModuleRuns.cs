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
        /// <summary>Effective quarter-turn applied to candidates in this run.</summary>
        public int EffectiveRotation;
        /// <summary>Effective anchor pitch in whole cells (`span + lineSpacing`).</summary>
        public int Step = 1;

        public bool HasWork => Accepted.Count > 0 || RemoveIds.Count > 0;
        public bool Ok => Accepted.Count > 0 && Blocked.Count == 0;
    }

    /// <summary>
    /// The catalogue's **run** tools (plan 27 §5, plan 37 §5.4): a dragged line of one family
    /// rather than one piece per press, consuming the rail's <c>lineSpacing</c> (0..6 empty blocks
    /// between pieces) with the Web <c>linePlacement.ts</c> pitch and axis rules.
    ///
    /// Preview, release, and matching erase all share <see cref="RunSlots"/> so a nonzero gap
    /// yields the exact same anchor cells across all three gestures and commits as one undoable
    /// operation.
    /// </summary>
    public static class StationModuleRuns {
        /// <summary>Maximum allowed empty-block gap (`sim/lineSpacing.ts`: 0..6).</summary>
        public const int MaxLineSpacing = 6;
        /// <summary>`sim/tvs.ts:TV_MODEL_WIDTH`: drawn width of a ceiling TV in metres.</summary>
        public const double TvModelWidth = 1.56;

        /// <summary>The families whose canvas gesture lays a dragged run.</summary>
        static readonly HashSet<string> LineFamilies = new HashSet<string>(StringComparer.Ordinal) {
            "fence", "tactile", "floor-mark",
        };

        /// <summary>Palette IDs excluded from `lineSpacing` (`catalog.ts:LINE_PLACEMENT_EXCLUDED`).</summary>
        static readonly HashSet<string> SpacingExcluded = new HashSet<string>(StringComparer.Ordinal) {
            "road", "bridge", "track", "lift", "sidewalk", "lawn", "psd-end-cover",
        };

        /// <summary>Clamp a raw <c>lineSpacing</c> setting onto the 0..6 ladder (`sim/lineSpacing.ts`).</summary>
        public static int ClampSpacing(int value) => value < 0 ? 0 : value > MaxLineSpacing ? MaxLineSpacing : value;

        /// <summary>True when this module type is laid as a dragged run.</summary>
        public static bool IsLineType(string type) => !string.IsNullOrEmpty(type) && LineFamilies.Contains(type);

        /// <summary>
        /// True when the armed palette id is a run family. The palette id is what the shell sends
        /// (`tool.set.settings.moduleType`), so this is the one question the gesture needs before
        /// there is a candidate.
        /// </summary>
        public static bool IsLinePalette(string paletteId) {
            if (string.IsNullOrEmpty(paletteId)) return false;
            if (string.Equals(paletteId, "court-divider", StringComparison.Ordinal)) return true;
            return StationModuleFamilies.TryParse(paletteId, "", 0, out var family) && IsLineType(family.Type);
        }

        /// <summary>
        /// True when a palette id accepts the <c>lineSpacing</c> setting (`catalog.ts:supportsLinePlacement`).
        /// Tactile paths, ramps, lifts, roofs, exits, roads, tracks, and outdoor surface tiles stay
        /// unspaced (step 1 or their own gesture).
        /// </summary>
        public static bool SupportsLineSpacing(string paletteId) {
            if (string.IsNullOrEmpty(paletteId)) return false;
            if (string.Equals(paletteId, "court-divider", StringComparison.Ordinal)) return true;
            if (paletteId == "fence" || paletteId.StartsWith("fence-", StringComparison.Ordinal) ||
                paletteId == "noise-barrier" || paletteId.StartsWith("noise-barrier-", StringComparison.Ordinal)) return true;
            if (SpacingExcluded.Contains(paletteId)) return false;
            if (paletteId == "stair" || paletteId.StartsWith("stair-", StringComparison.Ordinal)) return false;
            if (paletteId == "escalator" || paletteId == "walkway") return false;
            if (paletteId == "exit" || paletteId.StartsWith("exit-", StringComparison.Ordinal)) return false;
            if (paletteId == "roof" || paletteId.StartsWith("roof-", StringComparison.Ordinal)) return false;
            if (paletteId == "tactile" || paletteId.StartsWith("tactile-", StringComparison.Ordinal)) return false;
            return true;
        }

        /// <summary>Dominant drag axis: 0 = X (east–west, ties go X), 1 = Y (north–south).</summary>
        public static int LineAxis(StationCellKey a, StationCellKey b) =>
            Math.Abs(b.X - a.X) >= Math.Abs(b.Y - a.Y) ? 0 : 1;

        /// <summary>
        /// Whole-cell footprint span of a draft along <paramref name="axis"/> (`linePlacement.ts:lineSpan`).
        /// </summary>
        public static int LineSpan(StationEditDraft draft, int axis) {
            if (draft == null) return 1;
            int min = int.MaxValue;
            int max = int.MinValue;
            void Add(int v) {
                if (v < min) min = v;
                if (v > max) max = v;
            }
            var cells = StationFootprints.Footprint(StationModulePlacement.ToRecord(draft));
            for (int i = 0; i < cells.Length; i++) Add(axis == 0 ? (int)Math.Round(cells[i].X) : (int)Math.Round(cells[i].Y));
            double extraWidth = string.Equals(draft.Type, "tv", StringComparison.Ordinal) ? TvModelWidth : 0;
            if (extraWidth > 1) {
                StationFootprints.RotateLocal(draft.Rotation, 1, 0, out var dx, out var dy);
                double along = axis == 0 ? dx : dy;
                if (Math.Abs(along) > 1e-6) {
                    int origin = axis == 0 ? draft.X : draft.Y;
                    Add(origin);
                    Add(origin + (int)Math.Ceiling(extraWidth - 1e-6) - 1);
                }
            }
            return min == int.MaxValue ? 1 : Math.Max(1, max - min + 1);
        }

        /// <summary>
        /// Turn a non-square piece so its long axis runs with the drag while preserving the player's
        /// half-turn (`linePlacement.ts:lineRunRotation`). Square pieces keep <paramref name="baseRot"/>.
        /// </summary>
        public static int LineRunRotation(int baseRot, int axis, int spanX, int spanY) {
            if (spanX == spanY) return StationFootprints.NormRot(baseRot);
            int longAxis = spanX > spanY ? 0 : 1;
            int rot = StationFootprints.NormRot(baseRot);
            if (longAxis == axis) return rot;
            return (rot + (rot % 2 == 0 ? 1 : 3)) % 4;
        }

        /// <summary>Anchor pitch in whole cells: footprint along <paramref name="axis"/> plus clamped gap.</summary>
        public static int LineStep(StationEditDraft probe, int axis, int spacing) =>
            Math.Max(1, LineSpan(probe, axis) + ClampSpacing(spacing));

        /// <summary>How many anchors a run lays from <paramref name="anchor"/> toward <paramref name="target"/>.</summary>
        public static int LineAnchorCount(StationCellKey anchor, StationCellKey target, int step) {
            int pitch = Math.Max(1, step);
            int axis = LineAxis(anchor, target);
            int delta = axis == 0 ? target.X - anchor.X : target.Y - anchor.Y;
            return Math.Abs(delta) / pitch + 1;
        }

        /// <summary>
        /// Directional anchors from the press cell toward the pointer, one every <paramref name="step"/>
        /// cells (`linePlacement.ts:lineAnchors`). Never sorts, so dragging toward -x/-y keeps the
        /// pressed piece first.
        /// </summary>
        public static List<StationCellKey> LineAnchors(StationCellKey anchor, StationCellKey target, int step) {
            int pitch = Math.Max(1, step);
            int axis = LineAxis(anchor, target);
            int delta = axis == 0 ? target.X - anchor.X : target.Y - anchor.Y;
            int direction = delta < 0 ? -1 : 1;
            int count = Math.Abs(delta) / pitch + 1;
            var result = new List<StationCellKey>(count);
            for (int i = 0; i < count; i++) {
                int at = (axis == 0 ? anchor.X : anchor.Y) + direction * i * pitch;
                result.Add(axis == 0
                    ? new StationCellKey(at, anchor.Y, anchor.Z)
                    : new StationCellKey(anchor.X, at, anchor.Z));
            }
            return result;
        }

        /// <summary>The straight run through two cells, along the drag's dominant axis.</summary>
        public static List<StationCellKey> LineCells(StationCellKey anchor, StationCellKey target, int z) =>
            StationCellPlanner.StraightLineCells(new StationCellKey(anchor.X, anchor.Y, z),
                new StationCellKey(target.X, target.Y, z), z);

        /// <summary>The whole 10,000-cell budget, shared with the block brush.</summary>
        public const int MaxRunCells = StationCellPlanner.MaxDragCells;

        /// <summary>
        /// Shared slot generator for preview, placement release, and matching erase gesture.
        /// Computes the aligned rotation, anchor pitch (<c>baseSpan + lineSpacing</c> for supported
        /// families, 1 for unspaced families like tactile), and exact anchor list.
        /// </summary>
        public static List<StationCellKey> RunSlots(StationIndex index, StationPlacementRequest template,
            StationCellKey anchor, StationCellKey target, bool dragging, bool remove,
            out int effectiveRotation, out int step) {
            int baseRot = template != null ? StationFootprints.NormRot(template.Rotation) : 0;
            effectiveRotation = baseRot;
            step = 1;
            if (!dragging) return new List<StationCellKey> { anchor };
            string paletteId = template != null ? template.ToolType ?? "" : "";
            int axis = LineAxis(anchor, target);
            if (!SupportsLineSpacing(paletteId)) {
                return LineCells(anchor, target, anchor.Z);
            }
            int gap = template != null ? ClampSpacing(template.LineSpacing) : 0;
            // Probe the candidate at the press cell so multi-cell pieces (floor marks, court dividers,
            // benches, counters, TVs) align their long axis with the drag and step by footprint + gap.
            var probeCell = remove ? new StationCellKey(anchor.X, anchor.Y, anchor.Z + 1) : anchor;
            StationEditDraft probe = null;
            if (index != null && template != null) {
                var probeReq = CloneForCell(template, probeCell, baseRot);
                probeReq.Id = "run-probe";
                probe = StationModulePlacement.Resolve(index, probeReq).Candidate;
            }
            int spanX = probe != null ? LineSpan(probe, 0) : 1;
            int spanY = probe != null ? LineSpan(probe, 1) : 1;
            effectiveRotation = LineRunRotation(baseRot, axis, spanX, spanY);
            if (effectiveRotation != baseRot && index != null && template != null) {
                var alignedReq = CloneForCell(template, probeCell, effectiveRotation);
                alignedReq.Id = "run-probe-aligned";
                var aligned = StationModulePlacement.Resolve(index, alignedReq).Candidate;
                if (aligned != null) probe = aligned;
            }
            // A fence run's panels turn to follow the drag axis (east-west = 0/2, north-south = 1/3).
            if (probe != null && string.Equals(probe.Type, "fence", StringComparison.Ordinal)) {
                int wantParity = axis == 0 ? 0 : 1;
                if (effectiveRotation % 2 != wantParity) {
                    effectiveRotation = (effectiveRotation + (effectiveRotation % 2 == 0 ? 1 : 3)) % 4;
                }
            }
            int baseSpan = probe != null ? LineSpan(probe, axis) : 1;
            // When erasing with gap == 0 (including DeleteTool's line erase), sweep every cell along
            // the line so any existing gapped row is lifted whole; when the player armed a nonzero gap,
            // share the exact same gapped slots between preview, placement, and matching erase.
            step = remove && gap == 0 ? 1 : Math.Max(1, baseSpan + gap);
            return LineAnchors(anchor, target, step);
        }

        /// <summary>
        /// Resolve one dragged run from <paramref name="anchor"/> to <paramref name="target"/> using
        /// <see cref="RunSlots"/>, guaranteeing preview, release, and matching erase share exact slots.
        /// </summary>
        public static StationModuleRunPlan PlanRun(StationIndex index, StationPlacementRequest template,
            StationCellKey anchor, StationCellKey target, bool dragging, bool remove) {
            var cells = RunSlots(index, template, anchor, target, dragging, remove, out var rot, out var step);
            var effectiveTemplate = template;
            if (!remove && template != null && rot != template.Rotation) {
                effectiveTemplate = CloneTemplateWithRotation(template, rot);
            }
            var plan = PlanAdd(index, effectiveTemplate, null, cells, remove);
            plan.EffectiveRotation = rot;
            plan.Step = step;
            return plan;
        }

        /// <summary>
        /// Resolve one run: every cell of the line through the one candidate resolver, keeping
        /// the accepted drafts (with unique ids) and the refused cells. `template` carries the
        /// tool's settings; its `Hit` is replaced per cell.
        /// </summary>
        public static StationModuleRunPlan PlanAdd(StationIndex index, StationPlacementRequest template,
            StationModuleRecord carried, IReadOnlyList<StationCellKey> cells, bool remove) {
            var plan = new StationModuleRunPlan {
                Kind = remove ? "remove" : "add",
                EffectiveRotation = template != null ? StationFootprints.NormRot(template.Rotation) : 0,
            };
            if (index == null || template == null) { plan.Reason = "no-document"; return plan; }
            if (cells == null || cells.Count == 0) { plan.Reason = "no-cells"; return plan; }
            if (cells.Count > MaxRunCells) { plan.Reason = "over-limit"; return plan; }
            if (remove) {
                RemoveRun(index, plan, template, cells);
                return plan;
            }
            var taken = new HashSet<string>(StringComparer.Ordinal);
            var usedCells = new HashSet<StationCellKey>();
            int next = index.Document.ModuleCount + 1;
            foreach (var cell in cells) {
                var request = CloneForCell(template, cell, template.Rotation);
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
                // Guard against self-overlap within the same run (`EquipmentTool.lineAccepted`).
                var footprint = StationFootprints.Footprint(StationModulePlacement.ToRecord(placement.Candidate));
                bool overlapsSelf = false;
                for (int i = 0; i < footprint.Length; i++) {
                    var key = new StationCellKey((int)Math.Round(footprint[i].X), (int)Math.Round(footprint[i].Y), placement.Candidate.Z);
                    if (usedCells.Contains(key)) { overlapsSelf = true; break; }
                }
                if (overlapsSelf) {
                    plan.Blocked.Add(cell);
                    if (plan.Reason.Length == 0) plan.Reason = "overlap";
                    continue;
                }
                for (int i = 0; i < footprint.Length; i++) {
                    usedCells.Add(new StationCellKey((int)Math.Round(footprint[i].X), (int)Math.Round(footprint[i].Y), placement.Candidate.Z));
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
        /// The erase direction: lift the same family's placed pieces along the run, matching either
        /// anchor or footprint so multi-cell runs (floor marks, court dividers) erase cleanly.
        /// </summary>
        static void RemoveRun(StationIndex index, StationModuleRunPlan plan, StationPlacementRequest template,
            IReadOnlyList<StationCellKey> cells) {
            string type = template.ToolType ?? "";
            string variant = template.Variant ?? "";
            // The palette id names a variant; the placed record is the same type at that cell.
            if (string.Equals(type, "court-divider", StringComparison.Ordinal)) {
                type = "court";
                variant = "divider";
            } else if (StationModuleFamilies.TryParse(template.ToolType ?? "", template.Variant ?? "", template.Width,
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
                    if (module.Z != cell.Z) continue;
                    if (!CoversCell(module, cell.X, cell.Y)) continue;
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

        static bool CoversCell(StationModuleRecord module, int x, int y) {
            if (module.X == x && module.Y == y) return true;
            var cells = StationFootprints.Footprint(module);
            for (int i = 0; i < cells.Length; i++) {
                if ((int)Math.Round(cells[i].X) == x && (int)Math.Round(cells[i].Y) == y) return true;
            }
            return false;
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

        static StationPlacementRequest CloneTemplateWithRotation(StationPlacementRequest template, int rotation) =>
            new StationPlacementRequest {
                ToolType = template.ToolType,
                Variant = template.Variant,
                Rotation = rotation,
                Width = template.Width,
                LineId = template.LineId,
                RunLength = template.RunLength,
                RunRise = template.RunRise,
                CurtainHeight = template.CurtainHeight,
                LineSpacing = template.LineSpacing,
                PillarLength = template.PillarLength,
                LightPosition = template.LightPosition,
                TargetModuleId = template.TargetModuleId,
                ModulePoint = template.ModulePoint,
                Hit = template.Hit,
            };

        static StationPlacementRequest CloneForCell(StationPlacementRequest template, StationCellKey cell, int rotation) {
            var point = new StationPoint(cell.X + 0.5, cell.Y + 0.5, cell.Z + 1);
            return new StationPlacementRequest {
                ToolType = template.ToolType,
                Variant = template.Variant,
                Rotation = rotation,
                Width = template.Width,
                LineId = template.LineId,
                RunLength = template.RunLength,
                RunRise = template.RunRise,
                CurtainHeight = template.CurtainHeight,
                LineSpacing = template.LineSpacing,
                PillarLength = template.PillarLength,
                LightPosition = template.LightPosition,
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
            if (string.Equals(paletteId, "court-divider", StringComparison.Ordinal)) {
                type = "court";
            } else if (StationModuleFamilies.TryParse(paletteId ?? "", "", 0, out var family) && family.Type.Length > 0) {
                type = family.Type;
            }
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
