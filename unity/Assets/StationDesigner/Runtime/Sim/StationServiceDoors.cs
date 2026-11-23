using System;
using System.Collections.Generic;

namespace Metro.Sim {
    /// <summary>
    /// The source's rolling-stock/stop numbers the service layer needs, ported from
    /// `game/src/sim/stock.ts` and `sim/constants.ts`. Kept in one place so a test can
    /// quote the source's own value instead of a second copy of the arithmetic.
    /// </summary>
    public static class StationServiceCadence {
        /// <summary>`CABIN_MAX_ROWS`: how deep a doorway's cabin queue is loaded.</summary>
        public const int CabinMaxRows = 12;
        /// <summary>`CABIN_ALIGHT_PAIR_S`: sim seconds between one doorway passing its next pair out.</summary>
        public const double AlightPairSeconds = 1.2;
        /// <summary>`CABIN_ALIGHT_MAX_S`: how long a doorway keeps alighting before it turns to boarding.</summary>
        public const double AlightMaxSeconds = 15;
        /// <summary>`CABIN_PAIR_HALF`: each of the two abreast, off the door's own centre.</summary>
        public const double CabinPairHalf = 0.32;
        /// <summary>`CABIN_ROW_PITCH`: row pitch of a doorway's queue, receding inboard.</summary>
        public const double CabinRowPitch = 0.55;
        /// <summary>`CABIN_HALF_W` and `CABIN_DOOR_INSET`: the clear half width inside the skins.</summary>
        public const double CabinHalfWidth = 1.15;
        public const double CabinDoorInset = 0.25;
        /// <summary>`CABIN_TURN_STEP` / `CABIN_MAX_TURNS`: the snake along the car's aisle.</summary>
        public const double CabinTurnStep = 0.75;
        public const int CabinMaxTurns = 2;
        /// <summary>`CABIN_FLOOR_Z`: the car floor above the consist origin.</summary>
        public const double CabinFloorZ = 0.62;
        /// <summary>`TRAIN_STEP_S`: sim seconds to cross a doorway, in or out.</summary>
        public const double TrainStepSeconds = 0.8;
        /// <summary>`DOOR_RATE`: a doorway's boarding rate, passengers per simulated second.</summary>
        public const double DoorRate = 1.2;
        /// <summary>`PLATFORM_BOARD_APPROACH`: how near the door head a boarder must stand, metres.</summary>
        public const double BoardApproach = 1.5;
        /// <summary>`DOOR_TRAVEL_S` / `TRAIN_DOOR_TRAVEL`: sim seconds for a full leaf crossing.</summary>
        public const double DoorTravelSeconds = 2;
        /// <summary>`DOOR_END_INSET`: metres of car the ends keep clear of a passenger door.</summary>
        public const double DoorEndInset = 2.8;

        /// <summary>
        /// `STOCK[stock].ratedPerCar` for the classes a save may name. Only the rated
        /// load is read here — the service layer never draws a car.
        /// </summary>
        public static double RatedPerCar(string stock) {
            switch ((stock ?? "").ToUpperInvariant()) {
                case "A": return 250;
                case "B": return 200;
                case "C": return 170;
                case "L": return 170;
                case "D": return 1758.0 / 8.0;
                default: return 200;
            }
        }

        /// <summary>
        /// `STOCK[stock].length`, metres. A 22 m, B 19.5 m, C 19 m, L 16.8 m and D 20.1 m
        /// (`sim/stock.ts`); a save that names no known class falls back to the B car, as
        /// `station.ts` does. B used to be listed at 19 m, which put every B-class doorway
        /// 0.5 m off the car door it exists to meet.
        /// </summary>
        public static double CarLength(string stock) {
            switch ((stock ?? "").ToUpperInvariant()) {
                case "A": return 22;
                case "L": return 16.8;
                case "D": return 20.1;
                case "C": return 19.0;
                default: return 19.5;
            }
        }

        /// <summary>`STOCK[stock].doorsPerSide`.</summary>
        public static int DoorsPerSide(string stock) {
            switch ((stock ?? "").ToUpperInvariant()) {
                case "A": return 5;
                case "L": return 3;
                case "D": return 4;
                default: return 4;
            }
        }

        /// <summary>`trainRatedCapacity(line)`: <c>round(ratedPerCar × cars)</c>.</summary>
        public static int RatedCapacity(string stock, int cars) {
            if (cars <= 0) return (int)Math.Round(RatedPerCar(stock));
            return (int)Math.Round(RatedPerCar(stock) * cars);
        }

        /// <summary>
        /// `doorCentres(line)`: where a consist's doors stand along its own frame, metres
        /// from the consist centre, positive toward the leading cab. The ends keep clear
        /// of the cab and the bogie (`DOOR_END_INSET`, or D-stock's `cabLength + singleEndDoorWidth/2 + 0.3`),
        /// and the doors inside a car sit on one uniform pitch — the cadence the screen doors repeat.
        /// </summary>
        public static double[] DoorCentres(string stock, int cars, double modelScale) {
            // `station.ts` falls back to `{ stock: 'B', cars: 6 }` for a document line it
            // cannot read, so a fixture that only names a line id still gets the source's
            // door cadence instead of none.
            if (cars <= 0) cars = 6;
            string cls = string.IsNullOrEmpty(stock) ? "B" : stock.ToUpperInvariant();
            double scale = modelScale > 0 ? modelScale : 1;
            double length = CarLength(cls);
            int count = Math.Max(1, DoorsPerSide(cls));
            // D-stock cab cars carry a 4.6 m nose and a 0.8 m single end plug door (`sim/stock.ts`).
            double cabInset = cls == "D" ? 4.6 + 0.8 * .5 + .3 : DoorEndInset;
            double total = length * cars;
            var centres = new List<double>(count * cars);
            for (int c = 0; c < cars; c++) {
                double carStart = c * length;
                bool cabLeft = c == 0, cabRight = c == cars - 1;
                double first = cabLeft ? cabInset : DoorEndInset;
                double last = length - (cabRight ? cabInset : DoorEndInset);
                double pitch = count > 1 ? (last - first) / (count - 1) : 0;
                for (int d = 0; d < count; d++)
                    centres.Add(carStart + (count > 1 ? first + d * pitch : length * .5));
            }
            var offsets = new double[centres.Count];
            for (int i = 0; i < centres.Count; i++) {
                double off = centres[i] - total * .5;
                // Round the distance from the centre, not the raw position (the source's
                // front/back symmetry), then apply the promoted model scale.
                offsets[i] = Math.Sign(off) * (Math.Round(Math.Abs(off) * 10 + 1e-9) / 10) * scale;
            }
            return offsets;
        }

        /// <summary>
        /// `doorRunOffsets(line, railW)`: the same doors in rail-local metres from the
        /// rail's first cell — one per modelled passenger door, not one per platform cell.
        /// </summary>
        public static double[] DoorRunOffsets(string stock, int cars, double modelScale, double railWidth) {
            var centres = DoorCentres(stock, cars, modelScale);
            for (int i = 0; i < centres.Length; i++) centres[i] = railWidth * .5 + centres[i];
            return centres;
        }

        /// <summary>`rotateLocal(rot, along, across)`: a track-local offset → a plan offset.</summary>
        public static void RotateLocal(int rotation, double along, double across, out double x, out double y) {
            switch (((rotation % 4) + 4) % 4) {
                case 1: x = -across; y = along; return;
                case 2: x = -along; y = -across; return;
                case 3: x = across; y = -along; return;
                default: x = along; y = across; return;
            }
        }
    }

    /// <summary>
    /// One platform doorway's stable identity: the screen run it belongs to, its index
    /// along that run, and the walk-graph node it opens onto.
    ///
    /// The source seats **one door server per modelled passenger door** — the cadence
    /// `doorRunOffsets(line, rail.w)` — on the platform cell that door stands at
    /// (`sim/station.ts`). The C# walk graph still cuts one door server per walkable
    /// cell of the edge run; the *service* layer addresses these slots instead, so a
    /// cabin wave is seated, released and boarded door for door exactly as the source
    /// runs it.
    /// </summary>
    public struct StationDoorSlot {
        /// <summary>Stable identity within the station: <c>platformId#index</c>.</summary>
        public string Id;
        public string PlatformId;
        public string LineId;
        public string TrackId;
        /// <summary>Index along the platform run, ascending — the source's `train.doors` order.</summary>
        public int Index;
        /// <summary>The walk-graph node the doorway opens onto, or −1 when no floor exists there.</summary>
        public int Node;
        public int X, Y, Z;
        /// <summary>Metres along the rail from its first cell (`doorRunOffsets`).</summary>
        public double Offset;
        /// <summary>Unit vector pointing from the PSD wall inland onto the platform floor.</summary>
        public double InwardX, InwardY;
        public bool HasInward;

        public override string ToString() => Id + "@" + X + "," + Y + "," + Z;
    }

    /// <summary>
    /// Derives <see cref="StationDoorSlot"/>s from the committed document — the port of
    /// `sim/station.ts`'s `platform-edge` case. Pure: the document and the graph in, the
    /// eligible doorways out, in document order.
    /// </summary>
    public static class StationServiceDoors {
        /// <summary>
        /// The doorways of one platform edge. A door whose cell has no walkable node is
        /// dropped (the source does the same: a screen shorter than its rail has no
        /// server at the doors past its end), and a door count of zero is reported
        /// through <paramref name="diagnostic"/> rather than faked.
        /// </summary>
        public static List<StationDoorSlot> ForEdge(StationSessionDocument document, StationWalkGraph graph,
            StationModuleFact edge, StationModuleFact track, StationLineFact line, out string diagnostic) {
            diagnostic = "";
            var slots = new List<StationDoorSlot>();
            int runLength = Math.Max(1, edge.Width);
            // `run` is the edge's own cell row, one cell deep, along local +x turned by
            // the saved quarter turn.
            var run = new List<(int x, int y)>(runLength);
            for (int i = 0; i < runLength; i++) {
                StationServiceCadence.RotateLocal(edge.Rot, i, 0, out double dx, out double dy);
                run.Add((edge.X + (int)Math.Round(dx), edge.Y + (int)Math.Round(dy)));
            }
            double railWidth = track.Width > 0 ? track.Width : runLength;
            // `i0`: where this edge starts in the rail's own along-run measure.
            double i0 = 0;
            if (track.Width > 0) {
                StationServiceCadence.RotateLocal(-track.Rot, edge.X - track.X, edge.Y - track.Y, out double along, out _);
                i0 = along;
            }
            var seats = new List<(int j, double offset)>();
            if (track.Width > 0) {
                foreach (double at in StationServiceCadence.DoorRunOffsets(line.Stock, line.Cars, line.ModelScale, railWidth)) {
                    int j = (int)Math.Round(at - i0 - .5);
                    if (j >= 0 && j < run.Count) seats.Add((j, at));
                }
            } else {
                // An edge with no rail spreads its doors over its own run, exactly as the
                // source's pre-`cfg.from` fallback does.
                int count = Math.Max(1, StationServiceCadence.DoorCentres(line.Stock, line.Cars, line.ModelScale).Length);
                int step = Math.Max(1, run.Count / count);
                for (int i = 0; i < run.Count && seats.Count < count; i += step) seats.Add((i, i));
            }
            StationServiceCadence.RotateLocal(edge.Rot, 0,
                string.Equals(edge.Side, "right", StringComparison.Ordinal) ? -1 : 1,
                out double inwardX, out double inwardY);
            for (int i = 0; i < seats.Count; i++) {
                var (j, offset) = seats[i];
                var (x, y) = run[j];
                if (!graph.TryNode(x, y, edge.Z, out int node)) continue;
                slots.Add(new StationDoorSlot {
                    Id = (edge.Id ?? "") + "#" + slots.Count,
                    PlatformId = edge.Id ?? "", LineId = edge.LineId ?? "", TrackId = track.Id ?? "",
                    Index = slots.Count, Node = node, X = x, Y = y, Z = edge.Z, Offset = offset,
                    InwardX = inwardX, InwardY = inwardY, HasInward = true,
                });
            }
            if (slots.Count == 0) diagnostic = "platform-door-no-floor:" + (edge.Id ?? "");
            else if (slots.Count != seats.Count) diagnostic = "platform-door-floor:" + (edge.Id ?? "");
            return slots;
        }

        /// <summary>`serviceTracks(line)`: the platform tracks a line runs a consist on, in
        /// document order. Tunnel/bridge runs are extensions unless the line owns nothing else
        /// (`sim/world/World.ts`'s `serviceTracks`), so a save with only a tunnel run still
        /// gives its doors a track to belong to.</summary>
        public static List<StationModuleFact> ServiceTracks(StationSessionDocument document, string lineId) {
            var bound = new List<StationModuleFact>();
            if (document == null) return bound;
            var tracks = document.ModulesOfType("track");
            for (int i = 0; i < tracks.Count; i++) {
                var module = tracks[i];
                if (!string.Equals(module.LineId, lineId, StringComparison.Ordinal)) continue;
                bound.Add(module);
            }
            var platforms = new List<StationModuleFact>();
            for (int i = 0; i < bound.Count; i++) if (!bound[i].Tunnel && !bound[i].Bridge) platforms.Add(bound[i]);
            return platforms.Count > 0 ? platforms : bound;
        }

        /// <summary>
        /// The track one platform edge's doors belong to, exactly as `World.ts` attributes them:
        /// a **valid** `cfg.from` wins; otherwise the first service track whose own direction
        /// matches the edge's (falling back to the line's direction); otherwise the first
        /// service track. Empty only when the line runs no track at all, which is the source's
        /// line-only service.
        ///
        /// Requiring `edge.RailId == trackId` verbatim (the old rule) dropped every edge that
        /// named no track — or named one that had since been moved or deleted — so its doors
        /// were never attributed to any service and nobody could board or alight there (18 §8).
        /// </summary>
        public static string ResolveEdgeTrack(StationSessionDocument document, StationModuleFact edge,
            StationLineFact line, bool haveLine) {
            var rails = ServiceTracks(document, edge.LineId ?? "");
            if (rails.Count == 0) return "";
            var from = edge.RailId ?? "";
            if (from.Length > 0) {
                for (int i = 0; i < rails.Count; i++)
                    if (string.Equals(rails[i].Id, from, StringComparison.Ordinal)) return from;
            }
            var direction = !string.IsNullOrEmpty(edge.Dir) ? edge.Dir : (haveLine ? line.Direction : "");
            for (int i = 0; i < rails.Count; i++) {
                // `(t.cfg.dir ?? line.direction) === p.dir`
                var trackDirection = !string.IsNullOrEmpty(rails[i].Dir) ? rails[i].Dir : (haveLine ? line.Direction : "");
                if (string.Equals(trackDirection, direction, StringComparison.Ordinal)) return rails[i].Id;
            }
            return rails[0].Id;
        }

        /// <summary>Every eligible doorway of a (line, track) service, in document order.</summary>
        public static List<StationDoorSlot> ForService(StationSessionDocument document, StationWalkGraph graph,
            string lineId, string trackId, out List<string> diagnostics) {
            diagnostics = new List<string>();
            var slots = new List<StationDoorSlot>();
            if (document == null || graph == null) return slots;
            var rails = ServiceTracks(document, lineId);
            StationModuleFact track = default;
            bool hasTrack = false;
            for (int i = 0; i < rails.Count; i++) {
                if (!string.Equals(rails[i].Id, trackId, StringComparison.Ordinal)) continue;
                track = rails[i];
                hasTrack = true;
                break;
            }
            StationLineFact line = default;
            bool haveLine = false;
            for (int i = 0; i < document.Lines.Count; i++)
                if (string.Equals(document.Lines[i].Id, lineId, StringComparison.Ordinal)) {
                    line = document.Lines[i];
                    haveLine = true;
                }
            // A service with no track id on a line that runs no rail keeps every edge: there is
            // nothing to attribute its doors to (the source's line-only service).
            bool lineOnly = string.IsNullOrEmpty(trackId) && rails.Count == 0;
            var edges = document.ModulesOfType("platform-edge");
            for (int i = 0; i < edges.Count; i++) {
                var edge = edges[i];
                if (!string.Equals(edge.LineId, lineId, StringComparison.Ordinal)) continue;
                if (!lineOnly) {
                    var resolved = ResolveEdgeTrack(document, edge, line, haveLine);
                    if (!string.Equals(resolved, trackId, StringComparison.Ordinal)) continue;
                }
                var edgeSlots = ForEdge(document, graph, edge, hasTrack ? track : default, line, out string diagnostic);
                if (diagnostic.Length > 0) diagnostics.Add(diagnostic);
                for (int s = 0; s < edgeSlots.Count; s++) {
                    var slot = edgeSlots[s];
                    // The service's own ordering: platform edges in document order, then
                    // each edge's doorways along its run.
                    slot.Index = slots.Count;
                    slots.Add(slot);
                }
            }
            return slots;
        }
    }
}
