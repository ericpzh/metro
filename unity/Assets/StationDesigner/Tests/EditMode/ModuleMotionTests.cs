using System.Collections.Generic;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

/// <summary>
/// The state-driven motion binders. Every pose is a pure function of the published
/// state, so the same input always samples the same pose and a reset returns the
/// closed pose. Values trace the source owners in
/// `unity/plan/motion-inventory.md`.
///
/// The second half is packet B4's dispatch proof: one <see cref="StationMotionFrame"/>
/// drives every moving family by module/train id, with previous/current samples for
/// interpolation, an exact pause and an exact reset.
/// </summary>
public class ModuleMotionTests {
    static GameObject Pivot(string name, Vector3 local) {
        var pivot = new GameObject(name);
        pivot.transform.localPosition = local;
        return pivot;
    }

    static ModuleMotion Gate(out Transform left, out Transform right) {
        var host = new GameObject("gate-motion");
        var l = Pivot("left-leaf", new Vector3(-.025f, 0f, .64f));
        var r = Pivot("right-leaf", new Vector3(.325f, 0f, .64f));
        l.transform.SetParent(host.transform, false);
        r.transform.SetParent(host.transform, false);
        var motion = host.AddComponent<ModuleMotion>();
        motion.kind = ModuleMotion.Kind.GateWings;
        motion.leaves = new[] { l.transform, r.transform };
        motion.leavesClosed = new[] { l.transform.localPosition, r.transform.localPosition };
        motion.leafWidth = .35f;
        motion.leafEdges = new[] { -.2f, .5f };
        motion.leafSigns = new[] { 1f, -1f };
        left = l.transform;
        right = r.transform;
        return motion;
    }

    [Test] public void GateWingsRetractToTheMachine() {
        var motion = Gate(out var left, out var right);
        try {
            // Closed: `setGateWing(0)` leaves the leaves at their authored full width.
            Assert.AreEqual(1f, left.localScale.x, 1e-4f);
            Assert.AreEqual(-.025f, left.localPosition.x, 1e-4f);
            Assert.AreEqual(.325f, right.localPosition.x, 1e-4f);
            motion.Apply(0f, 0f, 1);
            motion.Apply(0f, .5f, 1);
            Assert.AreEqual(.1875f, left.localScale.x * .35f, 1e-3f, "half open"); // width 0.1875 m
            Assert.AreEqual(-.10625f, left.localPosition.x, 2e-3f);
            Assert.AreEqual(.40625f, right.localPosition.x, 2e-3f);
            motion.Apply(0f, 1f, 1);
            Assert.AreEqual(.025f, left.localScale.x * .35f, 1e-3f, "fully retracted to a 0.025 m edge");
            Assert.AreEqual(-.1875f, left.localPosition.x, 2e-3f);
            Assert.AreEqual(.4875f, right.localPosition.x, 2e-3f);
            motion.Apply(0f, 0f, 1);
            Assert.AreEqual(1f, left.localScale.x, 1e-4f, "reset returns the closed pose");
        } finally {
            Object.DestroyImmediate(left.gameObject.transform.parent.gameObject);
        }
    }

    [Test] public void ScreenLeavesRetractByTheirTravel() {
        var host = new GameObject("screen-motion");
        var a = Pivot("leaf-a", new Vector3(2.25f - .6f, 1.175f, -.41f));
        var b = Pivot("leaf-b", new Vector3(2.25f + .6f, 1.175f, -.41f));
        a.transform.SetParent(host.transform, false);
        b.transform.SetParent(host.transform, false);
        var motion = host.AddComponent<ModuleMotion>();
        motion.kind = ModuleMotion.Kind.ScreenDoors;
        motion.leaves = new[] { a.transform, b.transform };
        motion.leavesClosed = new[] { a.transform.localPosition, b.transform.localPosition };
        motion.leafTravel = 1.029f; // Line 5 clear opening 2.058 m
        try {
            motion.Apply(0f, 1f, 1);
            // Leaf A retracts toward its own jamb (−x); leaf B toward the other (+x).
            Assert.AreEqual(-1.029f, a.transform.localPosition.x - (2.25f - .6f), 1e-4f);
            Assert.AreEqual(1.029f, b.transform.localPosition.x - (2.25f + .6f), 1e-4f);
            motion.Apply(0f, 0f, 1);
            Assert.AreEqual(a.transform.localPosition.x, 2.25f - .6f, 1e-4f);
        } finally {
            Object.DestroyImmediate(host);
        }
    }

    [Test] public void EscalatorBandShiftsByItsPhaseModuloThePitch() {
        var host = new GameObject("escalator-motion");
        var band = new GameObject("band").transform;
        band.SetParent(host.transform, false);
        var motion = host.AddComponent<ModuleMotion>();
        motion.kind = ModuleMotion.Kind.EscalatorSteps;
        motion.steps = new[] { band };
        motion.speed = .5f;
        motion.direction = 1f;
        motion.loopMetres = 11.546988f;
        motion.stepPitch = .398172f;
        motion.beltClosed = Vector3.zero;
        motion.beltDirection = new Vector3(.9f, .436f, 0f);
        try {
            motion.Apply(0f, 0f, 1);
            Assert.AreEqual(0f, band.localPosition.magnitude, 1e-5f);
            // Half a second at 0.5 m/s is 0.25 m into the 0.398 m pitch.
            motion.Apply(.5f, 0f, 1);
            Assert.AreEqual(.25f, band.localPosition.magnitude, 1e-4f);
            // One full pitch later the band is back at the seam.
            motion.Apply(.398172f / .5f, 0f, 1);
            Assert.AreEqual(0f, band.localPosition.magnitude, 2e-3f);
            // Reversing the direction runs the band the other way. A negative phase wraps
            // inside one pitch, so the shift is pitch − 0.25 m.
            motion.direction = -1f;
            motion.Apply(.5f, 0f, 1);
            float expected = Mathf.Repeat(-0.25f, motion.stepPitch);
            Assert.AreEqual(expected, band.localPosition.magnitude, 1e-4f);
            Assert.Less(expected, motion.stepPitch, "the reverse shift stays inside one pitch");
            // The typed sampler takes the absolute phase the frame publishes; the phase is
            // metres already rolled, so it is exact and needs no wall clock.
            motion.ApplyBeltPhase(.25f, 1);
            Assert.AreEqual(.25f, motion.PhaseMetres, 1e-5f);
            Assert.AreEqual(.25f, band.localPosition.magnitude, 1e-4f);
        } finally {
            Object.DestroyImmediate(host);
        }
    }

    [Test] public void LiftCarEasesBetweenItsStops() {
        var host = new GameObject("lift-motion");
        var cabin = new GameObject("cabin").transform;
        cabin.SetParent(host.transform, false);
        var motion = host.AddComponent<ModuleMotion>();
        motion.kind = ModuleMotion.Kind.LiftCar;
        motion.cabin = cabin;
        motion.cabinStops = new[] { 0f, 5f };
        motion.pauseSeconds = 8f;
        try {
            motion.Apply(0f, 0f, 1);
            Assert.AreEqual(0f, cabin.localPosition.y, 1e-4f);
            // A 5 m lift at 1.5 m/s takes 3.333 s; halfway through the smoothstep is 0.5.
            motion.Apply(8f + 3.333f * .5f, 0f, 1);
            Assert.AreEqual(2.5f, cabin.localPosition.y, .05f);
            motion.Apply(8f + 3.3f, 0f, 1);
            Assert.AreEqual(5f, cabin.localPosition.y, .1f);
            // After the dwell the car returns toward the first stop.
            motion.Apply(8f + 3.34f + 8f + 3.34f, 0f, 1);
            Assert.AreEqual(0f, cabin.localPosition.y, .05f);
            // The typed sampler places the cabin at a published fraction of the shaft.
            motion.ApplyCabinFraction(1f);
            Assert.AreEqual(5f, cabin.localPosition.y, 1e-4f);
            motion.ApplyCabinFraction(0f);
            Assert.AreEqual(0f, cabin.localPosition.y, 1e-4f);
        } finally {
            Object.DestroyImmediate(host);
        }
    }

    [Test] public void ClockHandsSampleTheRecordedPose() {
        var host = new GameObject("clock-motion");
        var hour = Pivot("clockHourHand", Vector3.zero);
        var minute = Pivot("clockMinuteHand", Vector3.zero);
        hour.transform.SetParent(host.transform, false);
        minute.transform.SetParent(host.transform, false);
        var motion = host.AddComponent<ModuleMotion>();
        motion.kind = ModuleMotion.Kind.ClockHands;
        motion.leaves = new[] { hour.transform, minute.transform };
        motion.clockSeconds = 36540f;
        try {
            motion.Apply(0f, 0f, 1);
            float hourAngle = motion.leaves[0].localEulerAngles.z;
            float minuteAngle = motion.leaves[1].localEulerAngles.z;
            // 10:09 -> hour 304.5 deg, minute 54 deg; a positive dial angle is a negative z turn.
            Assert.AreEqual(304.5f, (360f - hourAngle) % 360f, .05f);
            Assert.AreEqual(54f, (360f - minuteAngle) % 360f, .05f);
            // Midnight and 06:00 are the source's other pinned cases.
            motion.clockSeconds = 0f;
            motion.Apply(0f, 0f, 1);
            Assert.AreEqual(0f, motion.leaves[0].localEulerAngles.z, .05f);
            motion.clockSeconds = 21600f;
            motion.Apply(0f, 0f, 1);
            Assert.AreEqual(180f, motion.leaves[0].localEulerAngles.z, .05f);
            // The typed sampler takes seconds since midnight directly.
            motion.ApplyClockSeconds(23400f); // 06:30: hour 195 deg, minute hand at half past = 180 deg
            Assert.AreEqual(195f, (360f - motion.leaves[0].localEulerAngles.z) % 360f, .05f);
            Assert.AreEqual(180f, (360f - motion.leaves[1].localEulerAngles.z) % 360f, .05f);
            motion.ResetPose();
            Assert.AreEqual(304.5f, (360f - motion.leaves[0].localEulerAngles.z) % 360f, .05f,
                "reset restores the builder's 10:09 pose");
        } finally {
            Object.DestroyImmediate(host);
        }
    }

    [Test] public void GatePrefabCarriesItsWingParts() {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/StationDesigner/Generated/Prefabs/Gate.prefab");
        Assert.IsNotNull(prefab);
        var names = prefab.GetComponentsInChildren<Transform>(true).Select(node => node.name).ToArray();
        Assert.Contains("left-leaf", names, "the promoted gate lost its left leaf");
        Assert.Contains("right-leaf", names, "the promoted gate lost its right leaf");
    }

    [Test] public void ClockPrefabCarriesItsHandPivots() {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/StationDesigner/Generated/Prefabs/Clock.prefab");
        Assert.IsNotNull(prefab);
        var names = prefab.GetComponentsInChildren<Transform>(true).Select(node => node.name).ToArray();
        Assert.Contains("clockHourHand", names);
        Assert.Contains("clockMinuteHand", names);
    }

    /* ==================================================== B4: the frame dispatch */

    static readonly List<GameObject> Spawned = new List<GameObject>();
    static readonly List<VerticalModuleView> Views = new List<VerticalModuleView>();

    [TearDown]
    public void TearDown() {
        for (int i = 0; i < Views.Count; i++) {
            var view = Views[i];
            if (view?.Root) Object.DestroyImmediate(view.Root.gameObject);
            view?.Dispose();
        }
        Views.Clear();
        for (int i = 0; i < Spawned.Count; i++) if (Spawned[i]) Object.DestroyImmediate(Spawned[i]);
        Spawned.Clear();
    }

    /// <summary>A frame with every array present but empty, so a test fills only the channel it proves.</summary>
    static StationMotionFrame Frame(bool playing = true, double simTime = 23400) => new StationMotionFrame {
        SessionId = "test", SessionRevision = 1,
        Clock = new StationClockFrame {
            Playing = playing, SimTimeSeconds = simTime, TimeOfDaySeconds = (int)simTime,
        },
        Trains = System.Array.Empty<StationTrainFrame>(),
        Escalators = System.Array.Empty<StationEscalatorFrame>(),
        Lifts = System.Array.Empty<StationLiftFrame>(),
        Doors = System.Array.Empty<StationDoorFrame>(),
    };

    static StationEscalatorFrame EscalatorFrame(string id, double phase, int direction = 1) => new StationEscalatorFrame {
        Id = id, Direction = direction, Speed = VerticalModuleViews.EscalatorSpeed, PhaseMeters = phase, RunLength = 11.546988,
    };

    static StationLiftFrame LiftFrame(string id, int stop, int stopCount, double door) => new StationLiftFrame {
        Id = id, Phase = door > 0 ? "opening" : "idle", DoorFraction = door, Stop = stop, StopCount = stopCount,
    };

    static StationTrainFrame TrainFrame(string id, double door) => new StationTrainFrame {
        Id = id, LineId = id.Split('|')[0], TrackId = id.Split('|')[1], Phase = TrainPhase.Dwell,
        PhaseSeconds = 0, DoorFraction = door,
    };

    static GameObject Host(string name) {
        var host = new GameObject(name);
        Spawned.Add(host);
        return host;
    }

    static ModuleFacts Facts(string json) => ModuleFactsReader.Read(JObject.Parse(json));

    static VerticalModuleView BuildVertical(string json) {
        var parent = Host("vertical-parent");
        var request = VerticalModuleRequest.FromFacts(Facts(json));
        Assert.IsTrue(VerticalModuleViews.TryBuild(request, parent.transform, out var view), "could not build " + json);
        Views.Add(view);
        return view;
    }

    static string EscalatorJson(string id = "esc-test") =>
        "{\"id\":\"" + id + "\",\"type\":\"escalator\",\"x\":0,\"y\":0,\"z\":0,\"rot\":0," +
        "\"from\":{\"x\":0,\"y\":0,\"z\":0},\"to\":{\"x\":0,\"y\":9,\"z\":5}," +
        "\"cfg\":{\"incline\":30,\"dir\":\"up\"}}";

    static string LiftJson(string id = "lift-test") =>
        "{\"id\":\"" + id + "\",\"type\":\"lift\",\"x\":0,\"y\":0,\"z\":0,\"rot\":0," +
        "\"from\":{\"x\":0,\"y\":0,\"z\":0},\"to\":{\"x\":0,\"y\":0,\"z\":10}," +
        "\"cfg\":{\"rises\":[5,5]}}";

    static ModuleMotion LegacyBand(string moduleId, out Transform band) {
        var host = Host("legacy-band");
        band = new GameObject("band").transform;
        band.SetParent(host.transform, false);
        var motion = host.AddComponent<ModuleMotion>();
        motion.moduleId = moduleId;
        motion.kind = ModuleMotion.Kind.EscalatorSteps;
        motion.steps = new[] { band };
        motion.speed = .5f;
        motion.direction = 1f;
        motion.loopMetres = 11.546988f;
        motion.stepPitch = .398172f;
        motion.beltClosed = Vector3.zero;
        motion.beltDirection = new Vector3(.9f, .436f, 0f);
        return motion;
    }

    static Transform MovingPart(VerticalModuleView view, string name) {
        Assert.IsTrue(view.TryGetPart(name, out var part), "missing moving part " + name + " on " + view.ModuleId);
        return part;
    }

    /// <summary>Leaf transforms of one lift door group (`lift-door-leaf*` children).</summary>
    static List<Transform> Leaves(Transform group) =>
        group.Cast<Transform>().Where(child => child.name.StartsWith("lift-door-leaf", System.StringComparison.Ordinal)).ToList();

    [Test]
    public void DispatchDrivesOneEscalatorFromItsOwnFrameAtAnIntermediatePhase() {
        var view = BuildVertical(EscalatorJson());
        var tread = MovingPart(view, "tread-0");
        var dispatch = new ModuleMotionDispatch();
        Assert.IsTrue(dispatch.Bind(view), "the escalator view binds by module id");
        Assert.AreEqual(ModuleMotionChannel.FrameEscalators, dispatch.ChannelOf("esc-test"));

        var frame = Frame();
        frame.Escalators = new[] { EscalatorFrame("esc-test", 3.0) };
        Assert.AreEqual(1, dispatch.Apply(frame));
        var atThree = tread.localPosition;
        Assert.AreEqual(3.0, view.PhaseMeters, 1e-4);

        frame.Escalators = new[] { EscalatorFrame("esc-test", 4.0) };
        Assert.AreEqual(1, dispatch.Apply(frame, 0f), "alpha 0 replays the previous sample");
        Assert.AreEqual(3.0, view.PhaseMeters, 1e-4);
        dispatch.Apply(frame, .5f);
        Assert.AreEqual(3.5, view.PhaseMeters, 1e-4, "alpha 0.5 is the midpoint of the two samples");
        var atMid = tread.localPosition;
        dispatch.Apply(frame);
        var atFour = tread.localPosition;
        // The incline is a linear chain, so the mid sample sits halfway between the ends.
        float whole = Vector3.Distance(atThree, atFour);
        Assert.Greater(whole, .2f, "one metre of chain moves the tread visibly");
        Assert.AreEqual(.5f, Vector3.Distance(atThree, atMid) / whole, .02f, "the mid transform is halfway");
        Assert.Greater(dispatch.Probe("esc-test").Moved, .1f, "the probe measured the step move");
    }

    [Test]
    public void DispatchWrapsTheBeltAcrossTheLoopSeamWithoutATeleport() {
        var motion = LegacyBand("esc-wrap", out var band);
        var dispatch = new ModuleMotionDispatch();
        Assert.IsTrue(dispatch.Bind(motion));
        var frame = Frame();
        frame.Escalators = new[] { EscalatorFrame("esc-wrap", 11.4) };
        dispatch.Apply(frame);
        frame.Escalators = new[] { EscalatorFrame("esc-wrap", .2) };
        // The two samples straddle the seam; the short way across is 0.147 m forward,
        // not 11.2 m backward (`rollEscalator` wraps phase into the chain).
        dispatch.Apply(frame, .5f);
        double expected = 11.4 + ((.2 + 11.546988) - 11.4) * .5 - 11.546988;
        Assert.AreEqual(expected, motion.PhaseMetres, 1e-3, "the interpolated phase crosses the seam");
        Assert.AreEqual(Mathf.Repeat((float)expected, motion.stepPitch), band.localPosition.magnitude, 1e-4);
        // A decreasing chain crosses the seam the other way: 0.2 s back is 11.347 again.
        frame.Escalators = new[] { EscalatorFrame("esc-wrap", .2, -1) };
        dispatch.Apply(frame);
        frame.Escalators = new[] { EscalatorFrame("esc-wrap", 11.347, -1) };
        dispatch.Apply(frame, .5f);
        Assert.Less(motion.PhaseMetres, .2f, "a reversed chain interpolates backwards across the seam");
        Assert.AreEqual(.0f, motion.PhaseMetres, .02f, "half of a 0.4 m reverse step lands on the seam");
        dispatch.Apply(frame);
        Assert.AreEqual(11.347, motion.PhaseMetres, 1e-3, "the endpoint sample is exact");
    }

    [Test]
    public void DispatchHoldsAPausedFrameExactlyAndResumesFromIt() {
        var view = BuildVertical(EscalatorJson("esc-pause"));
        var tread = MovingPart(view, "tread-0");
        var dispatch = new ModuleMotionDispatch();
        dispatch.Bind(view);
        var frame = Frame(playing: true);
        frame.Escalators = new[] { EscalatorFrame("esc-pause", 5.0) };
        dispatch.Apply(frame);
        var running = tread.localPosition;

        // Paused: the session republishes the same phase. Re-sampling at any later real
        // time must write the identical floats — no wall clock is involved.
        var paused = Frame(playing: false);
        paused.Escalators = new[] { EscalatorFrame("esc-pause", 5.0) };
        dispatch.Apply(paused);
        dispatch.Apply(paused);
        Assert.AreEqual(running.x, tread.localPosition.x, "a paused belt does not move in x");
        Assert.AreEqual(running.y, tread.localPosition.y, "a paused belt does not move in y");
        Assert.AreEqual(running.z, tread.localPosition.z, "a paused belt does not move in z");
        Assert.AreEqual(5.0, view.PhaseMeters, 1e-6);
        Assert.AreEqual(running.x, tread.localPosition.x);

        // A resume starts from the same phase, not from a frame-count estimate.
        frame.Escalators = new[] { EscalatorFrame("esc-pause", 5.5) };
        dispatch.Apply(frame, .5f);
        Assert.AreEqual(5.25, view.PhaseMeters, 1e-4);
    }

    [Test]
    public void DispatchDrivesScreenLeavesFromTheDoorFrameAndLeavesAnotherEdgeShut() {
        var first = Host("edge-1");
        var second = Host("edge-2");
        var a = Pivot("leaf-a", new Vector3(2.25f - .6f, 1.175f, -.41f));
        var b = Pivot("leaf-b", new Vector3(2.25f + .6f, 1.175f, -.41f));
        a.transform.SetParent(first.transform, false);
        b.transform.SetParent(first.transform, false);
        var other = Pivot("leaf-c", new Vector3(1f, 1.175f, -.41f));
        other.transform.SetParent(second.transform, false);
        var one = first.AddComponent<ModuleMotion>();
        one.moduleId = "edge-a";
        one.kind = ModuleMotion.Kind.ScreenDoors;
        one.leaves = new[] { a.transform, b.transform };
        one.leavesClosed = new[] { a.transform.localPosition, b.transform.localPosition };
        one.leafTravel = 1.029f;
        var two = second.AddComponent<ModuleMotion>();
        two.moduleId = "edge-b";
        two.kind = ModuleMotion.Kind.ScreenDoors;
        two.leaves = new[] { other.transform };
        two.leavesClosed = new[] { other.transform.localPosition };
        two.leafTravel = 1.029f;

        var dispatch = new ModuleMotionDispatch();
        Assert.IsTrue(dispatch.Bind(one));
        Assert.IsTrue(dispatch.Bind(two));
        var frame = Frame();
        frame.Doors = new[] {
            new StationDoorFrame { PlatformId = "edge-a", LineId = "5", TrackId = "track-1", DoorFraction = 1, TrainPhase = TrainPhase.Dwell },
            new StationDoorFrame { PlatformId = "edge-b", LineId = "5", TrackId = "track-2", DoorFraction = 0, TrainPhase = TrainPhase.Approach },
        };
        Assert.AreEqual(2, dispatch.Apply(frame));
        Assert.AreEqual(-1.029f, a.transform.localPosition.x - (2.25f - .6f), 1e-4);
        Assert.AreEqual(1.029f, b.transform.localPosition.x - (2.25f + .6f), 1e-4);
        Assert.AreEqual(1f, other.transform.localPosition.x, 1e-5, "the other platform edge stays shut");
        // Half a fraction is an intermediate leaf offset, not an on/off switch.
        frame.Doors[0] = new StationDoorFrame { PlatformId = "edge-a", LineId = "5", TrackId = "track-1", DoorFraction = .5, TrainPhase = TrainPhase.Opening };
        dispatch.Apply(frame);
        Assert.AreEqual(-.5145f, a.transform.localPosition.x - (2.25f - .6f), 1e-4);
        // A frame naming no platform edge leaves both where they are.
        frame.Doors = System.Array.Empty<StationDoorFrame>();
        Assert.AreEqual(0, dispatch.Apply(frame));
        Assert.AreEqual(-.5145f, a.transform.localPosition.x - (2.25f - .6f), 1e-4);
    }

    [Test]
    public void DispatchDrivesGateWingsThroughTheirOwnStateAndNotTheFrame() {
        var one = Gate(out var left, out var right);
        one.moduleId = "gate-1";
        var two = Gate(out var otherLeft, out _);
        two.moduleId = "gate-2";
        var dispatch = new ModuleMotionDispatch();
        Assert.IsTrue(dispatch.Bind(one));
        Assert.IsTrue(dispatch.Bind(two));
        Assert.AreEqual(ModuleMotionChannel.PendingCrowd, dispatch.ChannelOf("gate-1"),
            "a gate has a binding but no published frame channel yet (crowd, C3)");
        // The frame must not slam a gate that another system drove: it has no gate channel.
        Assert.IsTrue(dispatch.ApplyOpening("gate-1", 1f));
        Assert.AreEqual(.025f, left.localScale.x * .35f, 1e-3, "the driven gate retracts to its edge");
        Assert.AreEqual(1f, otherLeft.localScale.x, 1e-4, "its neighbour stays shut");
        var frame = Frame();
        dispatch.Apply(frame);
        Assert.AreEqual(.025f, left.localScale.x * .35f, 1e-3, "the frame leaves the gate where its own state put it");
        // Offsets and spacing follow `setGateWing` exactly: width 0.1875 m, leaves at
        // edge + sign*width/2, so the pair still spans its 0.70 m lane.
        dispatch.ApplyOpening("gate-1", .5f);
        Assert.AreEqual(.1875f, left.localScale.x * .35f, 1e-3);
        Assert.AreEqual(-.10625f, left.localPosition.x, 1e-3, "left leaf at its jamb offset");
        Assert.AreEqual(.40625f, right.localPosition.x, 1e-3, "right leaf at its jamb offset");
        Assert.AreEqual(.5125f, right.localPosition.x - left.localPosition.x, 1e-3,
            "the half-open pair keeps its lane spacing");
        Assert.IsFalse(dispatch.ApplyOpening("gate-unknown", 1f), "an unbound id is refused, never applied globally");
        Assert.Greater(dispatch.Probe("gate-1").Moved, .05f, "the gate wings were measured moving");
    }

    [Test]
    public void DispatchDrivesTheLiftCabinAndOnlyTheAlignedLandingDoors() {
        var view = BuildVertical(LiftJson());
        var dispatch = new ModuleMotionDispatch();
        Assert.IsTrue(dispatch.Bind(view));
        Assert.AreEqual(ModuleMotionChannel.FrameLifts, dispatch.ChannelOf("lift-test"));
        Assert.GreaterOrEqual(view.Stops.Count, 3, "the 10 m shaft has three stops");
        var doors = view.Parts.Where(part => part.Name.StartsWith("landing-doors-", System.StringComparison.Ordinal))
            .Select(part => part.Transform).ToArray();
        Assert.GreaterOrEqual(doors.Length, 2, "one landing group per served level");
        var shut = doors.ToDictionary(group => group, group => Leaves(group).Select(leaf => leaf.localPosition.x).ToArray());

        var frame = Frame();
        frame.Lifts = new[] { LiftFrame("lift-test", 0, view.Stops.Count, 0) };
        dispatch.Apply(frame);
        double parked = view.CabinFloorZ;
        foreach (var group in doors) {
            CollectionAssert.AreEqual(shut[group], Leaves(group).Select(leaf => leaf.localPosition.x).ToArray(),
                "no landing opens while the car is parked with its doors shut");
        }

        // Move one interval (fraction 0.5 of the shaft) and open: the aligned landing opens.
        frame.Lifts = new[] { LiftFrame("lift-test", 1, view.Stops.Count, 1) };
        dispatch.Apply(frame);
        Assert.Greater(view.CabinFloorZ, parked, "the cabin rose");
        var opened = doors.Where(group => Leaves(group).Any(leaf => Mathf.Abs(leaf.localPosition.x) > .01f)).ToArray();
        Assert.IsNotEmpty(opened, "the aligned landing opened");
        foreach (var group in doors.Except(opened))
            CollectionAssert.AreEqual(shut[group], Leaves(group).Select(leaf => leaf.localPosition.x).ToArray(),
                "a landing the car is not aligned with stays shut");
        Assert.Greater(dispatch.Probe("lift-test").Moved, .05f, "cabin and leaf travel were measured");

        // Half a door fraction is an intermediate leaf offset, and a paused frame holds it.
        frame.Lifts = new[] { LiftFrame("lift-test", 1, view.Stops.Count, .5) };
        dispatch.Apply(frame);
        var half = opened.SelectMany(Leaves).Select(leaf => leaf.localPosition.x).ToArray();
        dispatch.Apply(frame);
        CollectionAssert.AreEqual(half, opened.SelectMany(Leaves).Select(leaf => leaf.localPosition.x).ToArray(),
            "the paused lift holds its half-open leaves");
    }

    [Test]
    public void DispatchDrivesTheTrainPlatformBankAndLeavesTheOppositeBankShut() {
        var catalogue = AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
        Assert.IsNotNull(catalogue, "train catalogue asset");
        var key = TrainFormations.Select("L", 6, "third-rail", catalogue);
        Assert.IsTrue(catalogue.TryGet(key, out var entry), "formation " + key + " is promoted");
        var consist = Object.Instantiate(entry.prefab);
        Spawned.Add(consist);
        var rig = new TrainDoorRig(consist, TrainDoorRig.ForLine("L", 6, entry.bakedScale));
        Assert.Greater(rig.Leaves, 0, "the formation carries door leaves");
        Assert.Greater(rig.Doors, 0, "the rig paired both banks: " + rig.Describe());
        var dispatch = new ModuleMotionDispatch();
        Assert.IsTrue(dispatch.BindTrain("5|track-1", rig, 1));
        Assert.AreEqual(ModuleMotionChannel.FrameTrains, dispatch.ChannelOf("5|track-1"));
        var frame = Frame();
        frame.Trains = new[] { TrainFrame("5|track-1", 1) };
        Assert.AreEqual(1, dispatch.Apply(frame));
        Assert.AreEqual(1f, rig.Plus, 1e-4, "the platform bank opened");
        Assert.AreEqual(0f, rig.Minus, 1e-6, "the other bank never opens");
        Assert.Greater(rig.Movement, .3f, "the observed platform leaf slid");
        Assert.Greater(dispatch.Probe("5|track-1").Moved, .3f);
        // Half open is the staged plug-and-slide, not a linear squeeze.
        frame.Trains = new[] { TrainFrame("5|track-1", .5) };
        dispatch.Apply(frame);
        Assert.Greater(rig.ObservedTravel, 0f, "the observed leaf has a measured travel");
        Assert.AreEqual(TrainDoorRig.Stage.At(.5f).Slide, rig.Movement / rig.ObservedTravel, .02f,
            "the rig's staged law places the leaf, not a raw lerp");
        var other = dispatch.Apply(Frame());
        Assert.AreEqual(0, other, "a frame with no train channel drives nothing");
        Assert.AreEqual(.5f, rig.Plus, 1e-4, "an unrelated frame does not reset the bank");
    }

    [Test]
    public void DispatchDrivesTheClockFromThePublishedClockAndResetsToTheAuthoredPose() {
        var host = Host("clock-dispatch");
        var hour = Pivot("clockHourHand", Vector3.zero);
        var minute = Pivot("clockMinuteHand", Vector3.zero);
        hour.transform.SetParent(host.transform, false);
        minute.transform.SetParent(host.transform, false);
        var motion = host.AddComponent<ModuleMotion>();
        motion.moduleId = "clock-1";
        motion.kind = ModuleMotion.Kind.ClockHands;
        motion.leaves = new[] { hour.transform, minute.transform };
        var dispatch = new ModuleMotionDispatch();
        Assert.IsTrue(dispatch.Bind(motion));
        Assert.AreEqual(ModuleMotionChannel.FrameClock, dispatch.ChannelOf("clock-1"));
        // The session boots at 06:30 (`REFERENCE_BOOT`).
        dispatch.Apply(Frame(playing: true, simTime: 23400));
        Assert.AreEqual(195f, (360f - hour.transform.localEulerAngles.z) % 360f, .05f);
        Assert.AreEqual(180f, (360f - minute.transform.localEulerAngles.z) % 360f, .05f, "06:30 puts the minute hand at half past");
        // A paused frame at a different time still sets the pose (it is a function of the
        // frame, not of elapsed time), and re-applying it is exact.
        dispatch.Apply(Frame(playing: false, simTime: 45000)); // 12:30
        Assert.AreEqual(15f, (360f - hour.transform.localEulerAngles.z) % 360f, .05f);
        Assert.AreEqual(180f, (360f - minute.transform.localEulerAngles.z) % 360f, .05f);
        dispatch.Reset();
        Assert.AreEqual(304.5f, (360f - hour.transform.localEulerAngles.z) % 360f, .05f, "reset is the builder's 10:09");
        Assert.AreEqual(54f, (360f - minute.transform.localEulerAngles.z) % 360f, .05f);
    }

    [Test]
    public void DispatchResetReturnsEveryFamilyToItsAuthoredClosedPose() {
        var view = BuildVertical(EscalatorJson("esc-reset"));
        var tread = MovingPart(view, "tread-0");
        var gate = Gate(out var left, out _);
        gate.moduleId = "gate-reset";
        var dispatch = new ModuleMotionDispatch();
        dispatch.Bind(view);
        dispatch.Bind(gate);
        // Establish the canonical rest pose through the dispatch itself: a reset writes the
        // authored shut pose with the same arithmetic as a sample of 0, so two resets are
        // bit-identical and no measured residual can hide in a hand-built start pose.
        dispatch.Reset();
        var closedTread = tread.localPosition;
        var closedLeaf = left.localPosition;
        var frame = Frame();
        frame.Escalators = new[] { EscalatorFrame("esc-reset", 6.5) };
        dispatch.Apply(frame);
        dispatch.ApplyOpening("gate-reset", 1f);
        Assert.Greater(Vector3.Distance(closedTread, tread.localPosition), .1f, "the band travelled");
        Assert.AreNotEqual(closedLeaf.x, left.localPosition.x);
        dispatch.Reset();
        Assert.AreEqual(closedTread.x, tread.localPosition.x, "the band re-seats at phase 0 exactly");
        Assert.AreEqual(closedTread.y, tread.localPosition.y);
        Assert.AreEqual(closedTread.z, tread.localPosition.z);
        Assert.AreEqual(closedLeaf.x, left.localPosition.x, "the gate returns to its full-width closed pose exactly");
        Assert.AreEqual(closedLeaf.z, left.localPosition.z);
        Assert.AreEqual(1f, left.localScale.x, "and its authored scale");
        Assert.AreEqual(0, dispatch.Probe("gate-reset").Applied, "a reset forgets the sampled counters");
        Assert.AreEqual(0f, dispatch.Probe("gate-reset").Moved, 1e-6);
    }

    [Test]
    public void DispatchIgnoresIdsItDoesNotHold() {
        var dispatch = new ModuleMotionDispatch();
        var view = BuildVertical(EscalatorJson("esc-only"));
        Assert.IsTrue(dispatch.Bind(view));
        var frame = Frame();
        frame.Escalators = new[] { EscalatorFrame("esc-other", 4.0) };
        Assert.AreEqual(0, dispatch.Apply(frame), "a frame for another module drives nothing");
        Assert.AreEqual(0.0, view.PhaseMeters, 1e-6, "the unaddressed escalator keeps its seated phase");
        Assert.IsFalse(dispatch.Probe("esc-other").Bound);
        Assert.AreEqual(ModuleMotionChannel.None, dispatch.ChannelOf("esc-other"));
        Assert.IsFalse(dispatch.Bind((VerticalModuleView)null));
        Assert.IsFalse(dispatch.Bind((ModuleMotion)null));
    }
}
