using System;
using System.Collections.Generic;

namespace Metro.Sim {
    /// <summary>One stock class's running dimensions (`sim/stock.ts`).</summary>
    public struct StationStockFacts {
        public string Cls;
        public double Width, Length, Height;
    }

    /// <summary>
    /// One consist's berth and pose frame in document axes: the origin the cars hang from,
    /// the unit facing along the run, the service's direction sign and the connected rail
    /// each way. This is the frame `World.trainAt` answers in and the frame a cabin slot is
    /// placed in, so the consist view and the passenger runtime share one datum (18 §8.2).
    /// </summary>
    public sealed class StationTrainBerth {
        public string LineId = "", TrackId = "", Stock = "";
        public int Cars;
        public double Scale = StationTrainPose.DefaultScale;
        /// <summary>The consist origin in document plan metres, at the rail-surface elevation.</summary>
        public double X, Y, Z;
        /// <summary>The unit run direction (`trainAt`'s `fx`/`fy`).</summary>
        public double Fx, Fy;
        /// <summary>+1 for an up service, −1 for a down one.</summary>
        public int DirectionSign;
        public double HalfLength, ApproachRun, DepartRun;
        public bool HasPlatform;
        /// <summary>Track-local platform sides owned by this berth: bit 0 = left (+y), bit 1 = right (−y).</summary>
        public int TrackDoorSides;
        /// <summary>Bitmask of active consist door banks: bit 0 = local +1 bank, bit 1 = local -1 bank (0..3).</summary>
        public int DoorBankMask;
        public double PlatformX, PlatformY, PlatformZ;
        /// <summary>The car floor in document elevation (`at.z + CABIN_FLOOR_Z · scale`).</summary>
        public double CabinFloorZ;
        /// <summary>The berth's position for one phase, the way `trainAt` samples it.</summary>
        public void Pose(TrainPhase phase, double phaseSeconds, out double x, out double y, out double z) {
            double offset = StationTrainPose.OffsetMetres(phase, phaseSeconds, this);
            x = X + Fx * offset;
            y = Y + Fy * offset;
            z = Z;
        }
    }

    /// <summary>
    /// The pure train-pose maths the service layer needs (`sim/world/World.ts:trainAt`,
    /// `sim/stock.ts:cabinSlot`, `World.cabinWorldPos`, `World.stepOut`).
    ///
    /// It lived only in the Unity view (`TrainConsistGeometry`), so the passenger runtime had
    /// no train to stand in: `SeatAlighter` fell back to the source's **no-consist** branch
    /// for every wave, packing all rows against one platform node at platform height, and
    /// `StepOut` displaced the pair along document X instead of along the train. That is why
    /// a logically alighting passenger never visibly walked out of a car (18 §8.2).
    ///
    /// `TrainConsistViewTests` pins this against `TrainConsistGeometry.TryBerth` on the real
    /// Zoo tracks, so the two owners cannot drift apart.
    /// </summary>
    public static class StationTrainPose {
        /// <summary>`trainScaleForStorey`: the promoted car scale (`stock.ts`).</summary>
        public const double DefaultScale = .98;
        /// <summary>`CABIN_FLOOR_Z`: the car floor above the consist origin, metres.</summary>
        public const double CabinFloorHeight = .62;
        /// <summary>`track_trainCentreV`'s platform clearance, metres.</summary>
        public const double PlatformGap = .1;

        /// <summary>`trainOriginForScale`: the consist origin above the track record's floor.</summary>
        public static double TrainOrigin(double scale) => 1.0 - CabinFloorHeight * ScaleOf(scale);

        static double ScaleOf(double scale) => scale > 0 ? scale : DefaultScale;

        /// <summary>`STOCK[stock]`'s running width and length.</summary>
        public static StationStockFacts StockFacts(string stock) {
            switch ((stock ?? "").ToUpperInvariant()) {
                case "A": return new StationStockFacts { Cls = "A", Width = 3.0, Length = 22.0, Height = 3.8 };
                case "B": return new StationStockFacts { Cls = "B", Width = 2.8, Length = 19.5, Height = 3.8 };
                case "C": return new StationStockFacts { Cls = "C", Width = 2.6, Length = 19.0, Height = 3.6 };
                case "L": return new StationStockFacts { Cls = "L", Width = 2.8, Length = 16.8, Height = 3.6 };
                case "D": return new StationStockFacts { Cls = "D", Width = 3.3, Length = 20.1, Height = 3.8 };
                default: return new StationStockFacts { Cls = "A", Width = 3.0, Length = 22.0, Height = 3.8 };
            }
        }

        public static int NormTurn(int rotation) => ((rotation % 4) + 4) % 4;

        /// <summary>`rotateLocal`: a track-local offset (along, across) → plan offset.</summary>
        public static void RotateLocal(int rotation, double along, double across, out double x, out double y) {
            switch (NormTurn(rotation)) {
                case 1: x = -across; y = along; break;
                case 2: x = -along; y = -across; break;
                case 3: x = across; y = -along; break;
                default: x = along; y = across; break;
            }
        }

        static int Depth(StationModuleFact track) => Math.Max(1, track.Depth);
        static bool IsTunnelOrBridge(StationModuleFact track) => track.Tunnel || track.Bridge;

        /// <summary>
        /// Shared berth platform-edge selection rule (mirrors <c>World.computeLineAnchors</c>):
        /// explicit <c>platform-edge</c> runs bound via <c>cfg.from == track.Id</c> take strict
        /// precedence whenever any exist for this berth; only when none exist are unbound legacy
        /// edges (<c>cfg.from</c> empty and <c>cfg.dir == direction</c>) selected.
        /// </summary>
        public static void SelectBerthPlatformEdges(StationSessionDocument document, StationModuleFact track,
            string lineId, string direction, List<StationModuleFact> output) {
            if (output == null) return;
            output.Clear();
            if (document == null || track.Tunnel || track.Bridge) return;
            var edges = document.ModulesOfType("platform-edge");
            List<StationModuleFact> legacy = null;
            for (int i = 0; i < edges.Count; i++) {
                var edge = edges[i];
                if (!string.Equals(edge.LineId, lineId, StringComparison.Ordinal)) continue;
                var from = edge.RailId ?? "";
                if (from.Length > 0) {
                    if (string.Equals(from, track.Id, StringComparison.Ordinal)) output.Add(edge);
                    continue;
                }
                if (output.Count == 0 && string.Equals(edge.Dir, direction, StringComparison.Ordinal)) {
                    if (legacy == null) legacy = new List<StationModuleFact>(2);
                    legacy.Add(edge);
                }
            }
            if (output.Count == 0 && legacy != null) {
                for (int i = 0; i < legacy.Count; i++) output.Add(legacy[i]);
            }
        }

        /// <summary>
        /// Track-local platform side bitmask from a selected berth edge list:
        /// bit 0 = track +y (<c>left</c>), bit 1 = track -y (<c>right</c>).
        /// </summary>
        public static int DoorSidesMask(IReadOnlyList<StationModuleFact> edges) {
            int mask = 0;
            if (edges == null) return 0;
            for (int i = 0; i < edges.Count; i++) {
                if (string.Equals(edges[i].Side, "left", StringComparison.Ordinal)) mask |= 1;
                else mask |= 2;
                if (mask == 3) break;
            }
            return mask;
        }

        /// <summary>`platformEdgeFor`: the first edge selected for this berth (explicit `cfg.from`, else legacy `dir`).</summary>
        public static int PlatformEdgeFor(StationSessionDocument document, StationModuleFact track, string lineId,
            string direction) {
            if (document == null || track.Tunnel || track.Bridge) return -1;
            int byDirection = -1;
            for (int i = 0; i < document.Modules.Count; i++) {
                var module = document.Modules[i];
                if (module.Type != "platform-edge") continue;
                if (!string.Equals(module.LineId, lineId, StringComparison.Ordinal)) continue;
                var from = module.RailId ?? "";
                if (from.Length > 0) {
                    if (string.Equals(from, track.Id, StringComparison.Ordinal)) return i;
                    continue;
                }
                if (byDirection >= 0) continue;
                if (string.Equals(module.Dir, direction, StringComparison.Ordinal)) byDirection = i;
            }
            return byDirection;
        }

        /// <summary>
        /// Bitmask of track-local sides owned by this berth: bit 0 = track +y (<c>left</c>),
        /// bit 1 = track -y (<c>right</c>). Explicit <c>cfg.from</c> edges win over unbound legacy edges.
        /// </summary>
        public static int TrackDoorSides(StationSessionDocument document, StationModuleFact track, string lineId, string direction) {
            if (document == null || track.Tunnel || track.Bridge) return 0;
            var selected = new List<StationModuleFact>(2);
            SelectBerthPlatformEdges(document, track, lineId, direction, selected);
            return DoorSidesMask(selected);
        }

        /// <summary>Maps track-local <see cref="TrackDoorSides"/> into consist-local door bank bits using travel heading.</summary>
        public static int ConsistDoorBankMask(int trackDoorSides, int directionSign) {
            int m = trackDoorSides & 3;
            if (directionSign < 0) return ((m & 1) << 1) | ((m & 2) >> 1);
            return m;
        }

        static bool TryPlatformEdgeFact(StationSessionDocument document, StationModuleFact track, string lineId,
            string direction, out StationModuleFact foundEdge) {
            foundEdge = default;
            if (document == null || track.Tunnel || track.Bridge) return false;
            var selected = new List<StationModuleFact>(2);
            SelectBerthPlatformEdges(document, track, lineId, direction, selected);
            if (selected.Count == 0) return false;
            foundEdge = selected[0];
            return true;
        }

        /// <summary>`trackTrainCentreV`: the vehicle centre across the bed, from its local −y edge.</summary>
        public static double TrainCentreV(StationSessionDocument document, StationModuleFact track, double vehicleWidth,
            string lineId, string lineDirection) {
            double depth = Depth(track);
            if (IsTunnelOrBridge(track)) return depth * .5;
            var direction = track.Dir ?? "";
            if (direction.Length == 0) direction = string.IsNullOrEmpty(lineDirection) ? "up" : lineDirection;
            var selected = new List<StationModuleFact>(2);
            SelectBerthPlatformEdges(document, track, lineId, direction, selected);
            if (selected.Count == 0) return depth * .5;
            bool hasLeft = false, hasRight = false;
            for (int i = 0; i < selected.Count; i++) {
                if (string.Equals(selected[i].Side, "left", StringComparison.Ordinal)) hasLeft = true;
                else hasRight = true;
            }
            if (hasLeft && hasRight) return depth * .5;
            if (hasLeft) {
                double low = vehicleWidth * .5, high = depth - PlatformGap - vehicleWidth * .5;
                return low <= high ? Math.Min(high, Math.Max(low, depth * .5)) : low;
            }
            double rightLow = PlatformGap + vehicleWidth * .5, rightHigh = depth - vehicleWidth * .5;
            return rightLow <= rightHigh ? Math.Min(rightHigh, Math.Max(rightLow, depth * .5)) : rightHigh;
        }

        /// <summary>`World.connectedRun`: how far the consist can run past its berth before the
        /// collinear rails of the same line and storey end, in metres.</summary>
        public static void ConnectedRun(StationSessionDocument document, StationModuleFact track,
            out double back, out double forward) {
            double centre = track.Width * .5;
            back = centre;
            forward = track.Width - centre;
            if (document == null) return;
            int rotation = NormTurn(track.Rot);
            RotateLocal(rotation, 1, 0, out double fx, out double fy);
            RotateLocal(rotation, 0, 1, out double sx, out double sy);
            double depth = Depth(track);
            var spans = new List<(double lo, double hi)>();
            var tracks = document.ModulesOfType("track");
            for (int i = 0; i < tracks.Count; i++) {
                var module = tracks[i];
                if (!string.Equals(module.LineId, track.LineId, StringComparison.Ordinal)) continue;
                if (module.Z != track.Z) continue;
                if (NormTurn(module.Rot) != rotation) continue;
                double dx = module.X - track.X, dy = module.Y - track.Y;
                double across = dx * sx + dy * sy;
                if (across >= depth || across + Depth(module) <= 0) continue;
                double along = dx * fx + dy * fy;
                spans.Add((along, along + module.Width));
            }
            spans.Sort((a, b) => a.lo.CompareTo(b.lo));
            double low = 0, high = track.Width;
            for (int i = 0; i < spans.Count; i++) {
                if (spans[i].lo > high || spans[i].hi < low) continue;
                low = Math.Min(low, spans[i].lo);
                high = Math.Max(high, spans[i].hi);
            }
            back = centre - low;
            forward = high - centre;
        }

        /// <summary>The source's `dirSign`: the track's own direction, else the line's.</summary>
        public static int DirectionSign(StationModuleFact track, StationLineFact line, bool haveLine) {
            var direction = track.Dir ?? "";
            if (string.Equals(direction, "down", StringComparison.OrdinalIgnoreCase)) return -1;
            if (string.Equals(direction, "up", StringComparison.OrdinalIgnoreCase)) return 1;
            return haveLine && string.Equals(line.Direction, "down", StringComparison.OrdinalIgnoreCase) ? -1 : 1;
        }

        /// <summary>
        /// Derive one track's berth. Fails with a stable reason when the track cannot carry a
        /// consist (no line, no width), exactly like `World.computeLineAnchors`.
        /// </summary>
        public static bool TryBerth(StationSessionDocument document, StationLineFact line, bool haveLine,
            string trackId, double scale, out StationTrainBerth berth, out string failure) {
            berth = null;
            failure = "";
            if (document == null) { failure = "no-document"; return false; }
            StationModuleFact track = default;
            bool found = false;
            var tracks = document.ModulesOfType("track");
            for (int i = 0; i < tracks.Count; i++) {
                var module = tracks[i];
                if (!string.Equals(module.Id, trackId, StringComparison.Ordinal)) continue;
                track = module;
                found = true;
                break;
            }
            if (!found) { failure = "no-track"; return false; }
            if (track.Width < 1) { failure = "track-width"; return false; }
            double modelScale = scale > 0 ? scale : DefaultScale;
            int rotation = NormTurn(track.Rot);
            RotateLocal(rotation, 1, 0, out double fx, out double fy);
            var stock = StockFacts(line.Stock);
            double width = stock.Width * modelScale;
            double across = TrainCentreV(document, track, width, line.Id ?? "", line.Direction ?? "");
            RotateLocal(rotation, (track.Width - 1) * .5, across - .5, out double ox, out double oy);
            ConnectedRun(document, track, out double back, out double forward);
            var direction = track.Dir ?? "";
            if (direction.Length == 0) direction = haveLine ? line.Direction : "up";
            var selectedEdges = new List<StationModuleFact>(2);
            SelectBerthPlatformEdges(document, track, line.Id ?? "", direction, selectedEdges);
            bool hasEdge = selectedEdges.Count > 0;
            var edge = hasEdge ? selectedEdges[0] : default;
            int dirSign = DirectionSign(track, line, haveLine);
            int trackSides = DoorSidesMask(selectedEdges);
            int bankMask = ConsistDoorBankMask(trackSides, dirSign);
            var entry = new StationTrainBerth {
                LineId = line.Id ?? track.LineId ?? "",
                TrackId = track.Id ?? "",
                Stock = line.Stock ?? "",
                Cars = line.Cars,
                Scale = modelScale,
                X = track.X + .5 + ox,
                Y = track.Y + .5 + oy,
                Z = track.Z + TrainOrigin(modelScale),
                Fx = fx, Fy = fy,
                DirectionSign = dirSign,
                HalfLength = stock.Length * Math.Max(0, line.Cars) * modelScale * .5,
                ApproachRun = back,
                DepartRun = forward,
                HasPlatform = hasEdge,
                TrackDoorSides = trackSides,
                DoorBankMask = bankMask,
            };
            if (hasEdge) {
                entry.PlatformX = edge.X + .5;
                entry.PlatformY = edge.Y + .5;
                entry.PlatformZ = edge.Z + .5;
            } else {
                entry.PlatformX = entry.X;
                entry.PlatformY = entry.Y - 1.5;
                entry.PlatformZ = entry.Z;
            }
            entry.CabinFloorZ = entry.Z + CabinFloorHeight * modelScale;
            berth = entry;
            return true;
        }

        /// <summary>`approachProgress(t)`: ease-out that reaches 1 on the phase's last drawn frame.</summary>
        public static double ApproachProgress(double phaseSeconds) {
            double steps = StationSimConstants.TrainApproachSeconds / StationSimConstants.SimSecondsPerTick;
            if (steps <= 2) return Clamp01(phaseSeconds / StationSimConstants.TrainApproachSeconds);
            double p = Math.Min(1, phaseSeconds / StationSimConstants.TrainApproachSeconds);
            return Clamp01((p * steps - 1) / (steps - 2));
        }

        /// <summary>`drawnRunScale`: the depart phase's last drawn frame is `((S−1)/S)²`.</summary>
        public static double DrawnRunScale(double phaseSeconds) {
            double steps = phaseSeconds / StationSimConstants.SimSecondsPerTick;
            return steps > 1 ? Math.Pow(steps / (steps - 1), 2) : 1.0;
        }

        /// <summary>The signed metres from the berth along the track facing (`World.trainAt`).</summary>
        public static double OffsetMetres(TrainPhase phase, double phaseSeconds, StationTrainBerth berth) {
            if (berth == null) return 0;
            switch (phase) {
                case TrainPhase.Approach: {
                    double q = ApproachProgress(phaseSeconds);
                    double remainder = 1 - q;
                    return -remainder * remainder * (berth.HalfLength + berth.ApproachRun) * berth.DirectionSign;
                }
                case TrainPhase.Depart: {
                    double p = Math.Min(1, phaseSeconds / StationSimConstants.TrainDepartSeconds);
                    return p * p * (berth.HalfLength + berth.DepartRun) *
                        DrawnRunScale(StationSimConstants.TrainDepartSeconds) * berth.DirectionSign;
                }
                default:
                    return 0;
            }
        }

        static double Clamp01(double value) => value < 0 ? 0 : value > 1 ? 1 : value;

        /// <summary>
        /// `stock.ts:cabinSlot`: one passenger's place in the car, in **scaled car units**
        /// along (+ toward the leading cab, measured from the doorway) and across (± from the
        /// car's centre line). The rows snake wall to wall and drift toward the cab, so a
        /// full cabin's aisle is the source's own.
        /// </summary>
        public static void CabinSlot(double doorX, int side, int file, int row, out double x, out double y) {
            double half = StationServiceCadence.CabinHalfWidth - StationServiceCadence.CabinDoorInset;
            double span = half * 2;
            double depth = row * StationServiceCadence.CabinRowPitch;
            double turn = Math.Floor(depth / span);
            double within = depth - turn * span;
            bool outbound = ((long)turn & 1) == 0;
            y = side * (outbound ? half - within : -half + within);
            x = doorX + file * StationServiceCadence.CabinPairHalf +
                Math.Min(turn, StationServiceCadence.CabinMaxTurns) * StationServiceCadence.CabinTurnStep;
        }

        /// <summary>
        /// `World.cabinWorldPos`: the world plan position of a cabin slot, from the consist's
        /// own pose, the doorway's node and the car frame. The car runs along the consist's
        /// local +x (the facing) and its doors face local ±y, which is the frame `cabinSlot`
        /// answers in.
        /// </summary>
        public static bool CabinWorldPos(StationTrainBerth berth, double nodeX, double nodeY, int file, int row,
            out double x, out double y, out double z) {
            x = y = z = 0;
            if (berth == null) return false;
            berth.Pose(TrainPhase.Berth, 0, out double atX, out double atY, out double atZ);
            double dx = nodeX - atX, dy = nodeY - atY;
            double doorX = dx * berth.Fx + dy * berth.Fy;
            double across = -dx * berth.Fy + dy * berth.Fx;
            int side = across >= 0 ? 1 : -1;
            CabinSlot(doorX / berth.Scale, side, file, row, out double sx, out double sy);
            double lx = sx * berth.Scale, ly = sy * berth.Scale;
            x = atX + lx * berth.Fx - ly * berth.Fy;
            y = atY + lx * berth.Fy + ly * berth.Fx;
            z = atZ + CabinFloorHeight * berth.Scale;
            return true;
        }

        /// <summary>`World.stepOut`: the pair steps either side of the doorway's centre, along
        /// the train facing, and lands on the platform at the doorway's own elevation.</summary>
        public static void StepOutTarget(StationTrainBerth berth, double nodeX, double nodeY, double nodeZ, int file,
            out double x, out double y, out double z) {
            double along = file * StationServiceCadence.CabinPairHalf;
            x = berth != null ? nodeX + along * berth.Fx : nodeX;
            y = berth != null ? nodeY + along * berth.Fy : nodeY;
            z = nodeZ;
        }
    }
}
