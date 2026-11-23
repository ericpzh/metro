using System;
using System.Collections.Generic;
using Metro.Build;
using UnityEngine;

namespace Metro.View {
    /// <summary>
    /// The one rail datum every consumer of a track shares: the recessed bed, the rail
    /// running surface, the wheel datum, the cabin floor, the platform top, the PSD face
    /// and the sticker/sill plane. Port of the geometry constants and helpers in
    /// <c>sim/constants.ts</c>, <c>sim/stock.ts</c>, <c>sim/track.ts</c> and
    /// <c>TrackModel.ts</c>/<c>TrackDetails.ts</c>.
    ///
    /// The saved frame is the track record's **origin cell corner**, with the run along
    /// local +x and the bed across local +y. Every number below is in that frame unless
    /// it says "above module", which means above the track record's floor elevation
    /// (<c>track.z</c>), not its floor top. That distinction is what the old track view
    /// got wrong: it started the run at the floor top (<c>z + 1</c>), so the ballast and
    /// rails were drawn one metre above the trench, at platform height.
    /// </summary>
    public static class StationRailGeometry {
        /* ------------------------------------------------------------ constants */

        /// <summary>`TRACK_UNDERFLOOR_DROP`.</summary>
        public const float UnderfloorDrop = .49f;
        /// <summary>`TRACK_BED_DROP = 0.45 + TRACK_UNDERFLOOR_DROP`.</summary>
        public const float BedDrop = .45f + UnderfloorDrop;
        /// <summary>`RAIL_HEAD_Z = 0.65 - TRACK_BED_DROP` (never used before the bed shift).</summary>
        public const float RailHeadZ = .65f - BedDrop;
        /// <summary>`RAIL_CENTRE_OFFSET`: half the 1.435 m gauge between the inside faces.</summary>
        public const float RailCentreOffset = .7525f;
        /// <summary>`CABIN_FLOOR_Z`: the car floor above the model origin.</summary>
        public const float CabinFloorZ = .62f;
        /// <summary>`TRAIN_ORIGIN_Z = 1 - CABIN_FLOOR_Z`.</summary>
        public const float TrainOriginZ = 1f - CabinFloorZ;
        /// <summary>`trainScaleForStorey`.</summary>
        public const float DefaultScale = .98f;
        /// <summary>`PSD_WALL_OFFSET`.</summary>
        public const float PsdWallOffset = .34f;
        /// <summary>`PSD_BASE_DEPTH`.</summary>
        public const float PsdBaseDepth = .18f;
        /// <summary>`PSD_FULL_DOOR_WIDTH_SCALE`.</summary>
        public const float PsdFullDoorWidthScale = 1.5f;
        /// <summary>`platformBlockInsets.ts:edge = 0.5 + PSD_WALL_OFFSET - PSD_BASE_DEPTH / 2`.</summary>
        public const double CellEdge = .5 + PsdWallOffset - PsdBaseDepth * .5;
        /// <summary>`sim/stock.ts:PANTOGRAPH_CONTACT_Z` in unscaled vehicle metres.</summary>
        public const float PantographContactZ = 3.57f;
        /// <summary>Contact wire tube radius (`CatenaryModel.ts`), metres.</summary>
        public const float ContactWireRadius = .012f;
        /// <summary>`CONTACT_WIRE_Z` for the default 5 m profile (`trainContactWireZ(0.98)` = 3.903 m).</summary>
        public const float OverheadContactZ = (1f - CabinFloorZ * DefaultScale) + PantographContactZ * DefaultScale + ContactWireRadius;

        /// <summary>`sim/stock.ts:trainContactWireZ`: wire centre height so its underside meets the pantograph carbon strip.</summary>
        public static float TrainContactWireZ(float scale = DefaultScale) {
            float s = Scale(scale);
            return TrainOrigin(s) + PantographContactZ * s + ContactWireRadius;
        }

        /// <summary>`sim/track.ts:trackHeadroom`: clear courses above the bed, including overhead support assembly.</summary>
        public static int TrackHeadroom(bool catenary, bool tunnel, bool bridge, string catenaryStyle) =>
            catenary && !tunnel && (bridge || string.Equals(catenaryStyle, "gantry", StringComparison.Ordinal)) ? 4 : 3;

        /// <summary>
        /// `sim/track.ts:trackCeilingUnderside` in track-local metres (`underside - track.z`).
        /// Finds the lowest solid block directly over the track footprint strictly above <c>track.z + 1</c>.
        /// </summary>
        public static float TrackCeilingUndersideLocal(StationIndex index, ModuleFacts track,
            bool catenary, bool tunnel, bool bridge, string catenaryStyle) {
            int headroom = TrackHeadroom(catenary, tunnel, bridge, catenaryStyle);
            int underside = track.Z + headroom + 1;
            if (index != null && track != null) {
                int w = Math.Max(1, track.Width);
                int d = Math.Max(1, track.Depth);
                for (int i = 0; i < w; i++) {
                    for (int j = 0; j < d; j++) {
                        StationFootprints.RotateLocal(track.Rotation, i, j, out var dx, out var dy);
                        int wx = track.X + (int)Math.Round(dx);
                        int wy = track.Y + (int)Math.Round(dy);
                        for (int z = track.Z + 2; z < underside; z++) {
                            if (index.TryGetCell(new StationCellKey(wx, wy, z), out var cell) && !cell.IsVoid) {
                                underside = z;
                                break;
                            }
                        }
                    }
                }
            }
            return underside - (track != null ? track.Z : 0);
        }

        /// <summary>`trainOriginForScale`: the consist origin above the track record's floor.</summary>
        public static float TrainOrigin(float scale) => 1f - CabinFloorZ * Scale(scale);

        /// <summary>
        /// `buildTrack`'s <c>hardwareLift</c>: the running gear group is scaled/carried so
        /// the wheels meet the recessed rail no matter the promoted stock scale.
        /// </summary>
        public static float HardwareLift(float scale) {
            float s = Scale(scale);
            return TrainOrigin(s) - TrainOriginZ * s;
        }

        /// <summary>`buildTrack`'s <c>bedTop</c> in the track-local frame (negative = recessed).</summary>
        public static float BedTop(float scale) {
            float s = Scale(scale);
            return (.45f - BedDrop) * s + HardwareLift(s);
        }

        /// <summary>The rail running surface above the track record's floor elevation.</summary>
        public static float RailTopAboveModule(float scale) {
            float s = Scale(scale);
            return HardwareLift(s) + RailHeadZ * s;
        }

        /// <summary>The rail head's z in the details frame before `TRACK_BED_DROP`.</summary>
        public static float RailHeadDetailZ => RailHeadZ + BedDrop;

        /// <summary>The wheel-contact datum (rail top) in document elevation for a track.</summary>
        public static float RailSurfaceZ(StationModuleRecord track, float scale) =>
            track.Z + RailTopAboveModule(scale);

        /// <summary>The consist origin in document elevation for a track.</summary>
        public static float TrainOriginFor(StationModuleRecord track, float scale) => track.Z + TrainOrigin(scale);

        /// <summary>The platform top: one metre above the track record's floor elevation.</summary>
        public static float PlatformTopAboveModule => 1f;

        /// <summary>The cabin floor in document elevation for a track.</summary>
        public static float CabinFloorFor(StationModuleRecord track, float scale) =>
            track.Z + TrainOrigin(scale) + CabinFloorZ * Scale(scale);

        /// <summary>
        /// The PSD sill's near (platform-side) edge in **cell coordinates** (0 the
        /// platform face, 1 the track-side face). The platform block inset cuts exactly
        /// this strip away, so the floor and the threshold cannot overlap: the source's
        /// `sillY - sillDepth / 2` lands on `edge` for both sides.
        /// </summary>
        public static double PsdSillNearEdge(int toward) => toward >= 0 ? CellEdge : 1 - CellEdge;

        /// <summary>`buildPsd`'s sill depth for a run (half the plinth + the full slide reach).</summary>
        public static float PsdSillDepth(bool half) {
            float fixedFrameDepth = half ? .10f : .14f;
            float slideOffset = fixedFrameDepth * .5f;
            float sillTrackReach = slideOffset + (half ? .10f : .12f) + .01f;
            return PsdBaseDepth * .5f + sillTrackReach;
        }

        /// <summary>`buildPsd`'s `sillY` in the edge's local frame (across the run).</summary>
        public static float PsdSillY(int toward, bool half) {
            float fixedFrameDepth = half ? .10f : .14f;
            float slideOffset = fixedFrameDepth * .5f;
            float sillTrackReach = slideOffset + (half ? .10f : .12f) + .01f;
            return toward * PsdWallOffset + toward * (sillTrackReach - PsdBaseDepth * .5f) * .5f;
        }

        /// <summary>`buildPsd`'s `leafY` (the moving leaves' plane) in the edge's local frame.</summary>
        public static float PsdLeafY(int toward, bool half) {
            float fixedFrameDepth = half ? .10f : .14f;
            return toward * PsdWallOffset + toward * fixedFrameDepth * .5f;
        }

        /// <summary>The sticker plane: the fixed glass face less the plate's stand-off.</summary>
        public static float PsdStickerY(int toward, bool half) {
            float fixedFrameDepth = half ? .10f : .14f;
            return toward * PsdWallOffset - toward * (fixedFrameDepth * .5f + .002f);
        }

        /// <summary>`trackSideFixtureOffset`: the screen-door line on an adjacent platform tile.</summary>
        public static float TrackSideFixtureOffset(float depth, float vehicleWidth = 0f) =>
            Math.Max(depth * .5f + .5f - PsdWallOffset, vehicleWidth * .5f + .25f);

        /// <summary>The stock width before the promoted model scale (`STOCK[stock].width`).</summary>
        public static float StockWidth(string stock) =>
            TrainConsist.TryStock(stock, out var facts) ? facts.Width : 3f;

        /// <summary>The model scale a stock is promoted at (`.98` unless the line authored one).</summary>
        public static float ModelScale(float authoredScale) => Scale(authoredScale);

        static float Scale(float scale) => scale > 0f ? scale : DefaultScale;

        /* -------------------------------------------------------- across / power */

        /// <summary>`trackTrainCentreV`: the vehicle centre across the bed, from its local −y edge.</summary>
        public static float TrainCentreAcross(StationModuleRecord track, float vehicleWidth, StationDocument document,
            string lineId, string lineDirection) {
            if (track == null) return 0f;
            float depth = Math.Max(1, track.Depth);
            bool tunnelOrBridge = track.Config.Bool("tunnel") || track.Config.Bool("bridge");
            if (tunnelOrBridge) return depth * .5f;
            var direction = track.Config.Text("dir");
            if (direction.Length == 0) direction = string.IsNullOrEmpty(lineDirection) ? "up" : lineDirection;
            var edge = PlatformEdgeFor(document, track, lineId, direction);
            if (edge == null) return depth * .5f;
            if (string.Equals(edge.Config.Text("side"), "left", StringComparison.Ordinal)) {
                float low = vehicleWidth * .5f;
                float high = depth - PlatformGap - vehicleWidth * .5f;
                return low <= high ? Mathf.Min(high, Mathf.Max(low, depth * .5f)) : low;
            }
            float rightLow = PlatformGap + vehicleWidth * .5f;
            float rightHigh = depth - vehicleWidth * .5f;
            return rightLow <= rightHigh ? Mathf.Min(rightHigh, Mathf.Max(rightLow, depth * .5f)) : rightHigh;
        }

        /// <summary>
        /// Shared berth platform-edge selection rule for document records (mirrors
        /// <see cref="StationTrainPose.SelectBerthPlatformEdges"/> and <c>World.computeLineAnchors</c>):
        /// explicit <c>cfg.from == track.Id</c> edges win whenever any exist; otherwise unbound legacy
        /// edges (<c>cfg.from</c> empty and <c>cfg.dir == direction</c>) are selected.
        /// </summary>
        public static void SelectBerthPlatformEdges(StationDocument document, StationModuleRecord track,
            string lineId, string direction, List<StationModuleRecord> output) {
            if (output == null) return;
            output.Clear();
            if (document == null || track == null || track.Config.Bool("tunnel") || track.Config.Bool("bridge")) return;
            var modules = document.Modules;
            List<StationModuleRecord> legacy = null;
            for (int i = 0; i < modules.Count; i++) {
                var module = modules[i];
                if (module == null || !string.Equals(module.Type, "platform-edge", StringComparison.Ordinal)) continue;
                if (!string.Equals(module.Config.Text("line"), lineId, StringComparison.Ordinal)) continue;
                var from = module.Config.Text("from");
                if (from.Length > 0) {
                    if (string.Equals(from, track.Id, StringComparison.Ordinal)) output.Add(module);
                    continue;
                }
                if (output.Count == 0 && string.Equals(module.Config.Text("dir"), direction, StringComparison.Ordinal)) {
                    if (legacy == null) legacy = new List<StationModuleRecord>(2);
                    legacy.Add(module);
                }
            }
            if (output.Count == 0 && legacy != null) {
                for (int i = 0; i < legacy.Count; i++) output.Add(legacy[i]);
            }
        }

        /// <summary>The first platform edge selected for this berth (explicit `cfg.from`, else legacy `dir`).</summary>
        public static StationModuleRecord PlatformEdgeFor(StationDocument document, StationModuleRecord track,
            string lineId, string direction) {
            var selected = new List<StationModuleRecord>(2);
            SelectBerthPlatformEdges(document, track, lineId, direction, selected);
            return selected.Count > 0 ? selected[0] : null;
        }

        /// <summary>`trackTrainCentreV`'s platform clearance, metres.</summary>
        public const float PlatformGap = .1f;

        /// <summary>
        /// `thirdRailSide`: local +1 / −1 edge for the conductor rail. A tunnel or bridge
        /// takes the travel right; a platform rail takes the side with no screen doors and
        /// only falls back to the travel right when both (or neither) side carries one.
        /// Explicit berth ownership (<c>cfg.from == track.Id</c>) wins over unbound legacy edges.
        /// </summary>
        public static int ThirdRailSide(ModuleFacts track, IReadOnlyList<ModuleFacts> station, string lineDirection) {
            if (track == null) return -1;
            var direction = track.Config.Text("dir");
            if (direction.Length == 0) direction = string.IsNullOrEmpty(lineDirection) ? "up" : lineDirection;
            int right = string.Equals(direction, "down", StringComparison.OrdinalIgnoreCase) ? 1 : -1;
            if (track.Config.Bool("tunnel") || track.Config.Bool("bridge")) return right;
            bool explicitFound = false;
            bool explicitLeft = false, explicitRight = false;
            bool legacyLeft = false, legacyRight = false;
            if (station != null) {
                var lineId = track.Config.Text("line");
                for (int i = 0; i < station.Count; i++) {
                    var edge = station[i];
                    if (edge == null || !string.Equals(edge.Type, "platform-edge", StringComparison.Ordinal)) continue;
                    if (!string.Equals(edge.Config.Text("line"), lineId, StringComparison.Ordinal)) continue;
                    var from = edge.Config.Text("from");
                    bool psdPresent = !string.Equals(edge.Config.Text("psd"), "none", StringComparison.Ordinal);
                    bool isLeft = string.Equals(edge.Config.Text("side"), "left", StringComparison.Ordinal);
                    if (from.Length > 0) {
                        if (!string.Equals(from, track.Id, StringComparison.Ordinal)) continue;
                        explicitFound = true;
                        if (psdPresent) {
                            if (isLeft) explicitLeft = true;
                            else explicitRight = true;
                        }
                        continue;
                    }
                    if (!explicitFound && psdPresent &&
                        string.Equals(edge.Config.Text("dir"), direction, StringComparison.Ordinal)) {
                        if (isLeft) legacyLeft = true;
                        else legacyRight = true;
                    }
                }
            }
            bool hasLeft = explicitFound ? explicitLeft : legacyLeft;
            bool hasRight = explicitFound ? explicitRight : legacyRight;
            if (hasLeft && !hasRight) return -1;
            if (hasRight && !hasLeft) return 1;
            return right;
        }

        /// <summary>The line's stock for a track record, or "" when the document names none.</summary>
        public static string StockOf(StationDocument document, ModuleFacts track) {
            if (document == null || track == null) return "";
            var lineId = track.Config.Text("line");
            for (int i = 0; i < document.Lines.Count; i++) {
                var line = document.Lines[i];
                if (line != null && string.Equals(line.Id, lineId, StringComparison.Ordinal)) return line.Stock ?? "";
            }
            return "";
        }

        /// <summary>The line's direction label for a track record, or "" when absent.</summary>
        public static string LineDirectionOf(StationDocument document, ModuleFacts track) {
            if (document == null || track == null) return "";
            var lineId = track.Config.Text("line");
            for (int i = 0; i < document.Lines.Count; i++) {
                var line = document.Lines[i];
                if (line != null && string.Equals(line.Id, lineId, StringComparison.Ordinal)) return line.Direction ?? "";
            }
            return "";
        }

        /// <summary>The authored power option (`third-rail`/`catenary`); "third-rail" when absent.</summary>
        public static string PowerOf(StationDocument document, ModuleFacts track) {
            if (document != null && track != null) {
                var lineId = track.Config.Text("line");
                for (int i = 0; i < document.Lines.Count; i++) {
                    var line = document.Lines[i];
                    if (line == null || !string.Equals(line.Id, lineId, StringComparison.Ordinal)) continue;
                    return string.Equals(line.Power, "overhead", StringComparison.OrdinalIgnoreCase) ? "catenary" : "third-rail";
                }
            }
            return "third-rail";
        }
    }
}
