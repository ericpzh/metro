using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// A module being placed or carried, before it reaches the save. It mirrors the
    /// authored v1 record — type, anchor, turn, run dimensions, the flattened
    /// <c>cfg</c> — so the same value drives the ghost, the refusal and the commit
    /// (plan 16 §1.4: "preview and commit pass one candidate").
    ///
    /// The document layer owns the JSON: this type keeps scalars as their save text
    /// (exactly what <see cref="ModuleConfig"/> reads) and arrays/objects as raw JSON,
    /// flagged in <see cref="JsonKeys"/>, so <c>Metro.Build</c> stays free of Newtonsoft.
    /// </summary>
    public sealed class StationEditDraft {
        public string Id = "";
        public string Type = "";
        public int X;
        public int Y;
        public int Z;
        public int Rotation;
        public int Width = 1;
        public int Depth = 1;
        public int Height = 1;
        public bool CeilingAnchored;
        public StationPoint? From;
        public StationPoint? To;
        /// <summary>Authored <c>h</c> of a hanging panel (a 站名's printed height), 0 when absent.</summary>
        public double PanelHeight;
        /// <summary>A floor-mark's <c>cfg.offset</c>, metres.</summary>
        public double OffsetX;
        public double OffsetY;
        /// <summary>The placed record this draft moved, for a carried piece; empty for a fresh one.</summary>
        public string SourceId = "";
        /// <summary>Scalar `cfg` values, in save text (`"true"`, `"2"`, `"steel-1"`).</summary>
        public readonly Dictionary<string, string> Config = new Dictionary<string, string>(StringComparer.Ordinal);
        /// <summary>Keys in <see cref="Config"/> whose text is a raw JSON array/object.</summary>
        public readonly HashSet<string> JsonKeys = new HashSet<string>(StringComparer.Ordinal);

        public string Text(string key) => Config.TryGetValue(key, out var value) ? value : "";
        public bool Bool(string key, bool fallback = false) {
            var text = Text(key);
            if (text.Length == 0) return fallback;
            if (string.Equals(text, "true", StringComparison.OrdinalIgnoreCase)) return true;
            if (string.Equals(text, "false", StringComparison.OrdinalIgnoreCase)) return false;
            return fallback;
        }
        public double Number(string key, double fallback = 0) =>
            double.TryParse(Text(key), System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out var value) ? value : fallback;
        public void Set(string key, string value) { Config[key] = value ?? ""; JsonKeys.Remove(key); }
        public void SetJson(string key, string json) { Config[key] = json ?? ""; JsonKeys.Add(key); }
        public void Set(bool value, string key) => Set(key, value ? "true" : "false");
        public void Set(int value, string key) => Set(key, value.ToString(System.Globalization.CultureInfo.InvariantCulture));

        public StationEditDraft Clone() {
            var copy = new StationEditDraft {
                Id = Id, Type = Type, X = X, Y = Y, Z = Z, Rotation = Rotation,
                Width = Width, Depth = Depth, Height = Height, CeilingAnchored = CeilingAnchored,
                From = From, To = To, PanelHeight = PanelHeight, OffsetX = OffsetX, OffsetY = OffsetY,
                SourceId = SourceId,
            };
            foreach (var pair in Config) copy.Config[pair.Key] = pair.Value;
            foreach (var key in JsonKeys) copy.JsonKeys.Add(key);
            return copy;
        }

        public override string ToString() => Type + " " + Id + " at " + X + "," + Y + "," + Z + " rot " + Rotation;
    }

    /// <summary>
    /// The whole-cell hit one pointer event resolved, in document axes. Port of
    /// <c>render/pickCell.ts</c>: <see cref="Cell"/> is the block the drawn surface
    /// belongs to and <see cref="Place"/> is the neighbouring cell a placement
    /// against that surface takes.
    /// </summary>
    public readonly struct StationPlacementHit {
        readonly bool hasCell;

        public StationPlacementHit(int x, int y, int z, int px, int py, int pz, bool solid,
            StationPoint point, double surfaceZ)
            : this(x, y, z, px, py, pz, solid, point, surfaceZ,
                (px != x || py != y || pz != z) ? new StationPoint(px - x, py - y, pz - z) : new StationPoint(0, 0, 1)) {
        }

        public StationPlacementHit(int x, int y, int z, int px, int py, int pz, bool solid,
            StationPoint point, double surfaceZ, StationPoint normal) {
            hasCell = true;
            X = x; Y = y; Z = z; PlaceX = px; PlaceY = py; PlaceZ = pz;
            Solid = solid; Point = point; SurfaceZ = surfaceZ; Normal = normal;
        }

        public int X { get; }
        public int Y { get; }
        public int Z { get; }
        public int PlaceX { get; }
        public int PlaceY { get; }
        public int PlaceZ { get; }
        public bool Solid { get; }
        /// <summary>The world hit point in document metres, for a mark's sub-cell aim.</summary>
        public StationPoint Point { get; }
        /// <summary>The hit surface's elevation (the block's top for a top hit).</summary>
        public double SurfaceZ { get; }
        /// <summary>The axis-snapped outward face step (`render/pickCell.ts:faceStep`).</summary>
        public StationPoint Normal { get; }
        public bool HasCell => hasCell;
        public static StationPlacementHit None => default;

        /// <summary>
        /// Snap an arbitrary geometric surface normal to its dominant cell axis (`render/pickCell.ts:faceStep`).
        /// </summary>
        public static void FaceStep(StationPoint normal, out int stepX, out int stepY, out int stepZ) {
            double ax = Math.Abs(normal.X), ay = Math.Abs(normal.Y), az = Math.Abs(normal.Z);
            if (az >= ax && az >= ay) {
                stepX = 0; stepY = 0; stepZ = normal.Z >= 0 ? 1 : -1;
                return;
            }
            if (ax >= ay) {
                stepX = normal.X >= 0 ? 1 : -1; stepY = 0; stepZ = 0;
                return;
            }
            stepX = 0; stepY = normal.Y >= 0 ? 1 : -1; stepZ = 0;
        }

        /// <summary>
        /// Build a placement hit directly from an authored cell face record (`cellKey` + `face`),
        /// keeping the face's exact cell rather than reconstructing it by stepping inside.
        /// </summary>
        public static StationPlacementHit FromCellFace(int x, int y, int z, int stepX, int stepY, int stepZ,
            bool solid, StationPoint point) {
            double surfaceZ = stepZ > 0 ? z + 1 : point.Z;
            return new StationPlacementHit(x, y, z, x + stepX, y + stepY, z + stepZ, solid, point, surfaceZ,
                new StationPoint(stepX, stepY, stepZ));
        }

        /// <summary>
        /// Port of <c>render/pickCell.ts:pickCells</c> from a hit point and geometric triangle normal:
        /// steps a hair inside along the un-snapped geometric normal to identify the host cell, then
        /// snaps the placement step to the dominant axis.
        /// </summary>
        public static StationPlacementHit FromNormal(StationPoint point, StationPoint normal, bool solid) {
            const double inside = 0.02;
            double len = Math.Sqrt(normal.X * normal.X + normal.Y * normal.Y + normal.Z * normal.Z);
            if (len <= 1e-9) {
                normal = new StationPoint(0, 0, 1);
                len = 1.0;
            }
            int x = (int)Math.Floor(point.X - normal.X / len * inside);
            int y = (int)Math.Floor(point.Y - normal.Y / len * inside);
            int z = (int)Math.Floor(point.Z - normal.Z / len * inside);
            FaceStep(normal, out var stepX, out var stepY, out var stepZ);
            double surfaceZ = stepZ > 0 ? z + 1 : point.Z;
            return new StationPlacementHit(x, y, z, x + stepX, y + stepY, z + stepZ, solid, point, surfaceZ,
                new StationPoint(stepX, stepY, stepZ));
        }

        /// <summary>
        /// The whole cells a solid hit names, from the hit point and the face step. The
        /// block is read a hair inside the surface, then the placement step is applied to
        /// whole cells only (<c>pickCells</c>); a fraction never reaches a tool.
        /// </summary>
        public static StationPlacementHit FromSurface(StationPoint point, int stepX, int stepY, int stepZ, bool solid) {
            const double inside = 0.02;
            double len = Math.Sqrt(stepX * stepX + stepY * stepY + stepZ * stepZ);
            if (len <= 0) len = 1;
            int x = (int)Math.Floor(point.X - stepX / len * inside);
            int y = (int)Math.Floor(point.Y - stepY / len * inside);
            int z = (int)Math.Floor(point.Z - stepZ / len * inside);
            double surfaceZ = stepZ > 0 ? z + 1 : point.Z;
            return new StationPlacementHit(x, y, z, x + stepX, y + stepY, z + stepZ, solid, point, surfaceZ,
                new StationPoint(stepX, stepY, stepZ));
        }
    }

    /// <summary>What a tool asks the resolver: the pointer hit, the tool's settings and, for a move, the carried record.</summary>
    public sealed class StationPlacementRequest {
        /// <summary>The palette/type id the tool would place (`bench-steel-1`, `fence`, …).</summary>
        public string ToolType = "";
        public string Variant = "";
        /// <summary>The turn the player chose (R), in document quarter turns.</summary>
        public int Rotation;
        /// <summary>
        /// Run width cells for the families whose palette cycles it. Zero means "the
        /// palette id decides": a bench id already names its 1 m or 2 m run, so a caller
        /// that omits the width must not override it.
        /// </summary>
        public int Width;
        public string LineId = "";
        public StationPlacementHit Hit = StationPlacementHit.None;
        /// <summary>The record a 移动 carries; null for a fresh placement.</summary>
        public StationModuleRecord Carried;
        /// <summary>The carried record's document index (its own cfg travels unchanged).</summary>
        public int CarriedRotation;
        /// <summary>A fresh id for a placement; the carried id for a move.</summary>
        public string Id = "";
        /// <summary>
        /// The ramp a fresh exit was dropped on (the source's `pickSnapRamp` result,
        /// `EquipmentTool.buildPlacementModule`'s `targetRamp`). Empty when the pointer hit
        /// no supported ramp; `Resolve` then keeps the unsnapped candidate, exactly as
        /// `snapExitToRamp(mod, targetRamp) ?? mod` does.
        /// </summary>
        public string TargetModuleId = "";
        /// <summary>A ramp's chosen run length in cells (`rampSnapSpec`); 0 reads the tool
        /// family's own default (楼梯 长 8 cells, 扶梯 长 9 at 30°).</summary>
        public double RunLength;
        /// <summary>A ramp's chosen climb in metres; 0 reads the 长 5 m rung.</summary>
        public double RunRise;
        /// <summary>
        /// A 楼梯块's chosen height in metres (`stairBlockHeight`): 1 is the tall block and
        /// 0.5 the low one. Zero reads the family's own default.
        /// </summary>
        public double BlockHeight;
        /// <summary>A lift's floor interval in metres (`liftInterval`): 5 by default, 3–7 arming.</summary>
        public int LiftInterval;        /// <summary>True for the 大 3 × 3 lift shaft (`liftSize === 'large'`).</summary>
        public bool LiftSizeLarge;
        /// <summary>
        /// A 支柱's armed section length in metres (`pillarLength`, one of 2–6; 0 reads the
        /// storey height). A fresh post is born this tall and a press on an existing post grows
        /// it by exactly this much (`extendedPillar`).
        /// </summary>
        public int PillarLength;
        /// <summary>A 自动步道's level run in cells (`walkwayLength`: 30 / 60 / 90).</summary>
        public int WalkwayRun;
        /// <summary>True when a walkway travels <c>down</c> (its `from` is the far end).</summary>
        public bool WalkwayDown;
        /// <summary>
        /// A 屋顶 plate's snap (`roofPlateSnap`): <c>lower</c> or <c>upper</c> pins the thin
        /// slab to the bottom or the top half of the cell it was dropped on. Empty leaves the
        /// piece at its default height.
        /// </summary>
        public string RoofPlateSnap = "";
        /// <summary>
        /// A 玻璃幕墙's chosen panel height in metres (`createModule`'s `curtainHeight`): 4 is
        /// the catalogue's own piece and leaves the override out of the save, 2 and 3 carry it.
        /// </summary>
        public int CurtainHeight = 4;
        /// <summary>
        /// The **point** the ray met on the picked module, in document axes. `Hit` prefers the
        /// cell behind a model (see `PlacementHit`'s note), so it cannot say where along a
        /// curtain run the pointer landed; the door-to-curtain snap needs that point to choose
        /// the run cell it centres on.
        /// </summary>
        public StationPoint? ModulePoint;
    }

    /// <summary>One immutable answer: the candidate, its support, its collisions and a stable reason code.</summary>
    public sealed class StationPlacementPlan {
        public bool Ok => string.IsNullOrEmpty(Reason);
        /// <summary>The normalized candidate, or null when the request never produced a piece.</summary>
        public StationEditDraft Candidate;
        /// <summary>Stable refusal code (`floor`, `occupied`, `track`, `wall`, `ceiling`, `unsupported-family`, …).</summary>
        public string Reason = "";
        /// <summary>The module the piece stands on / hangs from, when the document names one.</summary>
        public string SupportId = "";
        /// <summary>Placed modules the candidate shares space with (the red preview set).</summary>
        public readonly List<string> ColliderIds = new List<string>();
        /// <summary>
        /// Neighbours whose clearance envelope this packet cannot derive. They are not
        /// turned into a refusal (a station-wide roof would refuse every piece); the
        /// report names them so a verifier can tell "checked" from "not checked yet".
        /// </summary>
        public readonly List<string> UnverifiedIds = new List<string>();
        /// <summary>The editing cell the plan resolved to (after any snap).</summary>
        public int CellX, CellY, CellZ;
        /// <summary>True when the plan came from a carried record rather than a fresh type.</summary>
        public bool IsMove;
        public override string ToString() =>
            (Ok ? "ok" : Reason) + " " + (Candidate == null ? "(no candidate)" : Candidate.ToString());
    }

    /// <summary>
    /// The candidate factory for the families the canvas editor can create from the
    /// palette. Ported from <c>build/model/Equipment.ts</c> (<c>createModule</c>) for
    /// the migrated families only: every other type says so (plan 16 §1.4 —
    /// "guard unsupported families before committing") instead of guessing a record.
    /// </summary>
    public static class StationModuleFamilies {
        /// <summary>A family's palette defaults, before the document's own rules run.</summary>
        public sealed class Family {
            public string Type = "";
            public string Variant = "";
            /// <summary>Run width in cells for a family whose palette cycles it.</summary>
            public int Width = 1;
            public bool Centred;
        }

        /// <summary>True for the two families an exit bay snaps into (`isSnapRamp`).</summary>
        public static bool IsRamp(string type) =>
            string.Equals(type, "stair", StringComparison.Ordinal) ||
            string.Equals(type, "escalator", StringComparison.Ordinal);

        /// <summary>
        /// The run and rise a fresh ramp is built at for the request: the source's
        /// `rampSnapSpec` (the 长 5 m rung, 8 cells for a stair and 9 for the 30° escalator)
        /// unless the tool passes its own length and climb.
        /// </summary>
        public static void RampSpec(StationPlacementRequest request, out double run, out double rise) {
            bool escalator = string.Equals(request?.ToolType, "escalator", StringComparison.Ordinal);
            run = escalator ? StationExitSnapping.EscalatorRun : StationExitSnapping.StairRun;
            rise = escalator ? StationExitSnapping.EscalatorRise : StationExitSnapping.StairRise;
            if (request != null && request.RunLength > 0) run = request.RunLength;
            if (request != null && request.RunRise > 0) rise = request.RunRise;
        }

        /// <summary>
        /// The palette id's bay count and cover, exactly as `createModule`'s exit branch reads
        /// them: the trailing digit names 1/3/4 bays (anything else is the reference two), and
        /// `-uncovered-` drops the canopy. A doorway/virtual id is not a head-house and is not
        /// a creatable family here.
        /// </summary>
        public static bool TryParseExit(string paletteId, out int bays, out bool covered) {
            bays = 2;
            covered = true;
            var id = paletteId ?? "";
            if (id == "exit") return true;
            bool coveredPrefix = id.StartsWith("exit-covered-", StringComparison.Ordinal);
            bool uncoveredPrefix = id.StartsWith("exit-uncovered-", StringComparison.Ordinal);
            if (!coveredPrefix && !uncoveredPrefix) return false;
            if (!int.TryParse(id.Substring(id.LastIndexOf('-') + 1), System.Globalization.NumberStyles.Integer,
                    System.Globalization.CultureInfo.InvariantCulture, out var count)) return false;
            if (count == 1 || count == 3 || count == 4) bays = count;
            covered = coveredPrefix;
            return true;
        }

        /// <summary>
        /// The first free A ~ Z among the station's exits (`nextExitLetter`). The shipped saves
        /// name their head-houses with the bare letter, which is the same convention the source's
        /// virtual exit uses, so a fresh piece reads like the ones beside it.
        /// </summary>
        public static string NextExitLetter(StationIndex index) {
            var used = new HashSet<string>(StringComparer.Ordinal);
            if (index != null) {
                foreach (var module in index.Document.Modules) {
                    if (!string.Equals(module.Type, "exit", StringComparison.Ordinal)) continue;
                    var name = module.Config.Text("name").Trim();
                    if (name.Length == 0) continue;
                    var letter = name.Substring(0, 1).ToUpperInvariant();
                    if (letter.Length == 1 && letter[0] >= 'A' && letter[0] <= 'Z') used.Add(letter);
                }
            }
            for (char letter = 'A'; letter <= 'Z'; letter++) {
                var text = letter.ToString();
                if (!used.Contains(text)) return text;
            }
            return "";
        }

        /// <summary>Bench variants, in palette order (<c>sim/benches.ts</c>).</summary>
        public static int BenchWidth(string variant) {
            switch (variant) {
                case "steel-2":
                case "seat-2":
                case "wood-2":
                    return 2;
                default:
                    return 1;
            }
        }

        /// <summary>Read a palette id into the family it builds, or false when no tool places it.</summary>
        public static bool TryParse(string paletteId, string variantOverride, int width, out Family family) {
            family = null;
            var id = paletteId ?? "";
            if (id.Length == 0) return false;
            var parsed = new Family();
            if (id == "bench" || id.StartsWith("bench-", StringComparison.Ordinal)) {
                parsed.Type = "bench";
                parsed.Variant = id == "bench" ? "steel-1" : id.Substring("bench-".Length);
                parsed.Width = BenchWidth(parsed.Variant);
                parsed.Centred = true;
            } else if (id == "fence" || id == "noise-barrier" || id == "noise-barrier-half" ||
                       id == "noise-barrier-railing" || id == "fence-gate" ||
                       id == "fence-steel-blue" || id == "fence-iron") {
                parsed.Type = "fence";
                parsed.Variant = id == "noise-barrier" ? "sound-barrier"
                    : id == "noise-barrier-half" ? "sound-barrier-half"
                    : id == "noise-barrier-railing" ? "bridge-railing"
                    : id == "fence-gate" ? "gate"
                    : id == "fence-steel-blue" ? "steel-blue"
                    : id == "fence-iron" ? "iron"
                    : "glass";
            } else if (id == "tactile-guide" || id == "tactile-warning" || id == "tactile-warning-strip" || id == "tactile") {
                parsed.Type = "tactile";
                parsed.Variant = id == "tactile-warning" ? "warning" : id == "tactile-warning-strip" ? "warning-strip" : "guide";
            } else if (id == "floor-mark-boarding" || id == "floor-mark-waiting" || id == "floor-mark-direction" || id == "floor-mark") {
                parsed.Type = "floor-mark";
                parsed.Variant = id == "floor-mark-waiting" ? "waiting" : id == "floor-mark-direction" ? "direction" : "boarding";
            } else if (id == "tvm" || id == "vending" || id == "bin" || id == "desk" || id == "guidepost" ||
                       id == "urinal" || id == "sink" || id == "tv" || id == "vent") {
                parsed.Type = id;
            } else if (id == "clock" || id == "clock-digital") {
                parsed.Type = "clock";
                parsed.Variant = id == "clock-digital" ? "digital" : "";
            } else if (id == "cctv" || id == "cctv-ptz" || id == "cctv-dome" || id == "cctv-post") {
                parsed.Type = "cctv";
                parsed.Variant = id == "cctv-ptz" ? "ptz" : id == "cctv-dome" ? "dome" : id == "cctv-post" ? "post" : "bullet";
            } else if (id == "monitor" || id == "monitor-ceiling" || id == "monitor-wall") {
                parsed.Type = "monitor";
                parsed.Variant = id == "monitor-wall" ? "wall" : "ceiling";
                parsed.Width = id == "monitor-wall" ? 3 : 1;
                parsed.Centred = true;
            } else if (id == "curtain-wall") {
                // `createModule`'s curtain branch: the palette id names a 4 m high run whose
                // width comes from the action row (1–4 cells), and the run is centred on the
                // hovered cell like a 玻璃板's. Without this the curtain could not be placed or
                // moved at all, so a fitted door had nothing to snap to (plan 22 §2).
                parsed.Type = "glass";
                parsed.Variant = width >= 4 ? "4x4" : width == 3 ? "3x4" : width == 2 ? "2x4" : "1x4";
                parsed.Width = width >= 4 ? 4 : width == 3 ? 3 : width == 2 ? 2 : 1;
                parsed.Centred = true;
            } else if (id == "glass" || id.StartsWith("glass-", StringComparison.Ordinal)) {
                var variant = id == "glass" ? "1x1" : id.Substring("glass-".Length);
                parsed.Type = "glass";
                parsed.Variant = variant;
                parsed.Width = GlassWidth(variant);
                parsed.Centred = true;
            } else if (id == "door" || id.StartsWith("door-", StringComparison.Ordinal)) {
                // `createModule`'s door branch: the id names the variant, and a 双开 door grows
                // evenly either side of the pointer.
                var variant = id == "door" ? "steel-1" : id.Substring("door-".Length);
                parsed.Type = "door";
                parsed.Variant = variant;
                parsed.Width = DoorWidth(variant);
                parsed.Centred = true;
            } else if (id == "light-circular" || id == "light-rectangular" || id == "light") {
                parsed.Type = "light";
                parsed.Variant = id == "light-rectangular" ? "rectangular" : "circular";
            } else if (id == "extinguisher" || id == "extinguisher-compact" || id == "extinguisher-glass") {
                parsed.Type = "extinguisher";
                parsed.Variant = id == "extinguisher-compact" ? "compact" : id == "extinguisher-glass" ? "glass" : "";
            } else if (id == "gate" || id == "gate-new") {
                parsed.Type = "gate";
                parsed.Variant = id == "gate-new" ? "new" : "old";
            } else if (id == "cubicle" || id == "cubicle-toilet") {
                parsed.Type = "cubicle";
                parsed.Variant = id == "cubicle-toilet" ? "toilet" : "";
            } else if (id == "court" || id == "court-pickleball" || id == "court-badminton" || id == "court-divider") {
                parsed.Type = "court";
                parsed.Variant = id == "court-divider" ? "divider" : id == "court-badminton" ? "badminton" : "pickleball";
            } else if (TryParseExit(id, out _, out _)) {
                // A head-house is a creatable family; its palette id carries the cover and bay
                // count, read again in `TryCreate`. Doorway/virtual exits are wall/surface
                // mounts of their own and stay unsupported here.
                parsed.Type = "exit";
                parsed.Variant = id;
            } else if (id == "stair" || id == "stair-straight") {
                parsed.Type = "stair";
            } else if (id == "stair-block") {
                // The 楼梯块: a solid stair box, not a flight (`createModule`'s stair-block
                // branch). Its height comes from the tool's own setting, not the palette id.
                parsed.Type = "stair-block";
            } else if (id == "escalator") {
                parsed.Type = "escalator";
            } else if (id == "lift") {
                parsed.Type = "lift";
            } else if (id == "walkway") {
                parsed.Type = "walkway";
            } else if (id == "roof") {
                // The 屋顶 tile: a 1 × 1 slab hung one storey above the cell it is dropped on
                // (`createModule`'s roof branch). The truss/canopy ids are separate families.
                parsed.Type = "roof";
            } else if (id == "roof-shell" || id == "roof-truss" || id == "roof-tapered" || id == "roof-canopy") {
                // A truss bay: four cells along the run, its depth the tool's 4/8/12 breadth
                // (`supportedRoofWidth`), centred on the aim.
                parsed.Type = "roof";
                parsed.Variant = id == "roof-shell" ? "shell"
                    : id == "roof-truss" ? "truss"
                    : id == "roof-tapered" ? "tapered-truss"
                    : "canopy";
                parsed.Width = StationRoofRules.Bay;
                parsed.Centred = true;
            } else if (id == "linemap" || id == "linemap-wall" || id == "linemap-stand") {
                // The 线网图 board: the palette id names the mount (`lineMapSpec`), and both
                // mounts are the same two-cell board — one on a wall, one on a floor totem.
                parsed.Type = "linemap";
                parsed.Variant = id == "linemap-stand" ? "stand" : "wall";
                parsed.Width = 2;
                parsed.Centred = true;
            } else if (id == "tree") {
                // A street tree: one plan cell, its canopy four and a half metres tall.
                parsed.Type = "tree";
            } else if (id == "busstop-short" || id == "busstop-long") {
                // A bus shelter: four or eight cells along its run by two deep, centred on the
                // aim like a track piece.
                parsed.Type = "busstop";
                parsed.Variant = id == "busstop-long" ? "long" : "short";
                parsed.Width = id == "busstop-long" ? 8 : 4;
                parsed.Centred = true;
            } else if (id == "ac-unit" || id == "electrical-cabinet" || id == "rail-signal") {
                parsed.Type = id;
            } else if (id == "shelf" || id.StartsWith("shelf-", StringComparison.Ordinal)) {
                // A store shelf: the palette id names the variant, and the variant decides how
                // many cells the run fills (`shelfWidth`: 1, 2 for books/bags, 4 for the long
                // café back-bar). A bare id is the tall dark shelf.
                parsed.Type = "shelf";
                parsed.Variant = id == "shelf" ? "dark-tall" : id.Substring("shelf-".Length);
            } else if (id == "checkout" || id.StartsWith("checkout-", StringComparison.Ordinal)) {
                // A 收银台: the palette id names the counter style, and the tool's width
                // setting names the run length, clamped to the four catalogue lengths.
                parsed.Type = "checkout";
                parsed.Variant = id == "checkout" ? "" : id.Substring("checkout-".Length);
            } else if (id == "billboard" || id.StartsWith("billboard-", StringComparison.Ordinal)) {
                // A 广告牌: the palette id names the variant (a bare id is the small landscape),
                // and the variant decides the run width the piece fills.
                parsed.Type = "billboard";
                parsed.Variant = id == "billboard" ? "wide" : id.Substring("billboard-".Length);
                parsed.Width = BillboardWidth(parsed.Variant);
                parsed.Centred = true;
            } else if (id == "calligraphy" || id.StartsWith("calligraphy-", StringComparison.Ordinal)) {
                // A 站名: the palette id names the hand and the axis (`calligraphy-<style>-<axis>`);
                // a bare id is 楷书 横排. The panel is cut at placement (`StationCalligraphy`).
                parsed.Type = "calligraphy";
                var parts = id.Split('-');
                string style = id == "calligraphy" ? "kai" : (parts.Length > 1 ? parts[1] : "kai");
                string axis = id == "calligraphy" ? "h" : (parts.Length > 2 ? parts[2] : "h");
                parsed.Variant = style + "-" + axis;
            } else if (id == "sign" || id == "sign-wall" || id == "sign-ceiling") {
                // A 标识: the palette id names its mount  the hung board by default, or the wall
                // board  and it is born with a composed front (`defaultSignLayout`).
                parsed.Type = "sign";
                parsed.Variant = id == "sign-wall" ? "wall" : id == "sign-ceiling" ? "ceiling" : "";
            } else if (id == "pillar" || id == "pillar-slim" || id == "pillar-thick") {
                // A free-standing 支柱 (`createModule`'s pillar branch): one cell, one shaft, and
                // the palette id names its gauge. Its height is the tool's armed section.
                parsed.Type = "pillar";
                parsed.Variant = id == "pillar-thick" ? "thick" : "slim";
            } else if (id == "hanger-roof" || id == "hanger-post") {                // A hanger: the palette id names its mount, and its run is four cells unless the
                // tool asks for the six/eight-cell span (`createModule`'s hanger branch).
                parsed.Type = "hanger";
                parsed.Variant = id == "hanger-post" ? "post" : "roof";
                parsed.Width = width == 6 || width == 8 ? width : 4;
                parsed.Centred = true;
            } else if (id == "tv-double") {
                // The double-sided screen is the same `tv` record: the palette names the face
                // count, the piece hangs from the same hanger.
                parsed.Type = "tv";
            } else if (id == "psd-end" || id == "psd-end-cover") {
                // The 站台门 end piece (`createModule`'s psd-end branch): a half-height end
                // panel, or the full-height corner cover that caps a run.
                parsed.Type = "psd-end";
                parsed.Variant = id == "psd-end-cover" ? "cover" : "";
            } else {
                return false;
            }
            if (!string.IsNullOrEmpty(variantOverride)) parsed.Variant = variantOverride;
            if (width > 0 && (parsed.Type == "bench" || parsed.Type == "monitor")) parsed.Width = width;
            family = parsed;
            return true;
        }

        /// <summary>`glassSpec(variant).w`: how many cells a 玻璃板 size covers.</summary>
        public static int GlassWidth(string variant) {
            switch (variant) {
                case "2x1":
                case "2x2":
                case "2x4": return 2;
                case "3x1":
                case "3x2":
                case "3x4": return 3;
                case "4x4": return 4;
                default: return 1;
            }
        }

        /// <summary>`doorSpec(variant).w`: one leaf or two.</summary>
        public static int DoorWidth(string variant) =>
            variant == "steel-2" || variant == "wood-2" || variant == "glass-2" ? 2 : 1;

        /// <summary>`billboardSpec(variant).w`: the cells a board fills (the sized panels first).</summary>
        public static int BillboardWidth(string variant) {
            switch (variant ?? "") {
                case "16x9-3m": return 6;
                case "16x9-4m": return 7;
                case "4x3-3m": return 4;
                case "4x3-4m": return 6;
                case "panorama": return 3;
                case "standard":
                case "large": return 2;
                default: return 1;
            }
        }

        /// <summary>`shelfWidth`: the cells a shelf variant fills (books and bags two, the long café back-bar four).</summary>
        public static int ShelfWidth(string variant) {
            var name = variant ?? "";
            if (name == "books" || name == "bags" || name == "cafe-backbar-2") return 2;
            if (name == "cafe-backbar-4") return 4;
            return 1;
        }

        /// <summary>
        /// True for the palette ids that hang on a wall face (`isWallMountedType`): the wall
        /// monitor, the wall sign, billboards, 站名, wall 线网图, the doorway exit and the
        /// floor-standing-free glass panels. Their creation ids are separate families.
        /// </summary>
        public static bool IsWallPalette(string paletteId) {
            var id = paletteId ?? "";
            if (id == "urinal" || id == "monitor-wall" || id == "sign-wall") return true;
            if (id == "billboard" || id.StartsWith("billboard-", StringComparison.Ordinal)) return true;
            if (id == "calligraphy" || id.StartsWith("calligraphy-", StringComparison.Ordinal)) return true;
            if (id.StartsWith("linemap-", StringComparison.Ordinal) && id != "linemap-stand") return true;
            if (id == "linemap") return true;
            if (id.StartsWith("exit-doorway-", StringComparison.Ordinal)) return true;
            // A 玻璃板 is wall-mounted unless its size stands on the floor (`…x4` and the
            // curtain-wall pieces are full-storey panes, not bands of wall).
            if (id == "glass" || id.StartsWith("glass-", StringComparison.Ordinal)) {
                var variant = id == "glass" ? "1x1" : id.Substring("glass-".Length);
                return variant != "1x4" && variant != "2x4" && variant != "3x4" && variant != "4x4";
            }
            return false;
        }

        /// <summary>
        /// `stairFacing`: the run direction of a stair-family piece. It is **not**
        /// `rotateLocal(rot, 1, 0)` — a stair at rot 0 climbs along +y, and the family's four
        /// turns walk the compass clockwise from there (`sim/stairs.ts`).
        /// </summary>
        public static void StairFacing(int rot, out int dx, out int dy) {
            switch (StationFootprints.NormRot(rot)) {
                case 0: dx = 0; dy = 1; break;
                case 1: dx = 1; dy = 0; break;
                case 2: dx = 0; dy = -1; break;
                default: dx = -1; dy = 0; break;
            }
        }

        /// <summary>Build the fresh candidate at a whole cell (<c>createModule</c>'s migrated branches).</summary>
        public static bool TryCreate(StationPlacementRequest request, out StationEditDraft draft, out string reason) =>
            TryCreate(null, request, null, out draft, out reason);

        public static bool TryCreate(StationPlacementRequest request, StationExitBaySnap? baySnap,
            out StationEditDraft draft, out string reason) =>
            TryCreate(null, request, baySnap, out draft, out reason);

        /// <summary>
        /// Build the fresh candidate, honouring the exit-bay snap an escalated ramp takes
        /// (`exitRunSnap`): <paramref name="baySnap"/> replaces the pointer cell and turn with
        /// the run's upper landing in the bay the pointer is inside.
        /// </summary>
        public static bool TryCreate(StationIndex index, StationPlacementRequest request, StationExitBaySnap? baySnap,
            out StationEditDraft draft, out string reason) {
            reason = "";
            draft = null;
            if (!request.Hit.HasCell) { reason = "no-hit"; return false; }
            if (!TryParse(request.ToolType, request.Variant, request.Width, out var family)) {
                reason = "unsupported-family";
                return false;
            }
            var cell = StationModulePlacement.AimCell(index, request);
            // A slim pillar's R cycles its nine in-cell spots (`IN_CELL_POSITIONS`), not four
            // quarter turns; every other family snaps to a quarter turn. `ToRecord` carries the
            // value unchanged, so the spot the ghost drew is the spot the save keeps.
            bool slimPillar = string.Equals(family.Type, "pillar", StringComparison.Ordinal) &&
                              !string.Equals(family.Variant, "thick", StringComparison.Ordinal);
            int rotation = slimPillar
                ? ((request.Rotation % 9) + 9) % 9
                : StationFootprints.NormRot(request.Rotation);
            if (baySnap.HasValue && IsRamp(family.Type)) {
                cell = baySnap.Value.Base;
                rotation = baySnap.Value.Rotation;
            }
            var candidate = new StationEditDraft {
                Id = string.IsNullOrEmpty(request.Id) ? family.Type + "-edit" : request.Id,
                Type = family.Type,
                X = (int)Math.Round(cell.X),
                Y = (int)Math.Round(cell.Y),
                Z = (int)Math.Round(cell.Z),
                Rotation = rotation,
            };
            // A hung fitting anchors on the slab it hangs from (`ceilingAnchored`), which is what
            // tells the clearance rule to reserve the column below it rather than the cell.
            if (StationCeilingAim.IsCeilingPiece(family.Type)) candidate.CeilingAnchored = true;
            if (family.Type == "exit") {
                if (!TryParseExit(family.Variant.Length == 0 ? request.ToolType : family.Variant, out var bays, out var covered)) {
                    reason = "unsupported-family";
                    return false;
                }
                // `createModule`'s exit payload; the name is the station's next free letter,
                // filled by the resolver because only it holds the document.
                candidate.Set("name", "");
                candidate.Set(900, "inRate");
                candidate.Set(true, "open");
                candidate.Set(covered, "covered");
                candidate.Set(bays, "bays");
                draft = candidate;
                return true;
            }
            if (IsRamp(family.Type)) {
                RampSpec(request, out var run, out var rise);
                StationExitSnapping.StairFacing(rotation, out var facingX, out var facingY);
                var from = new StationPoint(candidate.X, candidate.Y, candidate.Z);
                var to = new StationPoint(candidate.X + facingX * run, candidate.Y + facingY * run, candidate.Z + rise);
                candidate.From = from;
                candidate.To = to;
                if (family.Type == "stair") {
                    candidate.Set("style", "straight");
                    candidate.Set("width", StationExitSnapping.NarrowWidth.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture));
                    // `createModule` writes the single flight even for a straight run, so a
                    // committed candidate reopens through the same `cfg.flights` shape.
                    candidate.SetJson("flights", FlightsJson(from, to));
                } else {
                    candidate.Set("incline", "30");
                    candidate.Set("dir", "up");
                }
                draft = candidate;
                return true;
            }
            // A run is centred on the hovered cell so an even run grows evenly either
            // side of the pointer (`trackOriginForCentre`).
            if (family.Centred) {
                StationFootprints.RotateLocal(candidate.Rotation, -Math.Floor((family.Width - 1) / 2.0), 0, out var dx, out var dy);
                candidate.X += (int)Math.Round(dx);
                candidate.Y += (int)Math.Round(dy);
            }
            switch (family.Type) {
                case "bench":
                    candidate.Width = family.Width;
                    candidate.Set("variant", family.Variant.Length == 0 ? "steel-1" : family.Variant);
                    break;
                case "monitor":
                    candidate.Width = family.Width;
                    candidate.Set("mount", family.Variant);
                    break;
                case "fence":
                    candidate.Set("variant", family.Variant);
                    break;
                case "glass":
                    // `createModule`: the palette id names the size, and a 玻璃幕墙 keeps its
                    // `curtainHeight` override unless it is the catalogue's own 4 m piece
                    // (whose `…x4` variant already describes it).
                    candidate.Width = family.Width;
                    var glassVariant = family.Variant.Length == 0 ? "1x1" : family.Variant;
                    candidate.Set("variant", glassVariant);
                    if (glassVariant.EndsWith("x4", StringComparison.Ordinal) &&
                        request.CurtainHeight > 0 && request.CurtainHeight != 4)
                        candidate.Set(request.CurtainHeight, "curtainHeight");
                    break;
                case "door":
                    candidate.Width = family.Width;
                    candidate.Set("variant", family.Variant.Length == 0 ? "steel-1" : family.Variant);
                    break;
                case "tactile":
                case "floor-mark":
                    candidate.Set("variant", family.Variant.Length == 0 ? "guide" : family.Variant);
                    if (family.Type == "floor-mark" && request.LineId.Length > 0) candidate.Set("line", request.LineId);
                    break;
                case "clock":
                    if (family.Variant.Length > 0) candidate.Set("variant", family.Variant);
                    break;
                case "cctv":
                    candidate.Set("variant", family.Variant);
                    break;
                case "light":
                    candidate.Set("variant", family.Variant);
                    break;
                case "gate":
                    candidate.Set("dir", "both");
                    candidate.Set("door", "lane");
                    candidate.Set("variant", family.Variant);
                    break;
                case "extinguisher":
                case "cubicle":
                    if (family.Variant.Length > 0) candidate.Set("variant", family.Variant);
                    break;
                case "court":
                    candidate.Set("variant", family.Variant.Length == 0 ? "pickleball" : family.Variant);
                    break;
                case "roof": {
                    // `createModule('roof')`: one 1 × 1 slab, and the tool's 贴顶 toggle pins it
                    // to the lower or upper half of the cell it was dropped on. A truss bay is
                    // four cells along the run by the tool's breadth, centred on the aim.
                    if (StationRoofRules.IsVariant(family.Variant)) {
                        candidate.Width = StationRoofRules.Bay;
                        int depth = StationRoofRules.SupportedWidth(request.Width);
                        candidate.Depth = depth;
                        candidate.Set("variant", family.Variant);
                        StationFootprints.RotateLocal(candidate.Rotation, 0, -Math.Floor((depth - 1) / 2.0),
                            out var bdx, out var bdy);
                        candidate.X += (int)Math.Round(bdx);
                        candidate.Y += (int)Math.Round(bdy);
                        break;
                    }
                    candidate.Width = 1;
                    candidate.Depth = 1;
                    if (!string.IsNullOrEmpty(request.RoofPlateSnap))
                        candidate.Set("plateSnap", request.RoofPlateSnap);
                    break;
                }
                case "calligraphy": {
                    // The panel is cut from the name the station carries **now**, then frozen:
                    // `w` and `panelH` are stored rather than derived on load.
                    string hand = family.Variant.Length > 0 ? family.Variant : "kai-h";
                    int dash = hand.LastIndexOf('-');
                    string axis = dash >= 0 ? hand.Substring(dash + 1) : "h";
                    var geometry = StationCalligraphy.For(index?.Document?.Name, axis);
                    candidate.Width = geometry.Cells;
                    candidate.PanelHeight = geometry.PanelH;
                    candidate.Set("style", hand);
                    candidate.Set("axis", axis);
                    break;
                }
                case "billboard":
                    // `createModule('billboard-*')': the variant, the run width it fills, centred.
                    // The poster is rolled by the reference at commit from its poster catalogue
                    // (`randomAdSlug`); that catalogue is data this port has not imported, so a
                    // fresh board carries no `poster` and the view draws its placeholder.
                    candidate.Width = StationModuleFamilies.BillboardWidth(family.Variant);
                    candidate.Set("variant", family.Variant.Length == 0 ? "wide" : family.Variant);
                    break;
                case "sign": {
                    // `createModule('sign-*')': the mount, then the composed front. A wall sign has
                    // no back  the wall is behind it  so only the hung board could carry one,
                    // and a fresh board's back is empty either way.
                    string mount = family.Variant.Length == 0 ? "ceiling" : family.Variant;
                    candidate.Set("mount", mount);
                    var firstLine = StationRailPlanner.ResolveLine(index, request.LineId);
                    candidate.SetJson("front", StationSignLayouts.Default(firstLine));
                    candidate.SetJson("back", "[]");
                    break;
                }
                case "hanger":
                    // `createModule('hanger-*')`: the mount names the bar's support, and the run
                    // is the tool's 4/6/8-cell span centred on the aim.
                    candidate.Width = family.Width > 0 ? family.Width : 4;
                    candidate.Depth = 1;
                    candidate.Set("mount", family.Variant.Length == 0 ? "roof" : family.Variant);
                    break;
                case "pillar":
                    // `createModule('pillar-*')` + `mod.cfg.height = st.pillarLength`: the gauge
                    // comes from the palette id, the shaft from the armed 2–6 m section (`长` 5 m
                    // when the tool has none). A slim post's `rot` is its in-cell spot (0–8).
                    candidate.Set("size", family.Variant == "thick" ? "thick" : "slim");
                    int section = request.PillarLength > 0
                        ? StationPillarPlanning.Section(request.PillarLength)
                        : (index != null ? index.StoreyHeight : StationPillarPlanning.DefaultLength);
                    candidate.Set(section, "height");
                    break;
                case "shelf":
                    // `createModule('shelf-<variant>')`: the variant picks the run width.
                    candidate.Width = StationModuleFamilies.ShelfWidth(family.Variant);
                    candidate.Set("variant", family.Variant.Length == 0 ? "dark-tall" : family.Variant);
                    break;
                case "checkout":
                    // `createModule('checkout-<variant>')`: `counterLength(width)`, the tool's
                    // run length clamped to the four catalogue counters.
                    candidate.Width = Math.Max(1, Math.Min(4, request.Width > 0 ? request.Width : 1));
                    if (family.Variant.Length > 0) candidate.Set("variant", family.Variant);
                    break;
                case "linemap":
                    // `linemapSpec`'s mount; the two-cell board is centred on the aim.
                    candidate.Width = 2;
                    candidate.Set("mount", family.Variant.Length == 0 ? "wall" : family.Variant);
                    break;
                case "busstop": {
                    // `createModule`'s bus-shelter branch: 4 or 8 cells along the run, 2 deep,
                    // centred on the aim.
                    int run = family.Width >= 8 ? 8 : 4;
                    candidate.Width = run;
                    candidate.Depth = 2;
                    candidate.Set("variant", family.Variant.Length == 0 ? "short" : family.Variant);
                    StationFootprints.RotateLocal(candidate.Rotation, 0, -Math.Floor((2 - 1) / 2.0),
                        out var bdx, out var bdy);
                    candidate.X += (int)Math.Round(bdx);
                    candidate.Y += (int)Math.Round(bdy);
                    break;
                }
                case "psd-end":
                    // `createModule`'s psd-end branch: `psd: half` for the end panel, and
                    // `psd: full` + `variant: cover` for the corner cover.
                    if (string.Equals(family.Variant, "cover", StringComparison.Ordinal)) {
                        candidate.Set("psd", "full");
                        candidate.Set("variant", "cover");
                    } else {
                        candidate.Set("psd", "half");
                    }
                    break;
                case "stair-block": {
                    // `createModule`'s stair-block branch: one solid stair box anchored on the
                    // pressed cell, its top one course up, the height read from the tool.
                    candidate.Type = "stair";
                    StationFootprints.RotateLocal(candidate.Rotation, 1, 0, out var sdx, out var sdy);
                    candidate.From = new StationPoint(candidate.X - sdx, candidate.Y - sdy, candidate.Z);
                    candidate.To = new StationPoint(candidate.X + sdx, candidate.Y + sdy, candidate.Z + 1);
                    candidate.Set(1, "width");
                    candidate.Set(true, "block");
                    double blockHeight = request.BlockHeight > 0 ? request.BlockHeight : 1;
                    candidate.Set("blockHeight", blockHeight == 0.5 ? "0.5" : "1");
                    break;
                }
                case "lift": {
                    // `liftModule`: the base is the floor cell at the shaft's lower-left corner
                    // and it serves the floor one interval up.
                    int interval = request.LiftInterval > 0 ? request.LiftInterval : 5;
                    candidate.From = new StationPoint(candidate.X, candidate.Y, candidate.Z);
                    candidate.To = new StationPoint(candidate.X, candidate.Y, candidate.Z + interval);
                    candidate.SetJson("rises", "[" + interval.ToString(System.Globalization.CultureInfo.InvariantCulture) + "]");
                    if (request.LiftSizeLarge) candidate.Set("size", "large");
                    break;
                }
                case "walkway": {
                    // `walkwayModule`: a level run of whole cells along the stair facing, with
                    // its two endpoints authoritative for the length.
                    int run = request.WalkwayRun > 0 ? request.WalkwayRun : 30;
                    StairFacing(candidate.Rotation, out var wdx, out var wdy);
                    var near = new StationPoint(candidate.X, candidate.Y, candidate.Z);
                    var far = new StationPoint(candidate.X + wdx * run, candidate.Y + wdy * run, candidate.Z);
                    candidate.From = request.WalkwayDown ? far : near;
                    candidate.To = request.WalkwayDown ? near : far;
                    candidate.Set("dir", request.WalkwayDown ? "down" : "up");
                    if (request.Width > 1) candidate.Set(request.Width, "width");
                    break;
                }
                default:
                    // Every remaining migrated type has an empty authored cfg.
                    break;
            }
            // The 站台门 end panel seats itself on the nearest screen endpoint (or on the
            // glass plane a neighbouring panel holds) before the verdict runs; its cover stacks
            // on the full-height support under the click.
            if (string.Equals(candidate.Type, "psd-end", StringComparison.Ordinal)) {
                if (string.Equals(candidate.Text("variant"), "cover", StringComparison.Ordinal))
                    StationPsdEndRules.TrySnapCover(index, candidate, request.TargetModuleId);
                else
                    StationPsdEndRules.TrySnap(index, candidate);
            }
            draft = candidate;
            return true;
        }

        /// <summary>`cfg.flights` as the source's `createModule` writes one straight flight.</summary>
        static string FlightsJson(StationPoint from, StationPoint to) {
            string Point(StationPoint point) =>
                "{\"x\":" + Format(point.X) + ",\"y\":" + Format(point.Y) + ",\"z\":" + Format(point.Z) + "}";
            return "[{\"from\":" + Point(from) + ",\"to\":" + Point(to) + "}]";
        }

        static string Format(double value) =>
            value.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// The one candidate resolver for placement preview, drop and move (plan 16 §1.4).
    /// Inputs are the committed document, the tool's settings and one pick; the output
    /// is the normalized candidate plus a stable refusal code. Nothing here mutates the
    /// document, the history or the simulation.
    ///
    /// Ported from <c>app/tools/EquipmentTool.ts</c> (candidate construction) and
    /// <c>sim/placement.ts</c> (<c>moduleFloorOk</c>, <c>placementOnTrack</c>,
    /// <c>placementColliders</c>, <c>moveCandidate</c>, <c>movedModule</c>) for the
    /// migrated families. The order is the source's: build the candidate, apply its own
    /// snapping, then validate. A family the port does not cover is refused with
    /// <c>unsupported-family</c> before a commit can see it.
    /// </summary>
    public static class StationModulePlacement {
        /// <summary>
        /// Floor-standing pieces whose reserved volume must not share a block. The floor
        /// stickers are here for the same reason as a bench: a tactile tile or a vinyl mark
        /// is a slab at the floor top, and the source refuses it when its envelope crosses a
        /// block (`equipmentReason`'s flat-body list, which includes `isFloorSticker`).
        /// </summary>
        static readonly HashSet<string> BlockChecked = new HashSet<string>(StringComparer.Ordinal) {
            "gate", "tvm", "vending", "bench", "cubicle", "sink", "urinal",
            "bin", "extinguisher", "guidepost", "clock", "cctv", "tv", "sign", "linemap", "door",
            "tactile", "floor-mark", "court", "stair", "roof",
            "ac-unit", "electrical-cabinet", "rail-signal",
            "shelf", "checkout",
            // A 支柱 is a free-standing shaft: its envelope must not share a block (plan 28 §3).
            "pillar",
        };

        /// <summary>Resolve one request against the committed document.</summary>
        public static StationPlacementPlan Resolve(StationIndex index, StationPlacementRequest request) {
            var plan = new StationPlacementPlan();
            if (index == null) { plan.Reason = "no-document"; return plan; }
            if (request == null) { plan.Reason = "bad-request"; return plan; }
            StationEditDraft candidate;
            if (request.Carried != null) {
                candidate = MoveCandidate(index, request, out var moveReason);
                if (candidate == null) { plan.Reason = moveReason; return plan; }
                plan.IsMove = true;
            } else {
                // §5.2(b): a fresh ramp dropped inside a head-house's plate lands in the bay
                // under the pointer, not on the street cell the pointer hit (`exitRunSnap`).
                // The snap replaces the base and turn **before** the candidate's endpoints are
                // laid, which is the source's order in `buildPlacementModule`.
                StationExitBaySnap? baySnap = null;
                if (StationModuleFamilies.IsRamp(request.ToolType) && request.Hit.HasCell) {
                    StationModuleFamilies.RampSpec(request, out var run, out var rise);
                    if (StationExitSnapping.TrySnapRunToExitBay(index.Document.Modules,
                            request.Hit.X, request.Hit.Y, request.Hit.Z, run, rise, out var snap, out _)) {
                        baySnap = snap;
                    }
                }
                if (!StationModuleFamilies.TryCreate(index, request, baySnap, out candidate, out var createReason)) {
                    plan.Reason = createReason;
                    return plan;
                }
                // Plan 22 §2: a 门 dropped on a floor-standing 玻璃幕墙 fits into it
                // (`EquipmentTool`'s `snapDoorToCurtain`): the door takes the curtain's axis and
                // edge and centres its run on the curtain cell the pointer landed in. The source
                // runs this **before** validation, so the snapped door's own envelope is what the
                // clearance and collider checks read.
                if (candidate.Type == "door" && !string.IsNullOrEmpty(request.TargetModuleId) &&
                    index.TryGetModule(request.TargetModuleId, out var host) &&
                    TrySnapDoorToCurtain(index, candidate, host, request.ModulePoint, request.Hit)) {
                    // The candidate moved: keep the plan's cell fields in step below.
                }
                // §5.2(a): a fresh head-house dropped on a picked ramp wraps that ramp's upper
                // landing (`snapExitToRamp`). The source falls back to the unsnapped candidate
                // when the pick is not a supported ramp, so a missing/failed snap is not a
                // refusal here.
                if (candidate.Type == "exit") {
                    candidate.Set("name", StationModuleFamilies.NextExitLetter(index));
                    if (!string.IsNullOrEmpty(request.TargetModuleId) &&
                        index.TryGetModule(request.TargetModuleId, out var ramp) &&
                        StationExitSnapping.TrySnapExitToRamp(ToRecord(candidate), ramp, out var exitSnap, out _)) {
                        candidate.X = (int)Math.Round(exitSnap.X);
                        candidate.Y = (int)Math.Round(exitSnap.Y);
                        candidate.Z = (int)Math.Round(exitSnap.Z);
                        candidate.Rotation = exitSnap.Rotation;
                    }
                }
            }
            plan.Candidate = candidate;
            plan.CellX = candidate.X;
            plan.CellY = candidate.Y;
            plan.CellZ = candidate.Z;
            // A fresh run's corridor (`sim/openings.ts` `rampEnvelope`) and the **carve** that
            // shaves the blocks it passes through are one rule, committed together: the run
            // reserves its corridor and, in the same revision, `StationRampCarve` opens the
            // blocks the corridor sweeps. Only a straight single flight is ported, so a turning
            // run keeps its own stable refusal. A 楼梯块 is not a flight — it is one solid box —
            // so it takes the ordinary clearance path.
            if (request.Carried == null && StationModuleFamilies.IsRamp(candidate.Type) && !candidate.Bool("block")) {
                var record = ToRecord(candidate);
                plan.Reason = StationRampRules.IsStraightRun(record)
                    ? Validate(index, candidate, request.Carried, plan.ColliderIds, plan.UnverifiedIds)
                    : "ramp-turning-unported";
            } else {
                plan.Reason = Validate(index, candidate, request.Carried, plan.ColliderIds, plan.UnverifiedIds);
            }
            plan.SupportId = Support(index, candidate);
            return plan;
        }

        /// <summary>
        /// `snapDoorToCurtain`: fit a 门 dropped on a floor-standing 玻璃幕墙 into it. The door
        /// takes the curtain's axis and edge and centres its run on the run cell the pointer
        /// landed in, clamped so a 双开 leaf stays inside the panel. Returns false — leaving the
        /// door exactly where it was aimed — when the pick is not a curtain, is on another
        /// storey, or the run is too short for the door.
        /// </summary>
        static bool TrySnapDoorToCurtain(StationIndex index, StationEditDraft door, StationModuleRecord host,
            StationPoint? point, StationPlacementHit hit) {
            if (host == null || !string.Equals(host.Type, "glass", StringComparison.Ordinal)) return false;
            if (!StationFootprints.GlassStandsOnFloor(host.Config)) return false;
            if (host.Z != door.Z) return false;
            int cellX, cellY;
            if (point.HasValue) {
                // The ray met the curtain's own drawn face: that is the run cell under the pointer.
                cellX = (int)Math.Floor(point.Value.X);
                cellY = (int)Math.Floor(point.Value.Y);
            } else if (hit.HasCell) {
                cellX = hit.Solid ? hit.X : hit.PlaceX;
                cellY = hit.Solid ? hit.Y : hit.PlaceY;
            } else {
                return false;
            }
            var run = RunCells(host);
            int at = run.FindIndex(cell => cell.X == cellX && cell.Y == cellY);
            if (at < 0) return false;
            int width = Math.Max(1, door.Width);
            if (width > run.Count) return false;
            int first = Math.Max(0, Math.Min(run.Count - width, at - (width - 1) / 2));
            door.X = (int)Math.Round(run[first].X);
            door.Y = (int)Math.Round(run[first].Y);
            door.Rotation = StationFootprints.NormRot(host.Rotation);
            return true;
        }

        /// <summary>The cells a run covers, marched in its own turn (`track.rotateLocal`).</summary>
        static List<StationPoint> RunCells(StationModuleRecord record) {
            int width = Math.Max(1, record.Width);
            var cells = new List<StationPoint>(width);
            for (int i = 0; i < width; i++) {
                StationFootprints.RotateLocal(record.Rotation, i, 0, out var dx, out var dy);
                cells.Add(new StationPoint(record.X + (int)Math.Round(dx), record.Y + (int)Math.Round(dy), record.Z));
            }
            return cells;
        }

        /// <summary>
        /// The surface anchor a fresh piece or a carried one aims at. Port of
        /// <c>moduleAim</c>'s floor branch: a solid hit (or an exit pad floor) anchors on the
        /// block it hit, while an open-air plane or wall-adjacent hit anchors on the placement
        /// cell in front of the surface.
        /// </summary>
        public static StationPoint AimCell(StationPlacementRequest request) => AimCell(null, request);

        public static StationPoint AimCell(StationIndex index, StationPlacementRequest request) {
            var hit = request.Hit;
            var pieceType = request.Carried != null ? request.Carried.Type : request.ToolType;
            var pieceConfig = request.Carried != null ? request.Carried.Config : null;
            // A wall piece is hung on a column's face: the hit names the course and the piece
            // stands on the floor at that column's foot (`moduleAim`'s wall branch).
            bool wallPiece = request.Carried != null
                ? StationFootprints.IsWallMounted(request.Carried)
                : StationModuleFamilies.IsWallPalette(request.ToolType);
            if (wallPiece) {
                string kind = pieceType;
                if (request.Carried == null &&
                    StationModuleFamilies.TryParse(request.ToolType, request.Variant, request.Width, out var family))
                    kind = family.Type;
                bool follow = StationWallAim.FollowsCourse(kind, pieceConfig);
                bool snap = request.Carried != null
                    ? string.Equals(request.Carried.Type, "exit", StringComparison.Ordinal)
                    : (request.ToolType ?? "").StartsWith("exit-doorway-", StringComparison.Ordinal);
                return StationWallAim.StandCell(index, hit, snap, follow);
            }
            // A ceiling-hung piece hangs from the underside overhead, not from the floor it is
            // pointed at (`moduleAim`'s ceiling branch).
            if (StationCeilingAim.IsCeilingPiece(pieceType, pieceConfig)) {
                return StationCeilingAim.Aim(index, request, pieceType);
            }
            bool onSurface = hit.Solid ||
                (index != null && StationFootprints.IsExitFloorAt(index, hit.X, hit.Y, hit.Z));
            return onSurface
                ? new StationPoint(hit.X, hit.Y, hit.Z)
                : new StationPoint(hit.PlaceX, hit.PlaceY, hit.PlaceZ);
        }

        /// <summary>The carried piece at its aimed cell and turn (<c>moveCandidate</c> without its sign snap).</summary>
        static StationEditDraft MoveCandidate(StationIndex index, StationPlacementRequest request, out string reason) {
            reason = "";
            var source = request.Carried;
            if (!request.Hit.HasCell) { reason = "no-hit"; return null; }
            // A wall panel and a hung fitting anchor on their support, not on the floor
            // the pointer is over (`moduleAim`'s wall/ceiling branches). A visible hanger
            // hit supplies its own bar anchor; other wall/ceiling mounts keep their explicit
            // refusal until wall/ceiling plane aim is ported.
            bool hangerAim = StationFootprints.IsCeilingHung(source) &&
                HangerAcceptsPiece(source.Type, source.Config.Text("variant"), source.Config.Text("mount")) &&
                index != null && !string.IsNullOrEmpty(request.TargetModuleId) &&
                index.TryGetModule(request.TargetModuleId, out var host) &&
                string.Equals(host.Type, "hanger", StringComparison.Ordinal);
            // A hung fitting moves with the same ceiling aim a fresh one uses: it hangs from the
            // slab overhead or from a visible hanger's bar; with neither, the move is refused.
            var at = AimCell(index, request);
            int x = (int)Math.Round(at.X), y = (int)Math.Round(at.Y), z = (int)Math.Round(at.Z);
            if (StationFootprints.IsCeilingHung(source) && !hangerAim &&
                !(index != null && StationFootprints.IsSolidAt(index, x, y, z + 1))) {
                reason = "unsupported-mount";
                return null;
            }
            int rot = StationFootprints.NormRot(request.Rotation);
            var draft = DraftOf(source);
            draft.Id = source.Id;
            draft.SourceId = source.Id;
            if (StationFootprints.IsCeilingHung(source) && !hangerAim) draft.CeilingAnchored = true;
            // A run's own endpoints are world cells: re-lay them about the carried
            // anchor, stepped in the piece's turn convention (`movedModule`).
            if (source.Type == "stair" || source.Type == "escalator" || source.Type == "walkway") {
                if (!source.From.HasValue || !source.To.HasValue) { reason = "unsupported-family"; return null; }
                reason = "unsupported-family";
                return null;
            }
            // A ground 出入口 keeps the offset of the course it was mounted on.
            if (source.Type == "exit" && source.Config.Text("style") == "doorway" && source.Config.Has("mountZ")) {
                draft.Set("mountZ", FormatNumber(z + (source.Config.Number("mountZ", source.Z) - source.Z)));
            }
            draft.X = x;
            draft.Y = y;
            draft.Z = z;
            draft.Rotation = rot;
            return draft;
        }

        /// <summary>A draft that carries one placed record's authored facts unchanged.</summary>
        public static StationEditDraft DraftOf(StationModuleRecord record) {
            var draft = new StationEditDraft {
                Id = record.Id, Type = record.Type, X = record.X, Y = record.Y, Z = record.Z,
                Rotation = record.Rotation, Width = record.Width, Depth = record.Depth, Height = record.Height,
                CeilingAnchored = record.CeilingAnchored, From = record.From, To = record.To,
                PanelHeight = record.PanelHeight, OffsetX = record.OffsetX, OffsetY = record.OffsetY,
                SourceId = record.Id,
            };
            var config = record.Config;
            foreach (var key in config.Keys) {
                var text = config.Text(key);
                if (text.Length == 0) continue;
                if (text[0] == '{' || text[0] == '[') draft.SetJson(key, text);
                else draft.Set(key, text);
            }
            return draft;
        }

        /// <summary>The candidate as the typed record the footprint and clearance ports read.</summary>
        public static StationModuleRecord ToRecord(StationEditDraft draft) {
            var facts = new ModuleFacts {
                Id = draft.Id, Type = draft.Type, X = draft.X, Y = draft.Y, Z = draft.Z,
                Rotation = draft.Rotation, Width = draft.Width, Depth = draft.Depth,
                CeilingAnchored = draft.CeilingAnchored,
                Config = new ModuleConfig(draft.Config),
            };
            if (draft.From.HasValue) facts.From = new ModuleFacts.Point {
                X = (int)Math.Round(draft.From.Value.X), Y = (int)Math.Round(draft.From.Value.Y),
                Z = (int)Math.Round(draft.From.Value.Z), HasValue = true,
            };
            if (draft.To.HasValue) facts.To = new ModuleFacts.Point {
                X = (int)Math.Round(draft.To.Value.X), Y = (int)Math.Round(draft.To.Value.Y),
                Z = (int)Math.Round(draft.To.Value.Z), HasValue = true,
            };
            return new StationModuleRecord(draft.Id, draft.Type, draft.X, draft.Y, draft.Z, draft.Rotation,
                draft.Width, draft.Depth, draft.Height, draft.CeilingAnchored, draft.From, draft.To,
                Array.Empty<string>(), "", facts, draft.PanelHeight, draft.OffsetX, draft.OffsetY);
        }

        /// <summary>
        /// The source's validation order for one candidate: opening/layer rules, the
        /// flat body's block overlap, the ground under its footprint, the rail bed, other
        /// pieces, then the wall/ceiling support its mount needs.
        /// </summary>
        static string Validate(StationIndex index, StationEditDraft draft, StationModuleRecord carried,
            List<string> colliders, List<string> unverified) {
            var record = ToRecord(draft);
            if (!StationFootprints.TryClearance(record, out var box, out _)) return "unsupported-family";
            // A doorway exit is a shallow sign on a block face: it may sit at any height
            // at or above the ground, while a real head-house belongs to the street.
            if (draft.Type == "exit") {
                var style = draft.Text("style");
                bool placed = carried == null;
                if (style == "doorway") {
                    if (placed && draft.Z < 0) return "exit-below-ground";
                } else if (style == "virtual") {
                    if (draft.Z < 0) return "outdoor-below-ground";
                } else if (placed && (draft.Z < 0 || draft.Z > 3)) {
                    return "exit-on-slab";
                }
            }
            // A street tree is surface decor: it never grows below the street plane. A shelter
            // and a traffic light are the same (`equipmentReason`'s outdoor-below-ground group).
            if (draft.Z < 0 && (draft.Type == "tree" || draft.Type == "busstop" || draft.Type == "traffic-light" ||
                                draft.Type == "guidepost")) return "outdoor-below-ground";
            // A flat body must not intersect a block. Wall and ceiling mounts reserve a
            // panel band or a hung column instead and are answered by their own rule.
            bool hung = StationFootprints.IsCeilingHung(record);
            bool wall = StationFootprints.IsWallMounted(record);
            // A run's own corridor cuts the blocks it passes through (StationRampCarve), and
            // the cut keeps the floor its base stands on, so the run is not refused for the
            // ground it is about to open. A 楼梯块 is a solid box and keeps the block test.
            bool run = StationModuleFamilies.IsRamp(draft.Type) && !draft.Bool("block");
            if (!hung && !wall && !run && BlockChecked.Contains(draft.Type)) {
                foreach (var cell in index.Document.Cells) {
                    if (!cell.IsSolid) continue;
                    var unit = new StationBox(cell.X, cell.Y, cell.Z, cell.X + 1, cell.Y + 1, cell.Z + 1);
                    if (box.Overlaps(unit)) return "occupied";
                }
            }
            // The pieces in the way are a property of the *candidate*, not of the refusal that
            // happens to come first: the source's callers read `placementColliders` beside
            // `equipmentReason`, so a refused placement still names what it would have hit.
            CollectColliders(index, record, box, colliders, unverified);
            if (!hung && draft.Type != "escalator" && draft.Type != "roof") {
                bool floorOk;
                try { floorOk = StationFootprints.ModuleFloorOk(record, index); }
                catch (NotSupportedException) { return "unsupported-family"; }
                if (!floorOk) return draft.Type == "lift" ? "lift-footprint" : "floor";
                // A 自动步道 lies on the floor for its whole run: the belt is a surface over
                // solid ground, not a hole (`walkways.ts`: "the floor it lies on must be there").
                if (draft.Type == "walkway" && !StationFootprints.WalkwayFloorOk(record, index)) return "floor";
            }
            if (PlacementOnTrack(index, draft, record, hung)) return "track";
            // A canopy stands on its posts, so those cells need floor even though the roof
            // itself skips the floor rule (`moduleFloorOk`'s canopy footprint).
            if (string.Equals(draft.Type, "roof", StringComparison.Ordinal) &&
                string.Equals(draft.Text("variant"), "canopy", StringComparison.Ordinal)) {
                foreach (var post in StationRoofRules.PostCells(record)) {
                    if (StationFootprints.IsSolidAt(index, post.X, post.Y, post.Z)) continue;
                    return "floor";
                }
            }
            if (colliders.Count > 0) return "occupied";
            if (wall && !WallSupport(index, record)) return "wall";
            if (hung && !CeilingSupport(index, record, draft)) return "ceiling";
            return "";
        }

        /// <summary>
        /// The validation half of <see cref="Resolve"/> for a **rewritten** piece (plan 28 §3: a
        /// 支柱 grown by one armed section). The candidate keeps the placed record's id, so the
        /// collider walk skips the old shaft itself and judges only the span the growth adds.
        /// </summary>
        public static string ValidateExtension(StationIndex index, StationModuleRecord carried,
            StationEditDraft draft, List<string> colliders, List<string> unverified) {
            if (index == null || draft == null) return "no-document";
            var record = ToRecord(draft);
            if (!StationFootprints.TryClearance(record, out _, out _)) return "unsupported-family";
            return Validate(index, draft, carried, colliders, unverified);
        }

        /// <summary>
        /// Port of <c>placementOnTrack</c>: the cells a piece is anchored by, the visible
        /// <c>floor.track</c> finish, a dug bed (a track module's cells) and — for a
        /// floor-standing piece — the trench one course above.
        /// </summary>
        static bool PlacementOnTrack(StationIndex index, StationEditDraft draft, StationModuleRecord record, bool hung) {
            StationPoint[] baseCells;
            try { baseCells = BaseCells(record); }
            catch (NotSupportedException) { baseCells = new[] { record.Point }; }
            foreach (var cell in baseCells) {
                int x = (int)Math.Round(cell.X), y = (int)Math.Round(cell.Y);
                var authored = index.GetCell(x, y, draft.Z);
                if (authored != null && authored.IsSolid &&
                    string.Equals(authored.FinishTop, "floor.track", StringComparison.Ordinal)) return true;
                if (TrackCellAt(index, x, y, draft.Z)) return true;
                if (!hung && TrackCellAt(index, x, y, draft.Z + 1)) return true;
            }
            return false;
        }

        /// <summary>The cells a piece is anchored by (<c>baseCells</c>): a run/room its footprint, everything else its own cell.</summary>
        static StationPoint[] BaseCells(StationModuleRecord record) {            switch (record.Type) {
                case "exit":
                    return new[] { record.Point };
                case "retail":
                case "shop":
                case "booth":
                case "platform-edge":
                case "billboard":
                case "glass":
                case "calligraphy":
                case "linemap":
                case "monitor":
                case "busstop":
                case "shelf":
                case "checkout":
                case "bench":
                case "extinguisher":
                case "hanger":
                case "door":
                case "court":
                case "track":
                case "lift":
                    return StationFootprints.Footprint(record);
                default:
                    return new[] { record.Point };
            }
        }

        static bool TrackCellAt(StationIndex index, int x, int y, int z) {
            foreach (var track in index.ModulesOfType("track")) {
                if (track.Z != z) continue;
                foreach (var cell in StationFootprints.TrackCells(track))
                    if (cell.X == x && cell.Y == y) return true;
            }
            return false;
        }

        /// <summary>
        /// Port of <c>placementColliders</c> for the migrated families. The source's
        /// documented exceptions that concern these families are kept — a piece never
        /// collides with itself, an exit shares space with a stair/escalator, and a floor
        /// sticker lies under a screen-door strip or a gate leaf — while a neighbour
        /// whose envelope this packet cannot derive is reported, not guessed.
        /// </summary>
        static void CollectColliders(StationIndex index, StationModuleRecord candidate, StationBox box,
            List<string> colliders, List<string> unverified) {
            bool candidateSticker = IsFloorSticker(candidate.Type);
            bool candidateOutdoor = IsOutdoorSurface(candidate.Type);
            foreach (var placed in index.Document.Modules) {
                if (string.Equals(placed.Id, candidate.Id, StringComparison.Ordinal)) continue;
                // The source's outdoor-surface pair rule (`placementColliders`): paving never
                // collides with equipment standing on it, and equipment never collides with
                // paving unless the candidate is paving itself or a road. Without this a
                // bench could never be placed on Zoo's sidewalk (the paving's 0.1 m slab
                // shares the bench's standing box).
                bool placedOutdoor = IsOutdoorSurface(placed.Type);
                if (placedOutdoor && !candidateOutdoor && candidate.Type != "road") continue;
                if (candidateOutdoor && !placedOutdoor && placed.Type != "road") continue;
                if (IsExitRampPair(candidate, placed)) continue;
                if (HangerSupports(placed, candidate) || HangerSupports(candidate, placed)) continue;
                // Plan 22 §2: the glass exceptions the source documents (`placementColliders`).
                // A 门 fitted into a curtain shares its tile and plane by design, an edge-decor
                // piece backed against a curtain steps clear of it, and two floor-standing
                // curtains that cross on one tile are one joined corner rather than a collision.
                if (GlassDoorShare(candidate, placed)) continue;
                if (EdgeDecorGlassShare(candidate, placed)) continue;
                if (string.Equals(candidate.Type, "glass", StringComparison.Ordinal) &&
                    string.Equals(placed.Type, "glass", StringComparison.Ordinal) &&
                    GlassCrossTile(candidate, placed)) continue;
                if (candidateSticker && (placed.Type == "platform-edge" ||
                    (placed.Type == "fence" && string.Equals(placed.Config.Text("variant"), "gate", StringComparison.Ordinal)))) continue;
                if (IsFloorSticker(placed.Type) && (candidate.Type == "platform-edge" ||
                    (candidate.Type == "fence" && string.Equals(candidate.Config.Text("variant"), "gate", StringComparison.Ordinal)))) continue;
                if (!StationFootprints.TryClearance(placed, out var other, out _)) {
                    unverified.Add(placed.Id);
                    continue;
                }
                if (other.IsEmpty) continue;
                if (CourtDividerClearsNet(candidate, box, placed, other)) continue;
                if (!box.Overlaps(other)) continue;
                colliders.Add(placed.Id);
            }
        }

        /// <summary>
        /// Port of <c>placementColliders</c>'s court rule: portable dividers can stand on the
        /// painted court surface while its centre net and posts remain solid.
        /// </summary>
        static bool CourtDividerClearsNet(StationModuleRecord candidate, StationBox candidateBox,
            StationModuleRecord placed, StationBox placedBox) {
            if (!string.Equals(candidate.Type, "court", StringComparison.Ordinal) ||
                !string.Equals(placed.Type, "court", StringComparison.Ordinal)) return false;
            bool candidateDivider = string.Equals(candidate.Config.Text("variant"), "divider", StringComparison.Ordinal);
            bool placedDivider = string.Equals(placed.Config.Text("variant"), "divider", StringComparison.Ordinal);
            if (candidateDivider == placedDivider) return false;
            var field = candidateDivider ? placed : candidate;
            var fieldBox = candidateDivider ? placedBox : candidateBox;
            var dividerBox = candidateDivider ? candidateBox : placedBox;
            double cx = (fieldBox.X0 + fieldBox.X1) * 0.5;
            double cy = (fieldBox.Y0 + fieldBox.Y1) * 0.5;
            bool acrossX = (StationFootprints.NormRot(field.Rotation) % 2) == 1;
            var net = new StationBox(
                acrossX ? fieldBox.X0 : cx - 0.2,
                acrossX ? cy - 0.2 : fieldBox.Y0,
                fieldBox.Z0,
                acrossX ? fieldBox.X1 : cx + 0.2,
                acrossX ? cy + 0.2 : fieldBox.Y1,
                fieldBox.Z1);
            return !net.Overlaps(dividerBox);
        }

        static bool IsFloorSticker(string type) => type == "tactile" || type == "floor-mark";

        /// <summary>`isEdgeDecor`: floor decor drawn against its tile's trailing edge.</summary>
        static bool IsEdgeDecor(string type) =>
            type == "bin" || type == "extinguisher" || type == "shelf" || type == "tvm" || type == "vending";

        /// <summary>`curtainDoorShare`: a 门 fitted into a floor-standing 玻璃幕墙.</summary>
        static bool GlassDoorShare(StationModuleRecord a, StationModuleRecord b) {
            var glass = string.Equals(a.Type, "glass", StringComparison.Ordinal) ? a
                : string.Equals(b.Type, "glass", StringComparison.Ordinal) ? b : null;
            var door = string.Equals(a.Type, "door", StringComparison.Ordinal) ? a
                : string.Equals(b.Type, "door", StringComparison.Ordinal) ? b : null;
            if (glass == null || door == null) return false;
            if (glass.Z != door.Z) return false;
            if (StationFootprints.NormRot(glass.Rotation) != StationFootprints.NormRot(door.Rotation)) return false;
            if (!StationFootprints.GlassStandsOnFloor(glass.Config)) return false;
            var wall = new HashSet<string>(StringComparer.Ordinal);
            foreach (var cell in RunCells(glass)) wall.Add(cell.X + "," + cell.Y);
            foreach (var cell in RunCells(door))
                if (!wall.Contains(cell.X + "," + cell.Y)) return false;
            return true;
        }

        /// <summary>
        /// `edgeDecorCurtainShare`: a floor decor piece backed against a floor-standing curtain in
        /// the same tile  same storey, opposite wall sides, overlapping the curtain's run.
        /// </summary>
        static bool EdgeDecorGlassShare(StationModuleRecord a, StationModuleRecord b) {
            var glass = string.Equals(a.Type, "glass", StringComparison.Ordinal) ? a
                : string.Equals(b.Type, "glass", StringComparison.Ordinal) ? b : null;
            var decor = !string.Equals(a.Type, "glass", StringComparison.Ordinal) && IsEdgeDecor(a.Type) ? a
                : !string.Equals(b.Type, "glass", StringComparison.Ordinal) && IsEdgeDecor(b.Type) ? b : null;
            if (glass == null || decor == null) return false;
            if (glass.Z != decor.Z) return false;
            if (!StationFootprints.GlassStandsOnFloor(glass.Config)) return false;
            StationFootprints.WallSide(glass.Rotation, out var gx, out var gy);
            StationFootprints.WallSide(decor.Rotation, out var dx, out var dy);
            if (dx != -gx || dy != -gy) return false;
            var curtain = new HashSet<string>(StringComparer.Ordinal);
            foreach (var cell in RunCells(glass)) curtain.Add(cell.X + "," + cell.Y);
            foreach (var cell in CurtainFootprint(decor))
                if (curtain.Contains(cell.X + "," + cell.Y)) return true;
            return false;
        }

        /// <summary>`moduleFootprint` for the edge-decor families (a run or the anchor cell).</summary>
        static IReadOnlyList<StationPoint> CurtainFootprint(StationModuleRecord record) {
            try { return StationFootprints.Footprint(record); } catch (NotSupportedException) {
                return new[] { record.Point };
            }
        }

        /// <summary>`curtainShareCrossTile`: two floor-standing curtains on opposite sides of one tile.</summary>
        static bool GlassCrossTile(StationModuleRecord a, StationModuleRecord b) {
            if (a == null || b == null) return false;
            if (a.Z != b.Z || StationFootprints.NormRot(a.Rotation) == StationFootprints.NormRot(b.Rotation)) return false;
            if (!StationFootprints.GlassStandsOnFloor(a.Config) || !StationFootprints.GlassStandsOnFloor(b.Config)) return false;
            var cellsA = RunCells(a);
            var cellsB = RunCells(b);
            foreach (var cell in cellsA)
                foreach (var other in cellsB)
                    if (cell.X == other.X && cell.Y == other.Y) return true;
            return false;
        }

        /// <summary>Port of <c>isOutdoorSurface</c>: the paving modules a piece stands on.</summary>
        static bool IsOutdoorSurface(string type) => type == "sidewalk" || type == "lawn";

        static bool IsExitRampPair(StationModuleRecord a, StationModuleRecord b) {
            bool exit = a.Type == "exit" && (b.Type == "escalator" || (b.Type == "stair" && !b.Config.Bool("block")));
            bool reverse = b.Type == "exit" && (a.Type == "escalator" || (a.Type == "stair" && !a.Config.Bool("block")));
            return exit || reverse;
        }

        /// <summary>
        /// The wall a panel bolts to: the cell step from the module's saved turn, over the
        /// courses <c>sim/placement.ts</c> reads (<c>wallMountCourses</c>). A solid block at
        /// any of them behind the panel holds it.
        /// </summary>
        static bool WallSupport(StationIndex index, StationModuleRecord record) {
            StationFootprints.WallSide(record.Rotation, out var dx, out var dy);
            int bx = record.X + dx, by = record.Y + dy;
            var courses = StationFootprints.WallCourses(record);
            if (courses.Length == 0) courses = new[] { record.Z };
            foreach (var course in courses) {
                if (StationFootprints.IsSolidAt(index, bx, by, course)) return true;
                // A wall is built as a block whose top is the panel's course; the course
                // list is absolute, so a solid at either the course or the one below holds.
                if (StationFootprints.IsSolidAt(index, bx, by, course - 1)) return true;
            }
            return false;
        }

        /// <summary>
        /// Port of <c>ceilingMountMissing</c> for the migrated hung families: the slab the
        /// piece hangs from is the block directly above its stand cell (a 吊顶 or an
        /// ordinary top block), or the nominal storey ceiling for a fixture.
        /// </summary>
        static bool CeilingSupport(StationIndex index, StationModuleRecord record, StationEditDraft draft) {
            if (StationFootprints.IsSolidAt(index, draft.X, draft.Y, draft.Z + 1)) return true;
            if (StationFootprints.IsSolidAt(index, draft.X, draft.Y, draft.Z + 4)) return true;
            foreach (var module in index.Document.Modules) {
                if (string.Equals(module.Id, draft.SourceId, StringComparison.Ordinal)) continue;
                if (HangerSupports(module, record)) return true;
            }
            return false;
        }

        /// <summary>True when a piece family/variant can hang from a steel <c>hanger</c> beam (<c>placementSurface.ts</c>).</summary>
        public static bool HangerAcceptsPiece(string type, string variant, string mount) {
            if (string.Equals(type, "tv", StringComparison.Ordinal) ||
                string.Equals(type, "clock", StringComparison.Ordinal)) return true;
            if (string.Equals(type, "cctv", StringComparison.Ordinal))
                return !string.Equals(variant, "post", StringComparison.Ordinal);
            if (string.Equals(type, "sign", StringComparison.Ordinal))
                return !string.Equals(mount, "wall", StringComparison.Ordinal);
            return false;
        }

        /// <summary>Port of <c>sim/hangers.ts:hangerSupports</c>: hanging rods must land on the bar centreline.</summary>
        public static bool HangerSupports(StationModuleRecord hanger, StationModuleRecord item) {
            if (hanger == null || item == null) return false;
            if (!string.Equals(hanger.Type, "hanger", StringComparison.Ordinal) || hanger.Z != item.Z) return false;
            if (!HangerAcceptsPiece(item.Type, item.Config.Text("variant"), item.Config.Text("mount"))) return false;
            bool onCell = false;
            int width = Math.Max(1, hanger.Width);
            for (int i = 0; i < width; i++) {
                StationFootprints.RotateLocal(hanger.Rotation, i, 0, out var dx, out var dy);
                if (hanger.X + (int)Math.Round(dx) == item.X && hanger.Y + (int)Math.Round(dy) == item.Y) {
                    onCell = true;
                    break;
                }
            }
            if (!onCell) return false;
            bool centredClock = string.Equals(item.Type, "clock", StringComparison.Ordinal) &&
                !string.Equals(item.Config.Text("variant"), "digital", StringComparison.Ordinal);
            if (!centredClock && ((item.Rotation - hanger.Rotation) % 2) != 0) return false;
            StationFootprints.RotateLocal(-hanger.Rotation, item.X - hanger.X, item.Y - hanger.Y, out var along, out _);
            double rodHalf = string.Equals(item.Type, "sign", StringComparison.Ordinal)
                ? Math.Max(0.22, StationFootprints.SignBoardWidth(item.Config) * 0.5 - 0.35) + 0.08
                : string.Equals(item.Type, "tv", StringComparison.Ordinal) ? 0.5
                : string.Equals(item.Type, "cctv", StringComparison.Ordinal) ? 0.18
                : centredClock ? 0.075
                : 0.32 + 0.09 * 0.5;
            return along + 0.5 - rodHalf >= 0.0 && along + 0.5 + rodHalf <= width;
        }

        /// <summary>The module a piece stands on / hangs from, for the plan's support id.</summary>
        static string Support(StationIndex index, StationEditDraft draft) {
            var candidate = ToRecord(draft);
            foreach (var module in index.Document.Modules) {
                if (string.Equals(module.Id, draft.SourceId, StringComparison.Ordinal)) continue;
                if (HangerSupports(module, candidate)) return module.Id;
                if (module.Type != "exit" || module.Z != draft.Z) continue;
                var style = module.Config.Text("style");
                if (style == "doorway" || style == "virtual") continue;
                foreach (var cell in StationFootprints.ExitFootprint(module))
                    if ((int)Math.Round(cell.X) == draft.X && (int)Math.Round(cell.Y) == draft.Y) return module.Id;
            }
            return "";
        }

        /// <summary>The first module id of the form <c>&lt;type&gt;-N</c> free in the document.</summary>
        public static string NextId(StationIndex index, string type) {
            int n = index.Document.ModuleCount + 1;
            while (index.GetModule(type + "-" + n) != null) n++;
            return type + "-" + n;
        }

        static string FormatNumber(double value) =>
            value.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
    }
}
