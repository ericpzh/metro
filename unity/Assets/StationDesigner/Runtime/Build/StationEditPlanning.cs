using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// A module being placed or carried, before it reaches the save. It mirrors the
    /// authored v1 record â€” type, anchor, turn, run dimensions, the flattened
    /// <c>cfg</c> â€” so the same value drives the ghost, the refusal and the commit
    /// (plan 16 Â§1.4: "preview and commit pass one candidate").
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
        /// <summary>Authored <c>h</c> of a hanging panel (a ç«™å's printed height), 0 when absent.</summary>
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
        public StationPlacementHit(int x, int y, int z, int px, int py, int pz, bool solid, StationPoint point, double surfaceZ) {
            X = x; Y = y; Z = z; PlaceX = px; PlaceY = py; PlaceZ = pz;
            Solid = solid; Point = point; SurfaceZ = surfaceZ;
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
        public bool HasCell => X != int.MinValue;
        public static StationPlacementHit None => new StationPlacementHit(int.MinValue, 0, 0, 0, 0, 0, false, new StationPoint(0, 0, 0), 0);

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
            return new StationPlacementHit(x, y, z, x + stepX, y + stepY, z + stepZ, solid, point, surfaceZ);
        }
    }

    /// <summary>What a tool asks the resolver: the pointer hit, the tool's settings and, for a move, the carried record.</summary>
    public sealed class StationPlacementRequest {
        /// <summary>The palette/type id the tool would place (`bench-steel-1`, `fence`, â€¦).</summary>
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
        /// <summary>The record a ç§»åŠ¨ carries; null for a fresh placement.</summary>
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
        /// family's own default (æ¥¼æ¢¯ é•¿ 8 cells, æ‰¶æ¢¯ é•¿ 9 at 30Â°).</summary>
        public double RunLength;
        /// <summary>A ramp's chosen climb in metres; 0 reads the é•¿ 5 m rung.</summary>
        public double RunRise;
    }

    /// <summary>One immutable answer: the candidate, its support, its collisions and a stable reason code.</summary>
    public sealed class StationPlacementPlan {
        public bool Ok => string.IsNullOrEmpty(Reason);
        /// <summary>The normalized candidate, or null when the request never produced a piece.</summary>
        public StationEditDraft Candidate;
        /// <summary>Stable refusal code (`floor`, `occupied`, `track`, `wall`, `ceiling`, `unsupported-family`, â€¦).</summary>
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
    /// the migrated families only: every other type says so (plan 16 Â§1.4 â€”
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
        /// `rampSnapSpec` (the é•¿ 5 m rung, 8 cells for a stair and 9 for the 30Â° escalator)
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
            } else if (TryParseExit(id, out _, out _)) {
                // A head-house is a creatable family; its palette id carries the cover and bay
                // count, read again in `TryCreate`. Doorway/virtual exits are wall/surface
                // mounts of their own and stay unsupported here.
                parsed.Type = "exit";
                parsed.Variant = id;
            } else if (id == "stair" || id == "stair-straight") {
                parsed.Type = "stair";
            } else if (id == "escalator") {
                parsed.Type = "escalator";
            } else {
                return false;
            }
            if (!string.IsNullOrEmpty(variantOverride)) parsed.Variant = variantOverride;
            if (width > 0 && (parsed.Type == "bench" || parsed.Type == "monitor")) parsed.Width = width;
            family = parsed;
            return true;
        }

        /// <summary>Build the fresh candidate at a whole cell (<c>createModule</c>'s migrated branches).</summary>
        public static bool TryCreate(StationPlacementRequest request, out StationEditDraft draft, out string reason) =>
            TryCreate(request, null, out draft, out reason);

        /// <summary>
        /// Build the fresh candidate, honouring the exit-bay snap an escalated ramp takes
        /// (`exitRunSnap`): <paramref name="baySnap"/> replaces the pointer cell and turn with
        /// the run's upper landing in the bay the pointer is inside.
        /// </summary>
        public static bool TryCreate(StationPlacementRequest request, StationExitBaySnap? baySnap,
            out StationEditDraft draft, out string reason) {
            reason = "";
            draft = null;
            if (!request.Hit.HasCell) { reason = "no-hit"; return false; }
            if (!TryParse(request.ToolType, request.Variant, request.Width, out var family)) {
                reason = "unsupported-family";
                return false;
            }
            var cell = StationModulePlacement.AimCell(request);
            int rotation = StationFootprints.NormRot(request.Rotation);
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
                default:
                    // Every remaining migrated type has an empty authored cfg.
                    break;
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
    /// The one candidate resolver for placement preview, drop and move (plan 16 Â§1.4).
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
            "tactile", "floor-mark",
        };

        /// <summary>Resolve one request against the committed document.</summary>
        public static StationPlacementPlan Resolve(StationIndex index, StationPlacementRequest request) {
            var plan = new StationPlacementPlan();
            if (index == null) { plan.Reason = "no-document"; return plan; }
            if (request == null) { plan.Reason = "bad-request"; return plan; }
            StationEditDraft candidate;
            if (request.Carried != null) {
                candidate = MoveCandidate(request, out var moveReason);
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
                if (!StationModuleFamilies.TryCreate(request, baySnap, out candidate, out var createReason)) {
                    plan.Reason = createReason;
                    return plan;
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
            // A fresh ramp's corridor envelope (`sim/openings.ts rampEnvelope`) is not ported,
            // so its collision check cannot run. The candidate is built and snapped, but the
            // resolver refuses to hand an unvalidated run to a commit: a stable code, not a
            // guessed box and not a silent allow. Replacing this needs the corridor port; the
            // snap itself is already applied above and pinned by the oracle.
            if (request.Carried == null && StationModuleFamilies.IsRamp(candidate.Type)) {
                plan.Reason = "ramp-corridor-unported";
            } else {
                plan.Reason = Validate(index, candidate, request.Carried, plan.ColliderIds, plan.UnverifiedIds);
            }
            plan.SupportId = Support(index, candidate);
            return plan;
        }

        /// <summary>
        /// The surface anchor a fresh piece or a carried one aims at. Port of
        /// <c>moduleAim</c>'s floor branch: a solid hit anchors on the block it hit (the
        /// piece stands on that block's top), while a hit on a derived floor â€” an exit
        /// plate, a void â€” anchors on the placement cell in front of the surface.
        /// </summary>
        public static StationPoint AimCell(StationPlacementRequest request) {
            var hit = request.Hit;
            return hit.Solid
                ? new StationPoint(hit.X, hit.Y, hit.Z)
                : new StationPoint(hit.PlaceX, hit.PlaceY, hit.PlaceZ);
        }

        /// <summary>The carried piece at its aimed cell and turn (<c>moveCandidate</c> without its sign snap).</summary>
        static StationEditDraft MoveCandidate(StationPlacementRequest request, out string reason) {
            reason = "";
            var source = request.Carried;
            if (!request.Hit.HasCell) { reason = "no-hit"; return null; }
            // A wall panel and a hung fitting anchor on their support, not on the floor
            // the pointer is over (moduleAim's wall/ceiling branches). Their support aim
            // is not ported yet, so the move is refused by name instead of landing the
            // piece on the floor.
            if (StationFootprints.IsWallMounted(source) || StationFootprints.IsCeilingHung(source)) {
                reason = "unsupported-mount";
                return null;
            }
            var at = AimCell(request);
            int x = (int)Math.Round(at.X), y = (int)Math.Round(at.Y), z = (int)Math.Round(at.Z);
            int rot = StationFootprints.NormRot(request.Rotation);
            var draft = DraftOf(source);
            draft.Id = source.Id;
            draft.SourceId = source.Id;
            // A run's own endpoints are world cells: re-lay them about the carried
            // anchor, stepped in the piece's turn convention (`movedModule`).
            if (source.Type == "stair" || source.Type == "escalator" || source.Type == "walkway") {
                if (!source.From.HasValue || !source.To.HasValue) { reason = "unsupported-family"; return null; }
                reason = "unsupported-family";
                return null;
            }
            // A ground å‡ºå…¥å£ keeps the offset of the course it was mounted on.
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
            // A flat body must not intersect a block. Wall and ceiling mounts reserve a
            // panel band or a hung column instead and are answered by their own rule.
            bool hung = StationFootprints.IsCeilingHung(record);
            bool wall = StationFootprints.IsWallMounted(record);
            if (!hung && !wall && BlockChecked.Contains(draft.Type)) {
                foreach (var cell in index.Document.Cells) {
                    if (!cell.IsSolid) continue;
                    var unit = new StationBox(cell.X, cell.Y, cell.Z, cell.X + 1, cell.Y + 1, cell.Z + 1);
                    if (box.Overlaps(unit)) return "occupied";
                }
            }
            if (!hung && draft.Type != "escalator") {
                bool floorOk;
                try { floorOk = StationFootprints.ModuleFloorOk(record, index); }
                catch (NotSupportedException) { return "unsupported-family"; }
                if (!floorOk) return draft.Type == "lift" ? "lift-footprint" : "floor";
            }
            if (PlacementOnTrack(index, draft, record, hung)) return "track";
            CollectColliders(index, record, box, colliders, unverified);
            if (colliders.Count > 0) return "occupied";
            if (wall && !WallSupport(index, record)) return "wall";
            if (hung && !CeilingSupport(index, draft)) return "ceiling";
            return "";
        }

        /// <summary>
        /// Port of <c>placementOnTrack</c>: the cells a piece is anchored by, the visible
        /// <c>floor.track</c> finish, a dug bed (a track module's cells) and â€” for a
        /// floor-standing piece â€” the trench one course above.
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
        static StationPoint[] BaseCells(StationModuleRecord record) {
            switch (record.Type) {
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
        /// documented exceptions that concern these families are kept â€” a piece never
        /// collides with itself, an exit shares space with a stair/escalator, and a floor
        /// sticker lies under a screen-door strip or a gate leaf â€” while a neighbour
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
                if (candidateSticker && (placed.Type == "platform-edge" ||
                    (placed.Type == "fence" && string.Equals(placed.Config.Text("variant"), "gate", StringComparison.Ordinal)))) continue;
                if (IsFloorSticker(placed.Type) && (candidate.Type == "platform-edge" ||
                    (candidate.Type == "fence" && string.Equals(candidate.Config.Text("variant"), "gate", StringComparison.Ordinal)))) continue;
                if (!StationFootprints.TryClearance(placed, out var other, out _)) {
                    unverified.Add(placed.Id);
                    continue;
                }
                if (other.IsEmpty) continue;
                if (!box.Overlaps(other)) continue;
                colliders.Add(placed.Id);
            }
        }

        static bool IsFloorSticker(string type) => type == "tactile" || type == "floor-mark";

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
        /// piece hangs from is the block directly above its stand cell (a åŠé¡¶ or an
        /// ordinary top block), or the nominal storey ceiling for a fixture.
        /// </summary>
        static bool CeilingSupport(StationIndex index, StationEditDraft draft) {
            if (StationFootprints.IsSolidAt(index, draft.X, draft.Y, draft.Z + 1)) return true;
            if (StationFootprints.IsSolidAt(index, draft.X, draft.Y, draft.Z + 4)) return true;
            return false;
        }

        /// <summary>The module a piece stands on / hangs from, for the plan's support id.</summary>
        static string Support(StationIndex index, StationEditDraft draft) {
            foreach (var module in index.Document.Modules) {
                if (string.Equals(module.Id, draft.SourceId, StringComparison.Ordinal)) continue;
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
