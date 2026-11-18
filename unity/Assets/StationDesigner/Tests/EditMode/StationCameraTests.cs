using System;
using Metro.View;
using NUnit.Framework;
using UnityEngine;

/// <summary>
/// Packet D1: the station camera port. The proof pins the source camera's numbers
/// (framing distance, orbit rate, polar stop, FOV/distance/ortho limits, held-pan rate)
/// and both directions of the ViewCube sync: the published document basis is the
/// rendered one, and every face/corner snap drives the eye.
/// </summary>
public class StationCameraTests {
    static Bounds StationBounds() => new Bounds(new Vector3(60f, 20f, -10f), new Vector3(90f, 40f, 35f));

    static StationCameraController Rig(int activeLevel = 0) {
        var rig = new StationCameraController();
        rig.SetStation(StationBounds(), activeLevel);
        return rig;
    }

    internal static void AssertUnit(Vector3 vector, string what) {
        Assert.AreEqual(1f, vector.magnitude, 1e-4, what + " is not unit length");
    }

    internal static void AssertOrthonormal(StationCameraSnapshot snapshot) {
        AssertUnit(snapshot.Right, "right");
        AssertUnit(snapshot.Up, "up");
        AssertUnit(snapshot.Back, "back");
        Assert.AreEqual(0f, Vector3.Dot(snapshot.Right, snapshot.Up), 1e-4, "right·up");
        Assert.AreEqual(0f, Vector3.Dot(snapshot.Right, snapshot.Back), 1e-4, "right·back");
        Assert.AreEqual(0f, Vector3.Dot(snapshot.Up, snapshot.Back), 1e-4, "up·back");
        // Document axes are right-handed for the camera basis; the Unity mirror is
        // applied only by `ApplyTo`, so the cube's dot products can use these directly.
        var cross = Vector3.Cross(snapshot.Right, snapshot.Up);
        Assert.AreEqual(1f, Vector3.Dot(cross, snapshot.Back), 1e-3, "right × up must be back");
    }

    [Test]
    public void FrameRecentresTheActiveStoreyWithoutResettingTheCamera() {
        var rig = Rig(-15);
        rig.SetViewDirection(new Vector3(1, 2, 3), StationProjection.Orthographic);
        rig.PanByMetres(new Vector2(8, 4));
        rig.ZoomBy(0.7f);
        var before = rig.Snapshot();
        using var visibility = new StationVisibilityRegistry();
        var applier = new StationViewCommandApplier(rig, visibility, default);

        Assert.IsTrue(StationViewCommandParser.TryParse("{\"type\":\"camera.frame\"}", out var command, out var parseError), parseError);
        Assert.IsTrue(applier.TryApply(command, out var code), code);

        var after = rig.Snapshot();
        Assert.AreEqual(new Vector3(60, 20, -14), after.Target);
        Assert.That(Vector3.Distance(before.Position - before.Target, after.Position - after.Target), Is.LessThan(1e-4));
        Assert.AreEqual(before.Projection, after.Projection);
        Assert.AreEqual(before.Fov, after.Fov);
        Assert.AreEqual(before.OrthoSize, after.OrthoSize);
    }

    [Test]
    public void HomeIsIsoPerspectiveAtTheDefaultLens() {
        var rig = Rig();
        // `SetStation` opens at the source's 2/3 framing; ⌂ itself is the preset's 1x.
        rig.Home();
        var snapshot = rig.Snapshot();
        Assert.AreEqual(StationProjection.Perspective, snapshot.Projection);
        Assert.AreEqual(StationCameraMath.DefaultFov, snapshot.Fov, 1e-5);
        var expected = StationCameraMath.PresetDirection(StationCameraPreset.Iso);
        Assert.AreEqual(1f, Vector3.Dot(expected, snapshot.Back), 1e-4, "home is the iso back direction");
        Assert.AreEqual(StationBounds().center, snapshot.Target);
        Assert.AreEqual(StationCameraMath.FramingDistance(StationBounds()), snapshot.Distance, 1e-3);
        AssertOrthonormal(snapshot);
    }

    [Test]
    public void SixFaceSnapsAreTrueProjectionsThroughTheStationCentre() {
        var rig = Rig();
        var faces = new[] {
            new Vector3(0f, 0f, 1f), new Vector3(0f, 0f, -1f),
            new Vector3(1f, 0f, 0f), new Vector3(-1f, 0f, 0f),
            new Vector3(0f, 1f, 0f), new Vector3(0f, -1f, 0f),
        };
        foreach (var face in faces) {
            rig.SetViewDirection(face, StationProjection.Orthographic);
            var snapshot = rig.Snapshot();
            Assert.AreEqual(StationProjection.Orthographic, snapshot.Projection, "face " + face);
            Assert.AreEqual(StationBounds().center, snapshot.Target, "face aims at the bounds centre");
            Assert.AreEqual(StationCameraMath.FramingDistance(StationBounds()), snapshot.Distance, 1e-3, "face distance");
            // The top/bottom nudge is the source's own: a hair off the degenerate axis.
            Assert.Greater(Vector3.Dot(snapshot.Back, face.normalized), .999f, "face back " + face);
            AssertOrthonormal(snapshot);
        }
    }

    [Test]
    public void ACornerSnapIsPerspectiveIsometric() {
        var rig = Rig();
        var corner = new Vector3(.5f, .5f, .5f).normalized;
        rig.SetViewDirection(corner, StationProjection.Perspective);
        var snapshot = rig.Snapshot();
        Assert.AreEqual(StationProjection.Perspective, snapshot.Projection, "corners are isometric perspective");
        Assert.AreEqual(1f, Vector3.Dot(snapshot.Back, corner), 1e-4);
        AssertOrthonormal(snapshot);
        // The cube's own visibility test: a corner shows exactly three faces.
        var faces = new[] {
            new Vector3(0f, 0f, 1f), new Vector3(1f, 0f, 0f), new Vector3(0f, 1f, 0f),
            new Vector3(0f, 0f, -1f), new Vector3(-1f, 0f, 0f), new Vector3(0f, -1f, 0f),
        };
        int visible = 0;
        foreach (var face in faces) if (Vector3.Dot(face, snapshot.Back) > .02f) visible++;
        Assert.AreEqual(3, visible, "a corner view shows three faces");
    }

    [Test]
    public void TopAndBottomKeepAStableDefinedRoll() {
        var rig = Rig();
        rig.SetViewDirection(new Vector3(0f, 0f, 1f), StationProjection.Orthographic);
        var top = rig.Snapshot();
        // A top view sees exactly its own face — no sliver of the sides.
        int topVisible = 0;
        foreach (var face in new[] { new Vector3(0f, 0f, 1f), new Vector3(0f, 0f, -1f), new Vector3(1f, 0f, 0f), new Vector3(-1f, 0f, 0f), new Vector3(0f, 1f, 0f), new Vector3(0f, -1f, 0f) }) {
            if (Vector3.Dot(face, top.Back) > .02f) topVisible++;
        }
        Assert.AreEqual(1, topVisible, "top view shows only the top face");
        Assert.Less(Mathf.Abs(Vector3.Dot(top.Up, top.Back)), .01f, "the roll is perpendicular to the view");
        rig.SetViewDirection(new Vector3(1f, 1f, 0f), StationProjection.Orthographic);
        rig.SetViewDirection(new Vector3(0f, 0f, 1f), StationProjection.Orthographic);
        var topAgain = rig.Snapshot();
        Assert.AreEqual(top.Up.x, topAgain.Up.x, 1e-5, "the same top view always has the same roll");
        Assert.AreEqual(top.Up.y, topAgain.Up.y, 1e-5);
        Assert.AreEqual(top.Up.z, topAgain.Up.z, 1e-5);
        rig.SetViewDirection(new Vector3(0f, 0f, -1f), StationProjection.Orthographic);
        var bottom = rig.Snapshot();
        Assert.Less(Mathf.Abs(Vector3.Dot(bottom.Up, bottom.Back)), .01f, "bottom is defined too");
        AssertOrthonormal(bottom);
    }

    [Test]
    public void LevelStepPreservesOrientationAndZoom() {
        var rig = Rig();
        rig.OrbitByPixels(37f, -21f);
        rig.ZoomBy(.7f);
        rig.SetFov(68f);
        var before = rig.Snapshot();
        float orthoZoom = rig.State.OrthoZoom;
        var targetBefore = before.Target;
        var positionBefore = before.Position;
        rig.SetActiveLevel(-15);
        var after = rig.Snapshot();
        Assert.AreEqual(-14f, after.Target.z, 1e-4, "the aim sits one metre above the active floor");
        Assert.AreEqual(after.Target - targetBefore, after.Position - positionBefore, "eye and aim move by the same delta");
        Assert.AreEqual(before.Right.x, after.Right.x, 1e-4);
        Assert.AreEqual(before.Right.y, after.Right.y, 1e-4);
        Assert.AreEqual(before.Right.z, after.Right.z, 1e-4);
        Assert.AreEqual(before.Up.x, after.Up.x, 1e-4);
        Assert.AreEqual(before.Up.y, after.Up.y, 1e-4);
        Assert.AreEqual(before.Up.z, after.Up.z, 1e-4);
        Assert.AreEqual(before.Back.x, after.Back.x, 1e-4);
        Assert.AreEqual(before.Back.y, after.Back.y, 1e-4);
        Assert.AreEqual(before.Back.z, after.Back.z, 1e-4);
        Assert.AreEqual(before.Distance, after.Distance, 1e-3, "a storey step preserves the orbit distance");
        Assert.AreEqual(orthoZoom, rig.State.OrthoZoom, 1e-5);
        Assert.AreEqual(68f, after.Fov, 1e-5, "and the lens");
        Assert.AreEqual(-15, after.ActiveLevel);
    }

    [Test]
    public void HomePutsThePresetProjectionAndLensBack() {
        var rig = Rig();
        rig.SetPreset(StationCameraPreset.Plan);
        rig.SetFov(100f);
        Assert.AreEqual(StationProjection.Orthographic, rig.Snapshot().Projection);
        rig.Home();
        var snapshot = rig.Snapshot();
        Assert.AreEqual(StationProjection.Perspective, snapshot.Projection);
        Assert.AreEqual(StationCameraMath.DefaultFov, snapshot.Fov, 1e-5);
        Assert.AreEqual(1f, Vector3.Dot(snapshot.Back, StationCameraMath.PresetDirection(StationCameraPreset.Iso)), 1e-4);
    }

    [Test]
    public void ANewStationResetsHomeAgainstTheFreshBounds() {
        var rig = Rig();
        rig.OrbitByPixels(40f, 40f);
        rig.SetFov(90f);
        var bounds = new Bounds(new Vector3(-20f, 4f, -30f), new Vector3(30f, 12f, 60f));
        rig.SetStation(bounds, -5);
        var snapshot = rig.Snapshot();
        Assert.AreEqual(bounds.center, snapshot.Target, "a station switch homes against the new bounds");
        Assert.AreEqual(StationCameraMath.FramingDistance(bounds) * 2f / 3f, snapshot.Distance, 1e-3,
            "the source opens a station 50% closer than the preset framing");
        Assert.AreEqual(StationCameraMath.DefaultFov, snapshot.Fov, 1e-5);
        Assert.AreEqual(StationProjection.Perspective, snapshot.Projection);
    }

    [Test]
    public void AStationEditKeepsThePlayersView() {
        var rig = Rig();
        rig.OrbitByPixels(25f, -10f);
        rig.ZoomBy(.55f);
        var before = rig.Snapshot();
        var bounds = StationBounds();
        bounds.Encapsulate(new Vector3(160f, 80f, 20f));
        rig.SetBounds(bounds);
        var after = rig.Snapshot();
        Assert.AreEqual(before.Position, after.Position, "an edit must not move the eye");
        Assert.AreEqual(before.Target, after.Target, "an edit must not move the aim");
        Assert.AreEqual(before.Distance, after.Distance, 1e-3);
    }

    [Test]
    public void ZoomAndLensClampAtTheSourceLimits() {
        var rig = Rig();
        rig.ZoomBy(1e6f);
        Assert.AreEqual(StationCameraMath.MaxDistance, rig.State.Distance, 1e-3);
        rig.ZoomBy(1e-9f);
        Assert.AreEqual(StationCameraMath.MinDistance, rig.State.Distance, 1e-3);

        rig.SetFov(1e6f);
        Assert.AreEqual(StationCameraMath.MaxFov, rig.State.Fov, 1e-4);
        rig.SetFov(-1e6f);
        Assert.AreEqual(StationCameraMath.MinFov, rig.State.Fov, 1e-4);
        float kept = rig.State.Fov;
        rig.SetFov(float.NaN);
        Assert.AreEqual(kept, rig.State.Fov, 1e-5, "a NaN lens is refused, not clamped into a blank frame");
        rig.ZoomBy(float.NaN);
        rig.ZoomBy(0f);
        rig.ZoomBy(-2f);

        rig.SetProjection(StationProjection.Orthographic);
        rig.ZoomBy(1e6f);
        Assert.AreEqual(StationCameraMath.OrthoZoomMax, rig.State.OrthoZoom, 1e-4);
        rig.ZoomBy(1e-9f);
        Assert.AreEqual(StationCameraMath.OrthoZoomMin, rig.State.OrthoZoom, 1e-4);
    }

    [Test]
    public void OrbitStopsShortOfThePolesAndKeepsItsDistance() {
        var rig = Rig();
        rig.OrbitByPixels(11f, -7f);
        float distance = rig.State.Distance;
        rig.OrbitByPixels(0f, 100000f);
        var snapshot = rig.Snapshot();
        float polar = Mathf.Acos(Mathf.Clamp(snapshot.Back.z, -1f, 1f));
        Assert.GreaterOrEqual(polar, StationCameraMath.PolarEpsilon - 1e-3, "the orbit stops short of the north pole");
        Assert.LessOrEqual(polar, Mathf.PI - StationCameraMath.PolarEpsilon + 1e-3, "and the south pole");
        Assert.AreEqual(distance, snapshot.Distance, 1e-3, "an orbit swings around the aim, it does not zoom");
        Assert.IsFalse(float.IsNaN(snapshot.Right.x), "a pole drag leaves a defined basis");
        rig.OrbitByPixels(0f, -100000f);
        Assert.AreEqual(distance, rig.State.Distance, 1e-3, "and the return swing keeps it");
    }

    [Test]
    public void PanMovesEyeAndAimTogether() {
        var rig = Rig();
        var before = rig.Snapshot();
        var offset = before.Position - before.Target;
        rig.PanByMetres(new Vector2(10f, 5f));
        var after = rig.Snapshot();
        Assert.AreEqual(offset.x, after.Position.x - after.Target.x, 1e-4, "camera-relative pan preserves the view angle");
        Assert.AreEqual(offset.y, after.Position.y - after.Target.y, 1e-4);
        Assert.AreEqual(offset.z, after.Position.z - after.Target.z, 1e-4);
        Assert.AreEqual(before.Distance, after.Distance, 1e-3);
        Assert.AreNotEqual(before.Position, after.Position, "the pan moved the eye");
    }

    [Test]
    public void HeldVerticalPanUsesTheSourceRate() {
        var rig = Rig();
        float speed = StationCameraMath.MoveSpeed(rig.State.Distance, false);
        var before = rig.Snapshot();
        rig.SetHeldVertical(1);
        rig.Tick(2f);
        Assert.AreEqual(before.Position.z + speed * 2f, rig.State.Position.z, 1e-3);
        Assert.AreEqual(before.Target.z + speed * 2f, rig.State.Target.z, 1e-3);
        rig.SetHeldVertical(-1);
        rig.Tick(1f);
        Assert.AreEqual(before.Position.z + speed, rig.State.Position.z, 1e-3, "down steps by the same rate");
        rig.SetHeldVertical(0);
        var stopped = rig.State.Position.z;
        rig.Tick(3f);
        Assert.AreEqual(stopped, rig.State.Position.z, 1e-5, "a released hold does not climb");

        var fastBefore = rig.State.Position;
        rig.SetHeldVertical(1);
        rig.Tick(1f, fast: true);
        Assert.AreEqual(fastBefore.z + speed * 3f, rig.State.Position.z, 1e-3, "Shift triples the pan rate");
    }

    [Test]
    public void HeldPlanarPanIsThePointerPanIntegratedOverTime() {
        var rig = Rig();
        float speed = StationCameraMath.MoveSpeed(rig.State.Distance, false);
        var before = rig.Snapshot();
        var offset = before.Position - before.Target;

        // One second of "W" is exactly the metres a pointer drag of the same size moves:
        // one translation, camera and aim together, the view angle untouched.
        rig.SetHeldPlanar(0f, 1f);
        rig.Tick(1f);
        var after = rig.Snapshot();
        Assert.AreEqual(speed, (after.Position - before.Position).magnitude, 1e-3);
        Assert.AreEqual(offset.x, after.Position.x - after.Target.x, 1e-4, "the orbit offset is preserved");
        Assert.AreEqual(offset.y, after.Position.y - after.Target.y, 1e-4);
        Assert.AreEqual(offset.z, after.Position.z - after.Target.z, 1e-4);

        // The same distance through the pointer path is the same translation.
        var dragged = Rig();
        dragged.PanByMetres(new Vector2(0f, speed));
        Assert.AreEqual(dragged.State.Position.x, after.Position.x, 1e-3, "the held pan and the pointer pan agree");
        Assert.AreEqual(dragged.State.Position.y, after.Position.y, 1e-3);
        Assert.AreEqual(dragged.State.Position.z, after.Position.z, 1e-3);

        // Releasing stops it, and the axes are one bounded intent.
        rig.SetHeldPlanar(0f, 0f);
        var stopped = rig.State.Position;
        rig.Tick(2f);
        Assert.AreEqual(stopped, rig.State.Position, "a released hold does not move");
        rig.SetHeldPlanar(9f, -9f);
        Assert.AreEqual(1f, rig.HeldRight, 1e-5, "the intent is bounded to -1…1");
        Assert.AreEqual(-1f, rig.HeldForward, 1e-5);
        rig.SetHeldPlanar(0f, 0f);

        // Shift triples the ground pan too, exactly as it triples the vertical one.
        var fastRig = Rig();
        var fastBefore = fastRig.State.Position;
        fastRig.SetHeldPlanar(1f, 0f, fast: true);
        fastRig.Tick(1f);
        float fastSpeed = StationCameraMath.MoveSpeed(fastRig.State.Distance, true);
        Assert.AreEqual(fastSpeed, (fastRig.State.Position - fastBefore).magnitude, 1e-3);
    }

    [Test]
    public void SnapshotJsonPublishesTheBridgeContract() {
        var rig = Rig();
        var snapshot = rig.Snapshot();
        string json = snapshot.ToJson();
        StringAssert.Contains("\"position\":[", json);
        StringAssert.Contains("\"target\":[", json);
        StringAssert.Contains("\"right\":[", json);
        StringAssert.Contains("\"up\":[", json);
        StringAssert.Contains("\"back\":[", json);
        StringAssert.Contains("\"fov\":45", json);
        StringAssert.Contains("\"ortho\":false", json);
        StringAssert.Contains("\"level\":0", json);
    }

    [Test]
    public void TheAppliedCameraPublishesTheActualRenderedBasis() {
        var host = new GameObject("camera-host");
        try {
            var camera = host.AddComponent<Camera>();
            var rig = Rig();
            rig.ApplyTo(camera);
            var snapshot = rig.Snapshot(camera);
            Assert.IsFalse(camera.orthographic);
            Assert.AreEqual(StationCameraMath.DefaultFov, camera.fieldOfView, 1e-4);
            Assert.AreEqual(StationCameraSpace.ToDocument(camera.transform.position).x, snapshot.Position.x, 1e-3);
            Assert.AreEqual(StationCameraSpace.ToDocument(camera.transform.position).y, snapshot.Position.y, 1e-3);
            Assert.AreEqual(StationCameraSpace.ToDocument(camera.transform.position).z, snapshot.Position.z, 1e-3);
            var renderedRight = StationCameraSpace.ToDocument(camera.transform.right).normalized;
            var renderedUp = StationCameraSpace.ToDocument(camera.transform.up).normalized;
            var renderedBack = -StationCameraSpace.ToDocument(camera.transform.forward).normalized;
            Assert.Greater(Vector3.Dot(renderedRight, snapshot.Right), .9999f, "published right is the rendered right");
            Assert.Greater(Vector3.Dot(renderedUp, snapshot.Up), .9999f, "published up is the rendered up");
            Assert.Greater(Vector3.Dot(renderedBack, snapshot.Back), .9999f, "published back is -the rendered forward");
            AssertOrthonormal(snapshot);

            rig.SetViewDirection(new Vector3(0f, 0f, 1f), StationProjection.Orthographic);
            rig.ApplyTo(camera);
            Assert.IsTrue(camera.orthographic);
            var top = rig.Snapshot(camera);
            Assert.Greater(Vector3.Dot(top.Back, new Vector3(0f, 0f, 1f)), .999f, "a top snap renders a top-down Unity camera");
            Assert.Less(Mathf.Abs(Vector3.Dot(top.Up, top.Back)), .01f);
        } finally {
            UnityEngine.Object.DestroyImmediate(host);
        }
    }

    [Test]
    public void StationGridValidatesLevelsWithoutAFixedAllowlist() {
        var grid = StationLevelGrid.FromDocument(2, 6, new[] { -10, -4, 2, 8 });
        Assert.IsTrue(grid.TryValidate(2, out _), "the height origin");
        Assert.IsTrue(grid.TryValidate(7, out _), "a 5 m view-ladder stop");
        Assert.IsTrue(grid.TryValidate(-4, out _), "a built level off the ladder");
        Assert.IsTrue(grid.TryValidate(8, out _), "the document's own storey pitch");
        Assert.IsFalse(grid.TryValidate(5, out _), "a level that is neither built nor on the grid is refused");
        Assert.IsFalse(grid.TryValidate(3, out _));
        Assert.IsFalse(grid.TryValidate(101, out _), "outside the source edit bound");
        Assert.AreEqual(-3, grid.NearestLadderLevel(-4), "the source nearestLevel snaps to the view ladder");
        Assert.AreEqual(2, grid.Band(4), "storeyBand uses the station's origin");
        Assert.AreEqual(-4, grid.Band(-1));
    }
}

/// <summary>
/// The bridge command parser: every D command the UI can send is parsed into the same
/// typed record, and malformed or unknown commands are refused with a stable code
/// rather than guessed at.
/// </summary>
public class StationViewCommandParserTests {
    static StationViewCommand Parse(string json) {
        Assert.IsTrue(StationViewCommandParser.TryParse(json, out var command, out string error), "parse failed: " + error);
        return command;
    }

    static string Envelope(string type, string payload) =>
        "{\"schemaVersion\":2,\"id\":\"c-7\",\"sessionId\":\"s-1\",\"type\":\"" + type + "\",\"payload\":" + payload + "}";

    [Test]
    public void OrbitPanZoomAndHeldPanTravelAsPixelsAndDeltas() {
        var orbit = Parse(Envelope("camera.orbit", "{\"dx\":12,\"dy\":-4,\"scale\":0.01}"));
        Assert.AreEqual(StationViewCommandType.Orbit, orbit.Type);
        Assert.AreEqual(12f, orbit.Dx, 1e-5);
        Assert.AreEqual(-4f, orbit.Dy, 1e-5);
        Assert.AreEqual(.01f, orbit.Scale, 1e-6);
        Assert.AreEqual("c-7", orbit.Id);
        Assert.AreEqual("s-1", orbit.SessionId);

        var pan = Parse(Envelope("camera.pan", "{\"dx\":8,\"dy\":-3}"));
        Assert.AreEqual(StationViewCommandType.Pan, pan.Type);
        Assert.AreEqual(8f, pan.Dx, 1e-5);

        var zoom = Parse(Envelope("camera.zoom", "{\"delta\":120}"));
        Assert.AreEqual(StationViewCommandType.Zoom, zoom.Type);
        Assert.AreEqual(120f, zoom.Dx, 1e-4);
        Assert.AreEqual(0f, zoom.Factor, 1e-6);

        var held = Parse(Envelope("camera.panHeld", "{\"direction\":-1}"));
        Assert.AreEqual(StationViewCommandType.PanHeld, held.Type);
        Assert.AreEqual(-1, held.HeldDirection);
        Assert.IsFalse(held.HasFast, "a cube arrow carries no Shift flag");
    }

    [Test]
    public void ThePlanarHoldIsABoundedIntentWithTheShiftFlag() {
        var planar = Parse(Envelope("camera.panPlanarHeld", "{\"right\":1,\"forward\":-1,\"fast\":true}"));
        Assert.AreEqual(StationViewCommandType.PanPlanarHeld, planar.Type);
        Assert.AreEqual(1f, planar.HeldRight, 1e-5);
        Assert.AreEqual(-1f, planar.HeldForward, 1e-5);
        Assert.IsTrue(planar.HasFast);
        Assert.IsTrue(planar.Fast);

        // Absent axes mean "not held"; out-of-range values are bounded, not refused.
        var release = Parse(Envelope("camera.panPlanarHeld", "{}"));
        Assert.AreEqual(StationViewCommandType.PanPlanarHeld, release.Type);
        Assert.AreEqual(0f, release.HeldRight, 1e-5);
        Assert.AreEqual(0f, release.HeldForward, 1e-5);
        Assert.IsFalse(release.HasFast, "an omitted flag leaves the host's own state alone");

        var bounded = Parse(Envelope("camera.panPlanarHeld", "{\"right\":3.5,\"forward\":-2}"));
        Assert.AreEqual(1f, bounded.HeldRight, 1e-5);
        Assert.AreEqual(-1f, bounded.HeldForward, 1e-5);

        // The source's axes are also accepted as x/y for a caller that thinks in screen axes.
        var axes = Parse(Envelope("camera.panPlanarHeld", "{\"x\":-0.5,\"y\":0.25}"));
        Assert.AreEqual(-0.5f, axes.HeldRight, 1e-5);
        Assert.AreEqual(0.25f, axes.HeldForward, 1e-5);

        // Shift travels on the vertical hold too, so Ctrl+E with Shift is fast.
        var fastVertical = Parse(Envelope("camera.panHeld", "{\"direction\":1,\"fast\":true}"));
        Assert.IsTrue(fastVertical.HasFast && fastVertical.Fast);

        var bad = "{\"schemaVersion\":2,\"id\":\"c-7\",\"type\":\"camera.panPlanarHeld\",\"payload\":{\"right\":\"left\"}}";
        Assert.IsTrue(StationViewCommandParser.TryParse(bad, out var refused, out _), "a missing axis falls back to zero");
        Assert.AreEqual(0f, refused.HeldRight, 1e-5);
    }

    [Test]
    public void LensProjectionHomeAndSnapsMatchTheLeadContract() {
        var fov = Parse(Envelope("camera.fov", "{\"deg\":67}"));
        Assert.AreEqual(StationViewCommandType.Fov, fov.Type);
        Assert.AreEqual(67f, fov.Degrees, 1e-4);

        var projection = Parse(Envelope("camera.projection", "{\"ortho\":true}"));
        Assert.AreEqual(StationViewCommandType.Projection, projection.Type);
        Assert.AreEqual(StationProjection.Orthographic, projection.Projection);

        var home = Parse(Envelope("camera.home", "{}"));
        Assert.AreEqual(StationViewCommandType.Home, home.Type);

        var face = Parse(Envelope("camera.snap", "{\"face\":\"top\"}"));
        Assert.AreEqual(StationViewCommandType.Snap, face.Type);
        Assert.IsTrue(face.HasDirection);
        Assert.AreEqual(StationProjection.Orthographic, face.Projection, "a face is a true projection");
        Assert.AreEqual(1f, Vector3.Dot(face.Direction.normalized, new Vector3(0f, 0f, 1f)), 1e-4);

        var corner = Parse(Envelope("camera.snap", "{\"face\":\"dir:0.5774,0.5774,0.5774\",\"direction\":[0.5774,0.5774,0.5774],\"projection\":\"perspective\"}"));
        Assert.AreEqual(StationProjection.Perspective, corner.Projection, "a corner is perspective");
    }

    [Test]
    public void ViewSetParsesEveryToggleAndTheSection() {
        Assert.AreEqual(-15, Parse(Envelope("view.set", "{\"key\":\"level\",\"value\":-15}")).IntValue);
        foreach (var key in new[] { "showLevels", "ceiling", "walls", "ground", "roof", "hideUi", "levelRail", "cutaway", "exploded" }) {
            var command = Parse(Envelope("view.set", "{\"key\":\"" + key + "\",\"value\":true}"));
            Assert.AreEqual(StationViewCommandType.ViewSet, command.Type, key);
            Assert.IsTrue(command.BoolValue, key);
        }
        var section = Parse(Envelope("view.set", "{\"key\":\"section\",\"value\":{\"anchor\":[1,2,-8],\"azimuth\":90,\"offset\":2.5}}"));
        Assert.AreEqual(StationViewKey.Section, section.Key);
        Assert.IsTrue(section.HasSection);
        Assert.AreEqual(new Vector3(1f, 2f, -8f), section.Section.Anchor);
        Assert.AreEqual(90f, section.Section.Azimuth, 1e-4);
        Assert.AreEqual(2.5f, section.Section.Offset, 1e-4);

        var rotate = Parse(Envelope("view.set", "{\"key\":\"sectionRotate\",\"value\":\"next\"}"));
        Assert.AreEqual(StationViewKey.SectionRotate, rotate.Key);
        Assert.IsTrue(rotate.RotateToNext);

        var slide = Parse(Envelope("view.set", "{\"key\":\"sectionOffset\",\"value\":3.5}"));
        Assert.AreEqual(StationViewKey.SectionOffset, slide.Key);
        Assert.AreEqual(3.5f, slide.FloatValue, 1e-4);

        var hideSurface = Parse(Envelope("view.set", "{\"key\":\"hideSectionSurface\",\"value\":true}"));
        Assert.AreEqual(StationViewKey.SectionSurface, hideSurface.Key);
        Assert.IsFalse(hideSurface.BoolValue, "隐藏剖切面 true means the surface is not visible");

        var levelBool = Envelope("view.set", "{\"key\":\"level\",\"value\":true}");
        Assert.IsFalse(StationViewCommandParser.TryParse(levelBool, out _, out string error), "a boolean level is refused");
        Assert.AreEqual("bad-level", error);
    }

    [Test]
    public void MalformedAndUnknownCommandsAreRefused() {
        Assert.IsFalse(StationViewCommandParser.TryParse("{", out _, out _), "truncated JSON is refused");
        Assert.IsFalse(StationViewCommandParser.TryParse("{}", out _, out string missing));
        Assert.AreEqual("missing-type", missing);
        Assert.IsFalse(StationViewCommandParser.TryParse(Envelope("camera.nope", "{}"), out _, out string unknown));
        Assert.AreEqual("unsupported-command", unknown);
        Assert.IsFalse(StationViewCommandParser.TryParse(Envelope("view.set", "{\"key\":\"nope\",\"value\":true}"), out _, out string key));
        Assert.AreEqual("unknown-view-key", key);
        Assert.IsFalse(StationViewCommandParser.TryParse(Envelope("camera.orbit", "{\"dx\":\"left\"}"), out _, out string orbit));
        Assert.AreEqual("bad-orbit", orbit);
        Assert.IsFalse(StationViewCommandParser.TryParse(Envelope("camera.snap", "{\"face\":\"sideways\"}"), out _, out string snap));
        Assert.AreEqual("bad-snap", snap);
    }

    [Test]
    public void FrameStandalonePresentationFitsPackedTraysWithMarginAndExtendedMaxDistance() {
        var rig = new StationCameraController();
        var boxes = new[] {
            new Bounds(new Vector3(0f, 0f, -15f), new Vector3(40f, 30f, 5f)),
            new Bounds(new Vector3(0f, 60f, -10f), new Vector3(40f, 30f, 5f)),
            new Bounds(new Vector3(0f, 120f, 0f), new Vector3(40f, 30f, 5f)),
        };
        float aspect = 16f / 9f;
        rig.FrameStandalonePresentation(boxes, aspect);

        Assert.AreEqual(StationCameraMath.MaxStandaloneDistance, rig.MaxDistance, 1e-4f);
        var snap = rig.Snapshot();
        Assert.AreEqual(StationProjection.Orthographic, snap.Projection);
        StationCameraTests.AssertOrthonormal(snap);

        float halfH = snap.OrthoSize;
        float halfW = halfH * aspect;
        foreach (var box in boxes) {
            for (int c = 0; c < 8; c++) {
                var corner = new Vector3(
                    (c & 1) == 0 ? box.min.x : box.max.x,
                    (c & 2) == 0 ? box.min.y : box.max.y,
                    (c & 4) == 0 ? box.min.z : box.max.z);
                var rel = corner - snap.Target;
                float projX = Mathf.Abs(Vector3.Dot(rel, snap.Right));
                float projY = Mathf.Abs(Vector3.Dot(rel, snap.Up));
                Assert.LessOrEqual(projX, halfW * 1.001f, "every packed corner fits horizontally within the framed ortho frustum");
                Assert.LessOrEqual(projY, halfH * 1.001f, "every packed corner fits vertically within the framed ortho frustum");
            }
        }

        // Verify zoom can reach beyond the editor's 400 m limit when switched to perspective or wide distance
        rig.SetProjection(StationProjection.Perspective);
        rig.ZoomBy(100f);
        Assert.AreEqual(StationCameraMath.MaxStandaloneDistance, rig.State.Distance, 1e-2f);
    }

    [Test]
    public void TrayDragDeltaMatchesThreeOrthographicFormulaAcrossYawsAndDpi() {
        var rig = new StationCameraController();
        rig.FrameStandalonePresentation(new[] {
            new Bounds(new Vector3(10f, 20f, -5f), new Vector3(50f, 50f, 5f)),
        }, 16f / 9f);

        foreach (float yawPixels in new[] { 0f, 95f, -210f, 430f }) {
            if (yawPixels != 0f) rig.OrbitByPixels(yawPixels, -18f);
            var snap = rig.Snapshot();
            float scaleAt720 = (2f * snap.OrthoSize) / 720f;

            // Horizontal CSS pixel drag moves along camera Right (purely horizontal in document XY, Z == 0)
            var rightMove = rig.TrayDragDelta(80f, 0f, 720f);
            Assert.AreEqual(0f, rightMove.z, 1e-6f, "horizontal drag never changes tray elevation");
            Assert.AreEqual(snap.Right.x * 80f * scaleAt720, rightMove.x, 1e-4f);
            Assert.AreEqual(snap.Right.y * 80f * scaleAt720, rightMove.y, 1e-4f);

            // Vertical CSS pixel drag (dy < 0 = dragging upward on screen) lifts tray Z and projects camera Up
            var upMove = rig.TrayDragDelta(0f, -60f, 720f);
            Assert.Greater(upMove.z, 0f, "dragging upward on screen lifts tray Z");
            Assert.AreEqual(snap.Up.x * 60f * scaleAt720, upMove.x, 1e-4f);
            Assert.AreEqual(snap.Up.y * 60f * scaleAt720, upMove.y, 1e-4f);
            Assert.AreEqual(snap.Up.z * 60f * scaleAt720, upMove.z, 1e-4f);

            // DPI independence: TrayDragDelta depends only on CSS viewportHeight, so 2x backing resolution
            // with the same CSS delta and CSS viewportHeight produces the exact same world displacement.
            var camGo = new GameObject("TempViewerCam");
            try {
                var cam = camGo.AddComponent<Camera>();
                rig.ApplyTo(cam);
                var withLiveCam = rig.TrayDragDelta(45f, -30f, 720f, cam);
                var withoutCam = rig.TrayDragDelta(45f, -30f, 720f, null);
                Assert.AreEqual(withoutCam.x, withLiveCam.x, 1e-3f);
                Assert.AreEqual(withoutCam.y, withLiveCam.y, 1e-3f);
                Assert.AreEqual(withoutCam.z, withLiveCam.z, 1e-3f);
            } finally {
                UnityEngine.Object.DestroyImmediate(camGo);
            }
        }
    }
}
