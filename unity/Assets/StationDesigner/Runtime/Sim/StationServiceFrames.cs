using System;
using System.Collections.Generic;

namespace Metro.Sim {
    // The service half of a simulation frame (plan 11 C3): the passengers the
    // station is actually serving and the gates they are queuing at. Plain types
    // only — `Metro.Sim` has no engine reference, so the view adapts these into
    // its own pose (`Runtime/App/Views/SessionPassengerFeed.cs`).
    //
    // **Identity is the contract.** A passenger is published by a stable integer
    // simulation id; the view selects the recipe, the age and the walk profile
    // from that id alone (`PassengerAppearance`/`PassengerCatalogue`), never from
    // a position, a slot or a frame index. The ids restart with the run's seed on
    // `World.restart()`, so the same seed always puts the same person in the same
    // body.

    /// <summary>
    /// The source's activity kinds, in atlas order (<c>sim/activities.ts</c>).
    /// Numerically identical to <c>Metro.View.PassengerActivity</c>; the App feed
    /// casts across the assembly boundary.
    /// </summary>
    public enum StationPassengerActivity {
        Walk = 0, Sit = 1, Shop = 2, Ticket = 3, Vending = 4, Qr = 5, Card = 6,
        Escalator = 7, Lift = 8, Toilet = 9, Wash = 10, Door = 11, Wait = 12, Queue = 13,
        EscalatorLeft = 14,
    }

    /// <summary>What a published passenger is doing, coarse enough to assert a journey against.</summary>
    public enum StationPassengerState {
        Walking = 0,
        /// <summary>In a gate, platform-door, escalator, stair or lift queue.</summary>
        Queuing = 1,
        /// <summary>Riding a vertical band (escalator, walkway, stair) or a lift car.</summary>
        Riding = 2,
        /// <summary>Stepping out of a consist onto the platform.</summary>
        Alighting = 3,
        /// <summary>Aboard a consist at the platform (stepped in, doors may shut after).</summary>
        Boarding = 4,
    }

    /// <summary>One passenger's published pose and service state, in document axes.</summary>
    public struct StationPassengerFrame {
        /// <summary>Stable simulation identity; selects the recipe and the gait profile.</summary>
        public int SimId;
        /// <summary>Document plan x of the feet.</summary>
        public double X;
        /// <summary>Document plan y of the feet.</summary>
        public double Y;
        /// <summary>Document elevation of the feet (the walking plane).</summary>
        public double Z;
        /// <summary>Heading in document axes: <c>atan2(dy, dx)</c> radians.</summary>
        public double Heading;
        public StationPassengerActivity Activity;
        /// <summary>Seconds into the activity's own duration.</summary>
        public double ActivitySeconds;
        /// <summary>Cumulative walked metres since spawn (the source's travel-driven gait).</summary>
        public double WalkDistance;
        /// <summary>Gait phase at spawn, 0–1; walk distance advances it.</summary>
        public double WalkPhase;
        /// <summary>Idle→walk blend weight, 0–1; zero means the activity owns the pose.</summary>
        public double WalkWeight;
        public StationPassengerState State;
        /// <summary>The server this passenger is queuing at or riding, "" when walking.</summary>
        public string ServerId;
        /// <summary>False hides the actor without forgetting it.</summary>
        public bool Visible;
    }

    /// <summary>What a gate server is doing this instant.</summary>
    public enum StationGateState { Idle = 0, Queueing = 1, Serving = 2, Held = 3 }

    /// <summary>
    /// One fare-gate server, keyed by its **document module id** and its walk-graph
    /// server id. Queue and Served are the live numbers the queue panel may print;
    /// Rate/Ride/Batch/Cycle are the document's own service facts.
    /// </summary>
    public struct StationGateFrame {
        public string Id;
        /// <summary>The walk-graph server id (stable within one graph build).</summary>
        public int Server;
        public int Node;
        public int Queue;
        public int Served;
        public double Rate;
        public int Batch;
        public int Cycle;
        public StationGateState State;
        /// <summary>The gate's policy: -1 exit only, 0 both, 1 entry only.</summary>
        public int Mode;
        /// <summary>
        /// The direction a two-way lane has committed to: -1 exit, +1 entry, 0 idle. The
        /// source's first-come rule fixes it on the first served agent and releases it when
        /// that direction drains.
        /// </summary>
        public int Lane;
        /// <summary>
        /// The lane's moving leaves, 0 shut … 1 open. The source's open/hold/shut curve
        /// (0.25 s open, 0.45 s hold, 0.35 s shut) evaluated at this tick from the last
        /// admission, so a gate visibly answers the passenger it served.
        /// </summary>
        public double Open;
    }

    public static class StationServiceText {
        public static string PassengerStateText(StationPassengerState state) {
            switch (state) {
                case StationPassengerState.Queuing: return "queuing";
                case StationPassengerState.Riding: return "riding";
                case StationPassengerState.Alighting: return "alighting";
                case StationPassengerState.Boarding: return "boarding";
                default: return "walking";
            }
        }

        public static string GateStateText(StationGateState state) {
            switch (state) {
                case StationGateState.Queueing: return "queueing";
                case StationGateState.Serving: return "serving";
                case StationGateState.Held: return "held";
                default: return "idle";
            }
        }

        public static string GateModeText(int mode) => mode > 0 ? "in" : mode < 0 ? "out" : "both";

        public static string ActivityText(StationPassengerActivity activity) {
            switch (activity) {
                case StationPassengerActivity.Sit: return "sit";
                case StationPassengerActivity.Shop: return "shop";
                case StationPassengerActivity.Ticket: return "ticket";
                case StationPassengerActivity.Vending: return "vending";
                case StationPassengerActivity.Qr: return "qr";
                case StationPassengerActivity.Card: return "card";
                case StationPassengerActivity.Escalator: return "escalator";
                case StationPassengerActivity.Lift: return "lift";
                case StationPassengerActivity.Toilet: return "toilet";
                case StationPassengerActivity.Wash: return "wash";
                case StationPassengerActivity.Door: return "door";
                case StationPassengerActivity.Wait: return "wait";
                case StationPassengerActivity.Queue: return "queue";
                case StationPassengerActivity.EscalatorLeft: return "escalator-left";
                default: return "walk";
            }
        }
    }

    /// <summary>
    /// The bounded service slice's own knobs. The defaults are the source's:
    /// every exit admits 900 pax/hour before the demand curve scales it, and a
    /// berth brings 200 alighting passengers (the source's default line). A
    /// fixture may shrink the wave so the alight-before-board ordering is
    /// observable at a one-second tick; the station runs the defaults.
    /// </summary>
    public sealed class StationServiceOptions {
        /// <summary>The source's exit placement default (<c>inRate: 900</c>).</summary>
        public double ExitInRatePerHour = 900;
        /// <summary>The source's default alighting wave per consist (<c>alightPerTrain</c>).</summary>
        public int AlightPerTrain = 200;
        /// <summary>The source's crowd cap (<c>MAX_AGENTS</c>).</summary>
        public int MaxPassengers = 6000;
        /// <summary>
        /// The bounded window a coalesced subscriber payload carries. The motion frame
        /// and the actor feed carry every passenger; this is only the slice a state
        /// reply repeats many times a second.
        /// </summary>
        public int PublishedPassengerLimit = 32;
        /// <summary>False spawns nobody (an empty station the clock still runs).</summary>
        public bool Spawn = true;

        public StationServiceOptions Clone() => new StationServiceOptions {
            ExitInRatePerHour = ExitInRatePerHour,
            AlightPerTrain = AlightPerTrain,
            MaxPassengers = MaxPassengers,
            PublishedPassengerLimit = PublishedPassengerLimit,
            Spawn = Spawn,
        };
    }

    /// <summary>
    /// The floors a shaft serves, bottom → top (`liftLevels`): the endpoints and
    /// every whole storey between them. The endpoint is a stop even when it is not
    /// on the storey ladder, because a landing exists where the shaft's own `to`
    /// says it does.
    /// </summary>
    public static class StationLiftStops {
        public static List<int> Levels(StationModuleFact m) {
            var stops = new List<int>();
            if (!m.HasEndpoints) { stops.Add(m.Z); return stops; }
            int lo = Math.Min(m.FromZ, m.ToZ), hi = Math.Max(m.FromZ, m.ToZ);
            for (int z = lo; z <= hi; z += 5) stops.Add(z);
            if (stops.Count == 0 || stops[stops.Count - 1] != hi) stops.Add(hi);
            return stops;
        }
    }
}
