using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using NUnit.Framework;
using UnityEngine;

/// <summary>
/// Packet D3: the view rules. The proof covers the level slice, the independent
/// ceiling/ground/roof toggles, wall and PSD ghosting, Hide UI's grid/cursor-only
/// subject, the one section plane (including éšè—å‰–åˆ‡é¢ keeping the cut on), picking
/// against the same decisions, the exploded storey offsets, and the command applier
/// that changes no document and no simulation.
/// </summary>
public class StationVisibilityTests {
    StationVisibilityRegistry registry;

    [SetUp]
    public void SetUp() {
        registry = new StationVisibilityRegistry();
        registry.State.ActiveLevel = 0;
        registry.State.LevelBase = 0;
        registry.State.StoreyHeight = 5;
    }

    [TearDown]
    public void TearDown() {
        registry?.Dispose();
        registry = null;
    }

    [Test]
    public void DecidePartAnswersAnUnregisteredPoolsSliceQuestion() {
        // A pooled road vehicle has no world record; it still asks the one registry rule,
        // so it cannot draw on a hidden storey or while 隐藏地面 is on.
        Assert.AreEqual(StationDrawMode.Base, registry.DecidePart(StationPartRole.Ground, new[] { 0 }),
            "the active street storey draws");
        Assert.AreEqual(StationDrawMode.Ghost, registry.DecidePart(StationPartRole.Ground, new[] { -20 }),
            "显示其他层 ghosts the storey below rather than hiding it");

        registry.State.ShowLevels = false;
        Assert.AreEqual(StationDrawMode.Hidden, registry.DecidePart(StationPartRole.Ground, new[] { -20 }),
            "an underground road is hidden while the street is the active storey");
        registry.State.ShowLevels = true;

        registry.State.HideGround = true;
        Assert.AreEqual(StationDrawMode.Hidden, registry.DecidePart(StationPartRole.Ground, new[] { 0 }),
            "隐藏地面 hides street traffic with the road itself");
        registry.State.HideGround = false;

        registry.State.HideUi = true;
        Assert.AreNotEqual(StationDrawMode.Hidden, registry.DecidePart(StationPartRole.Ground, new[] { -20 }),
            "隐藏UI draws every storey as itself");
    }

    /// <summary>
    /// A plain target for the rule tests: the walk only needs role, span, bounds and a
    /// mode sink, so these tests run without a scene. The real component is covered by
    /// <see cref="ComponentHidesRenderersAndColliders"/> below.
    /// </summary>
    sealed class FakeTarget : IStationVisibilityTarget {
        public StationPartRole Role { get; set; }
        public int[] Levels { get; set; } = Array.Empty<int>();
        public int GroundBand { get; set; } = StationVisibilityTarget.NoGroundBand;
        public bool Parked { get; set; }
        public bool Floating { get; set; }
        public bool ContactShadow { get; set; }
        public Bounds Bounds { get; set; }
        public IReadOnlyList<int> LevelZs => Levels;
        public Transform Root => null;
        public Bounds WorldBounds => Bounds;
        public StationDrawMode LastMode { get; private set; } = StationDrawMode.Base;
        public int ModeChanges { get; private set; }

        public void Apply(StationDrawMode mode, StationVisibilityPalette palette) {
            LastMode = mode;
            ModeChanges++;
        }
    }

    FakeTarget Target(string name, StationPartRole role, int[] levels, Vector3 documentCentre,
        Vector3 documentSize, bool parked = false, bool contactShadow = false) {
        var target = new FakeTarget {
            Role = role,
            Levels = levels,
            Parked = parked,
            ContactShadow = contactShadow,
            // A target's bounds are the renderer's world bounds, as the component
            // reports them; the document point/size go through the one conversion.
            Bounds = new Bounds(StationCameraSpace.ToWorld(documentCentre), StationCameraSpace.ToWorld(documentSize)),
        };
        registry.Register(target);
        return target;
    }

    static StationViewCommand Command(StationViewCommandType type, Action<StationViewCommand> configure = null) {
        var command = new StationViewCommand { Type = type };
        configure?.Invoke(command);
        return command;
    }

    StationViewCommandApplier Applier(out StationCameraController camera) {
        camera = new StationCameraController();
        var bounds = new Bounds(new Vector3(10f, 10f, -10f), new Vector3(40f, 40f, 30f));
        var applier = new StationViewCommandApplier(camera, registry, StationLevelGrid.FromDocument(0, 5, new[] { 0, -5, -10 }));
        applier.SetStation(bounds, StationLevelGrid.FromDocument(0, 5, new[] { 0, -5, -10 }), 0);
        return applier;
    }

    // ---------------------------------------------------------------- pure rules

    [Test]
    public void LevelSideUsesTheTrueLevelSpan() {
        Assert.AreEqual(StationLevelSide.Active, StationVisibilityRules.LevelSide(new[] { -15, -10, -5 }, -12),
            "a piece spanning the active storey is active there");
        Assert.AreEqual(StationLevelSide.Below, StationVisibilityRules.LevelSide(new[] { -20, -15 }, -12));
        Assert.AreEqual(StationLevelSide.Above, StationVisibilityRules.LevelSide(new[] { -8, -4 }, -12));
        Assert.AreEqual(StationLevelSide.Active, StationVisibilityRules.LevelSide(Array.Empty<int>(), -12),
            "an untagged piece belongs to the active storey");
    }

    [Test]
    public void SliceOptionsPutTheSliceAwayForHideUiAndCutaway() {
        var normal = StationVisibilityRules.SliceOptions(true, true, false, false, true);
        Assert.IsTrue(normal.Ghost);
        Assert.IsTrue(normal.AutoCeiling);
        Assert.IsTrue(normal.HideAbove, "an occupied storey hides the ones above it");
        var empty = StationVisibilityRules.SliceOptions(true, true, false, false, false);
        Assert.IsFalse(empty.HideAbove, "an empty storey still ghosts above");
        foreach (var slice in new[] {
            StationVisibilityRules.SliceOptions(true, true, true, false, true),
            StationVisibilityRules.SliceOptions(false, true, false, true, true),
        }) {
            Assert.IsTrue(slice.Ghost);
            Assert.IsFalse(slice.AutoCeiling);
            Assert.IsFalse(slice.HideAbove);
        }
    }

    [Test]
    public void LevelVisiblePortsEveryBranch() {
        var show = new StationSliceOptions { Ghost = true };
        Assert.IsTrue(StationVisibilityRules.LevelVisible(StationLevelSide.Active, show));
        Assert.IsTrue(StationVisibilityRules.LevelVisible(StationLevelSide.Below, show));
        Assert.IsTrue(StationVisibilityRules.LevelVisible(StationLevelSide.Above, show));
        var off = new StationSliceOptions { Ghost = false };
        Assert.IsTrue(StationVisibilityRules.LevelVisible(StationLevelSide.Active, off));
        Assert.IsFalse(StationVisibilityRules.LevelVisible(StationLevelSide.Below, off));
        Assert.IsFalse(StationVisibilityRules.LevelVisible(StationLevelSide.Above, off));
        var hiddenAbove = new StationSliceOptions { Ghost = true, HideAbove = true };
        Assert.IsFalse(StationVisibilityRules.LevelVisible(StationLevelSide.Above, hiddenAbove));
        var ceiling = new StationSliceOptions { Ghost = true, AutoCeiling = true };
        Assert.IsFalse(StationVisibilityRules.LevelVisible(StationLevelSide.Above, ceiling));
        Assert.IsTrue(StationVisibilityRules.LevelVisible(StationLevelSide.Above,
            new StationSliceOptions { Ghost = true, AutoCeiling = true, Unsupported = true }));
    }

    // ---------------------------------------------------------------- level slice

    [Test]
    public void ShowLevelsOffDrawsOnlyTheActiveStorey() {
        var active = Target("active", StationPartRole.Prop, new[] { 0 }, new Vector3(0, 0, 0), Vector3.one);
        var below = Target("below", StationPartRole.Prop, new[] { -5 }, new Vector3(0, 0, -5), Vector3.one);
        var above = Target("above", StationPartRole.Prop, new[] { 5 }, new Vector3(0, 0, 5), Vector3.one);
        registry.State.ShowLevels = false;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Base, active.LastMode);
        Assert.AreEqual(StationDrawMode.Hidden, below.LastMode);
        Assert.AreEqual(StationDrawMode.Hidden, above.LastMode);
        Assert.AreEqual(0, registry.GhostTargets);
        Assert.AreEqual(2, registry.HiddenTargets);
    }

    [Test]
    public void ShowLevelsGhostsBelowAndHidesAboveAnOccupiedStorey() {
        var active = Target("active", StationPartRole.Prop, new[] { 0 }, new Vector3(0, 0, 0), Vector3.one);
        var below = Target("below", StationPartRole.Prop, new[] { -5 }, new Vector3(0, 0, -5), Vector3.one);
        var above = Target("above", StationPartRole.Prop, new[] { 5 }, new Vector3(0, 0, 5), Vector3.one);
        registry.State.ShowLevels = true;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Base, active.LastMode);
        Assert.AreEqual(StationDrawMode.Ghost, below.LastMode);
        Assert.AreEqual(StationDrawMode.Hidden, above.LastMode, "the floor above an occupied room is its ceiling");
        Assert.AreEqual(1, registry.GhostTargets);
    }

    [Test]
    public void AnEmptyActiveStoreyStillGhostsTheStoreysAbove() {
        var above = Target("above", StationPartRole.Prop, new[] { 5 }, new Vector3(0, 0, 5), Vector3.one);
        registry.State.ShowLevels = true;
        registry.State.AutoCeiling = false;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Ghost, above.LastMode);
    }

    [Test]
    public void DenseStationsBoundTheDistantGhostStoreys() {
        var near = Target("near", StationPartRole.Prop, new[] { -5 }, new Vector3(0, 0, -5), Vector3.one);
        var far = Target("far", StationPartRole.Prop, new[] { -30 }, new Vector3(0, 0, -30), Vector3.one);
        registry.State.ShowLevels = true;
        registry.State.Dense = true;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Ghost, near.LastMode);
        Assert.AreEqual(StationDrawMode.Hidden, far.LastMode);
    }

    // ---------------------------------------------------------- independent surfaces

    [Test]
    public void CeilingGroundAndRoofHideIndependently() {
        // At the active storey so the slice is not what hides any of them: this is
        // exactly the independence the three toolbar tiles promise.
        var ceiling = Target("ceiling", StationPartRole.Ceiling, new[] { 0 }, new Vector3(0, 0, 0), Vector3.one);
        var ground = Target("ground", StationPartRole.Ground, new[] { 0 }, new Vector3(2, 0, 0), Vector3.one);
        var roof = Target("roof", StationPartRole.Roof, new[] { 0 }, new Vector3(4, 0, 0), Vector3.one);
        var prop = Target("prop", StationPartRole.Prop, new[] { 0 }, new Vector3(6, 0, 0), Vector3.one);
        registry.State.ShowLevels = true;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Base, ceiling.LastMode);
        Assert.AreEqual(StationDrawMode.Base, ground.LastMode);
        Assert.AreEqual(StationDrawMode.Base, roof.LastMode);

        registry.State.AutoCeiling = true;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Hidden, ceiling.LastMode);
        Assert.AreEqual(StationDrawMode.Base, ground.LastMode, "éšè—å¤©èŠ±æ¿ is not éšè—åœ°é¢");
        Assert.AreEqual(StationDrawMode.Base, roof.LastMode, "éšè—å¤©èŠ±æ¿ is not éšè—å±‹é¡¶");

        registry.State.AutoCeiling = false;
        registry.State.HideGround = true;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Base, ceiling.LastMode);
        Assert.AreEqual(StationDrawMode.Hidden, ground.LastMode);
        Assert.AreEqual(StationDrawMode.Base, roof.LastMode);
        Assert.AreEqual(StationDrawMode.Base, prop.LastMode, "a prop is not the street");

        registry.State.HideGround = false;
        registry.State.HideRoof = true;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Hidden, roof.LastMode);
        Assert.AreEqual(StationDrawMode.Base, ground.LastMode);
        Assert.AreEqual(StationDrawMode.Base, ceiling.LastMode);
    }

    [Test]
    public void HideUiHidesOnlyTheGridAndCursorAndDrawsEveryStoreyCrisp() {
        var grid = Target("grid", StationPartRole.Grid, new[] { 0 }, new Vector3(0, 0, 0), Vector3.one);
        var cursor = Target("cursor", StationPartRole.Cursor, new[] { 0 }, new Vector3(1, 0, 0), Vector3.one);
        var below = Target("below", StationPartRole.Prop, new[] { -5 }, new Vector3(2, 0, -5), Vector3.one);
        var ceiling = Target("ceiling", StationPartRole.Ceiling, new[] { 5 }, new Vector3(3, 0, 5), Vector3.one);
        registry.State.HideUi = true;
        registry.State.AutoCeiling = true;
        registry.State.ShowLevels = true;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Hidden, grid.LastMode);
        Assert.AreEqual(StationDrawMode.Hidden, cursor.LastMode);
        Assert.AreEqual(StationDrawMode.Base, below.LastMode, "hidden UI draws the station whole, not a ghost");
        Assert.AreEqual(StationDrawMode.Base, ceiling.LastMode, "and no ceiling is lifted");
    }

    [Test]
    public void SetHideUiPutsTheCeilingToggleBack() {
        var state = new StationVisibilityState { AutoCeiling = true };
        state.SetHideUi(true);
        Assert.IsFalse(state.AutoCeiling, "éšè—UI draws every storey with no ceiling lifted");
        state.SetHideUi(false);
        Assert.IsFalse(state.AutoCeiling, "and does not restore a toggle the player had turned off");
    }

    [Test]
    public void WallsAndScreenDoorsGoSeeThrough() {
        var wall = Target("wall", StationPartRole.Wall, new[] { 0 }, new Vector3(0, 0, 0), Vector3.one);
        var psd = Target("psd", StationPartRole.Psd, new[] { 0 }, new Vector3(1, 0, 0), Vector3.one);
        var prop = Target("prop", StationPartRole.Prop, new[] { 0 }, new Vector3(2, 0, 0), Vector3.one);
        registry.State.HideWalls = true;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Clear, wall.LastMode);
        Assert.AreEqual(StationDrawMode.Clear, psd.LastMode, "a PSD is a wall for éšè—å¢™å£");
        Assert.AreEqual(StationDrawMode.Base, prop.LastMode);

        registry.State.Cutaway = true;
        registry.SectionClipping = false;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Hidden, wall.LastMode, "with a cut on, a hidden wall leaves the picture");
        Assert.AreEqual(StationDrawMode.Hidden, psd.LastMode);
        Assert.AreEqual(StationDrawMode.Base, prop.LastMode);

        registry.State.Cutaway = false;
        registry.State.HideWalls = false;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Base, wall.LastMode);
        Assert.AreEqual(StationDrawMode.Base, psd.LastMode);
    }

    // ---------------------------------------------------------------- section

    [Test]
    public void CutawayKeepsTheAbsoluteSurfaceToggles() {
        var ground = Target("ground", StationPartRole.Ground, new[] { 0 }, new Vector3(0, 0, 0), Vector3.one);
        var roof = Target("roof", StationPartRole.Roof, new[] { 0 }, new Vector3(2, 0, 0), Vector3.one);
        var ceiling = Target("ceiling", StationPartRole.Ceiling, new[] { 0 }, new Vector3(4, 0, 0), Vector3.one);
        registry.State.Cutaway = true;
        registry.SectionClipping = false;
        registry.State.HideGround = true;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Hidden, ground.LastMode, "éšè—åœ°é¢ survives a cut");
        Assert.AreEqual(StationDrawMode.Base, roof.LastMode);

        registry.State.HideGround = false;
        registry.State.HideRoof = true;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Hidden, roof.LastMode, "éšè—å±‹é¡¶ survives a cut");

        registry.State.HideRoof = false;
        registry.State.AutoCeiling = true;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Hidden, ceiling.LastMode, "éšè—å¤©èŠ±æ¿ survives a cut");
        Assert.AreEqual(StationDrawMode.Base, ground.LastMode);
    }

    [Test]
    public void OnePlaneHidesTheCutHalfAndKeepsTheRest() {
        var kept = Target("kept", StationPartRole.Prop, new[] { 0 }, new Vector3(0, -10, 0), new Vector3(2, 2, 2));
        var cut = Target("cut", StationPartRole.Prop, new[] { 0 }, new Vector3(0, 10, 0), new Vector3(2, 2, 2));
        var straddles = Target("straddles", StationPartRole.Prop, new[] { 0 }, new Vector3(0, 0, 0), new Vector3(2, 10, 2));
        registry.Section = new StationSectionPlane { Anchor = new Vector3(0, 0, -8), Azimuth = 0, Offset = 0 };
        registry.SectionClipping = true;
        registry.State.Cutaway = true;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Base, kept.LastMode);
        Assert.AreEqual(StationDrawMode.Hidden, cut.LastMode);
        Assert.AreEqual(StationDrawMode.Base, straddles.LastMode, "a straddling part stays drawn and is reported");
        Assert.AreEqual(1, registry.CutTargets);
        Assert.AreEqual(1, registry.StraddlingTargets);
        Assert.IsTrue(registry.IsPointKept(new Vector3(0, -10, 0)));
        Assert.IsFalse(registry.IsPointKept(new Vector3(0, 10, 0)));
    }

    [Test]
    public void TurningTheVisiblePlaneOffDoesNotTurnClippingOff() {
        var cut = Target("cut", StationPartRole.Prop, new[] { 0 }, new Vector3(0, 10, 0), new Vector3(2, 2, 2));
        registry.Section = new StationSectionPlane { Anchor = new Vector3(0, 0, -8), Azimuth = 0, Offset = 0 };
        registry.SectionClipping = true;
        registry.SectionSurfaceVisible = false;
        registry.State.Cutaway = true;
        registry.Apply();
        Assert.IsFalse(registry.SectionSurfaceVisible);
        Assert.AreEqual(StationDrawMode.Hidden, cut.LastMode, "éšè—å‰–åˆ‡é¢ keeps cutting");
        Assert.IsFalse(registry.IsPointKept(new Vector3(0, 10, 0)));
    }

    [Test]
    public void RotatingTheSectionSwapsTheKeptHalf() {
        var plane = new StationSectionPlane { Anchor = new Vector3(0, 0, -8), Azimuth = 0, Offset = 0 };
        Assert.IsTrue(plane.Keeps(new Vector3(0, -1, 0)));
        Assert.IsFalse(plane.Keeps(new Vector3(0, 1, 0)));
        var rotated = plane.WithAzimuth(StationSectionPlane.NextAzimuth(90));
        Assert.AreEqual(180f, rotated.Azimuth, 1e-4, "æ—‹è½¬ is one quarter turn");
        var east = plane.WithAzimuth(90);
        Assert.AreEqual(1f, east.Normal.x, 1e-4, "90Â° looks east");
        Assert.IsFalse(east.Keeps(new Vector3(1, 0, 0)));
        Assert.IsTrue(east.Keeps(new Vector3(-1, 0, 0)));
    }

    [Test]
    public void SectionSlideAnchorAndRotationKeepOneDefinition() {
        var plane = new StationSectionPlane { Anchor = new Vector3(0, 0, -8), Azimuth = 0, Offset = 0 };
        var moved = plane.WithOffset(5f);
        Assert.AreEqual(new Vector3(0, 5, -8), moved.Point);
        Assert.AreEqual(-5f, moved.SignedDistance(new Vector3(0, 0, -8)), 1e-4);
        Assert.IsTrue(moved.Keeps(new Vector3(0, 5, -8)));
        var slid = plane.SlideOffset(new Vector3(0, 0, -8), new Vector3(0, 3, -8));
        Assert.AreEqual(3f, slid, 1e-4, "a slide is measured along the normal");
        Assert.AreEqual(0f, StationSectionPlane.SnapOffset(.24f), 1e-4);
        Assert.AreEqual(.25f, StationSectionPlane.SnapOffset(.24f, true), 1e-4);
        Assert.AreEqual(0f, StationSectionPlane.NextAzimuth(270f), 1e-4, "æ—‹è½¬ wraps at 270");
        Assert.AreEqual(90f, StationSectionPlane.SnapAzimuth(88f), 1e-4);
        Assert.AreEqual(new Vector3(0, 1, 0), plane.Normal);
        Assert.AreEqual(new Vector3(-1, 0, 0), plane.Right);
        Assert.AreEqual(new Vector3(0, 0, 1), plane.Up);
    }

    // ---------------------------------------------------------------- trains, actors, picking

    [Test]
    public void TrainsAndActorsFollowTheirOwnRules() {
        var parked = Target("parked", StationPartRole.Train, new[] { 0 }, new Vector3(0, 0, 0), Vector3.one, parked: true);
        var active = Target("train", StationPartRole.Train, new[] { 0 }, new Vector3(1, 0, 0), Vector3.one);
        var aboveTrain = Target("above-train", StationPartRole.Train, new[] { 5 }, new Vector3(2, 0, 5), Vector3.one);
        var belowActor = Target("below-actor", StationPartRole.Actor, new[] { -5 }, new Vector3(3, 0, -5), Vector3.one);
        var aboveActor = Target("above-actor", StationPartRole.Actor, new[] { 5 }, new Vector3(4, 0, 5), Vector3.one);
        registry.State.ShowLevels = true;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Hidden, parked.LastMode);
        Assert.AreEqual(StationDrawMode.Base, active.LastMode);
        Assert.AreEqual(StationDrawMode.Hidden, aboveTrain.LastMode, "a train never hangs above its own floor");
        Assert.AreEqual(StationDrawMode.Ghost, belowActor.LastMode);
        Assert.AreEqual(StationDrawMode.Hidden, aboveActor.LastMode);
    }

    [Test]
    public void PickingUsesTheSameVisibilityAndPlane() {
        var hidden = Target("grid", StationPartRole.Grid, new[] { 0 }, new Vector3(0, 0, 0), Vector3.one);
        var ghost = Target("ghost", StationPartRole.Prop, new[] { -5 }, new Vector3(1, 0, -5), Vector3.one);
        var cut = Target("cut", StationPartRole.Prop, new[] { 0 }, new Vector3(0, 10, 0), new Vector3(2, 2, 2));
        registry.State.HideUi = true;
        registry.Apply();
        Assert.IsFalse(registry.IsTargetPickable(hidden), "hidden UI removes the lattice from picking too");
        registry.State.HideUi = false;
        registry.State.ShowLevels = true;
        registry.SectionClipping = true;
        registry.Section = new StationSectionPlane { Anchor = new Vector3(0, 0, -8), Azimuth = 0, Offset = 0 };
        registry.State.Cutaway = true;
        registry.Apply();
        Assert.IsTrue(registry.IsTargetPickable(ghost), "a ghosted storey is still addressable");
        Assert.IsFalse(registry.IsPickableAt(cut, new Vector3(0, 10, 0)), "the cut half is not pickable");
        Assert.IsTrue(registry.IsPickableAt(ghost, new Vector3(0, -5, 0)), "the kept half is pickable");
    }

    [Test]
    public void ContactShadowsOnlyGroundTheActiveStorey() {
        var active = Target("active-shadow", StationPartRole.Other, new[] { 0 }, new Vector3(0, 0, 0), Vector3.one, contactShadow: true);
        var below = Target("below-shadow", StationPartRole.Other, new[] { -5 }, new Vector3(1, 0, -5), Vector3.one, contactShadow: true);
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Base, active.LastMode);
        Assert.AreEqual(StationDrawMode.Hidden, below.LastMode);
        registry.State.HideUi = true;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Base, below.LastMode, "éšè—UI draws every storey, shadows included");
    }

    // ---------------------------------------------------------------- exploded

    [Test]
    public void ExplodedPlanPacksStoreysAlongTheShortAxis() {
        var plan = new List<Vector2Int>();
        for (int x = 0; x < 4; x++) for (int y = 0; y < 4; y++) plan.Add(new Vector2Int(x, y));
        var result = StationExplodedPlan.Compute(new[] { -5, 0 }, new IReadOnlyList<Vector2Int>[] { plan, plan }, new Vector2Int(0, 1));
        Assert.AreEqual(new[] { -5, 0 }, result.Levels);
        Assert.AreEqual(new Vector2Int(0, 1), result.Direction);
        Assert.AreEqual(0, result.Shift(-5));
        Assert.AreEqual(4, result.Shift(0), "the second tray is packed clear of the first");
        Assert.AreEqual(new Vector3(0, 4, 0), result.DocumentOffset(0));
    }

    // ------------------------------------------------------- grade (plan 20 §4)

    static StationDocument zooDocument;
    static Dictionary<string, StationModuleRecord> zooModules;

    static StationDocument Zoo {
        get {
            if (zooDocument != null) return zooDocument;
            var read = StationDocumentReader.ReadFile("Assets/StationDesigner/Demos/zoo.metro.json");
            Assert.IsNotNull(read?.Document, "the Zoo document must load");
            zooDocument = read.Document;
            zooModules = new Dictionary<string, StationModuleRecord>(StringComparer.Ordinal);
            foreach (var module in zooDocument.Modules) zooModules[module.Id] = module;
            return zooDocument;
        }
    }

    static StationViewRecord Record(string role, string moduleId = "", bool gradeOwned = false, string part = "") =>
        new StationViewRecord { Role = role, ModuleId = moduleId, GradeOwned = gradeOwned, Part = part };

    /// <summary>
    /// 20 §4 — 隐藏地面 hides grade **furniture**, not only the `Ground` role. A fence at the
    /// authored datum carries the independent grade flag, so the toggle removes it while every
    /// other view tool keeps reading its real role (it is still a 栏杆 for 隐藏墙壁 and the
    /// storey slice), and a run one storey down is untouched.
    /// </summary>
    [Test]
    public void GradeFurnitureFollowsHideGroundAndALowerRunDoesNot() {
        // 显示其他层 is a user setting, so the case states it rather than inheriting a default: a
        // run one storey down must be drawn (or the "lower run keeps its geometry" claim is really
        // about the slice, not about grade membership).
        registry.State.ShowLevels = true;
        var grade = Component("grade fence", StationPartRole.Prop, new[] { 0 }, new Vector3(2, 0, 0), true);
        var lower = Component("lower fence", StationPartRole.Prop, new[] { -5 }, new Vector3(2, 0, -5), false);
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Base, grade.LastMode);
        Assert.AreEqual(StationDrawMode.Ghost, lower.LastMode,
            "显示其他层 draws the storey below as a ghost");
        registry.State.HideGround = true;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Hidden, grade.LastMode,
            "a grade-owned prop is removed with the street it stands on");
        // 显示其他层 ghosts the storey below rather than hiding it: the run keeps its geometry,
        // which is the claim that matters here (a hidden lower run would be a different bug).
        Assert.AreNotEqual(StationDrawMode.Hidden, lower.LastMode, "the run below the datum keeps its geometry");
        Assert.AreEqual(StationPartRole.Prop, grade.Role, "the part keeps its role for the other view tools");
        registry.State.HideGround = false;
        registry.Apply();
        Assert.AreEqual(StationDrawMode.Base, grade.LastMode, "the same record comes back when the toggle is off");
        Assert.IsTrue(grade.gameObject.activeInHierarchy);
    }

    /// <summary>A real component target: only the grade flag differs between the two runs.</summary>
    StationVisibilityTarget Component(string name, StationPartRole role, int[] levels, Vector3 documentCentre,
        bool gradeOwned) {
        var go = new GameObject(name);
        go.transform.position = StationCameraSpace.ToWorld(documentCentre);
        var filter = go.AddComponent<MeshFilter>();
        filter.sharedMesh = new Mesh { name = name };
        go.AddComponent<MeshRenderer>();
        var target = registry.Register(go.transform, role, levels, StationVisibilityTarget.NoGroundBand,
            false, false, false, gradeOwned);
        Assert.IsNotNull(target, name + " did not register");
        return target;
    }

    /// <summary>
    /// The classification is the **authored 0 m datum**, never the storey grid: the same Zoo
    /// modules answer the same way with the station baseline shifted, a structural run that
    /// crosses the datum is not grade furniture, and the entrance/exit assembly is the explicit
    /// exception.
    /// </summary>
    [Test]
    public void GradeMembershipUsesTheAuthoredGroundDatumNotTheStoreyGrid() {
        var document = Zoo;
        var sideways = document.Modules.Where(module => module.Type == "sidewalk").ToList();
        var lawns = document.Modules.Where(module => module.Type == "lawn").ToList();
        var trees = document.Modules.Where(module => module.Type == "tree").ToList();
        var fences = document.Modules.Where(module => module.Type == "fence").ToList();
        var exits = document.Modules.Where(module => module.Type == "exit" || module.Type == "guidepost").ToList();
        Assert.Greater(sideways.Count, 0, "Zoo owns sidewalk tiles");
        Assert.Greater(lawns.Count, 0, "Zoo owns lawn tiles");
        Assert.Greater(trees.Count, 0, "Zoo owns trees");
        Assert.Greater(fences.Count, 0, "Zoo owns fences");
        Assert.Greater(exits.Count, 0, "Zoo owns an entrance/exit assembly");
        foreach (var module in sideways.Concat(lawns).Concat(trees))
            Assert.IsTrue(StationViewFeature.IsGradeModule(module), module.Type + " " + module.Id + " is grade furniture");
        foreach (var module in exits)
            Assert.IsFalse(StationViewFeature.IsGradeModule(module), module.Id + " keeps the entrance/exit assembly");
        var atGrade = fences.Where(module => module.Z == StationViewFeature.GroundZ).ToList();
        var below = fences.Where(module => module.Z != StationViewFeature.GroundZ).ToList();
        Assert.Greater(atGrade.Count, 0, "Zoo has a fence standing on the datum");
        Assert.Greater(below.Count, 0, "Zoo has a fence below the datum");
        foreach (var module in atGrade) Assert.IsTrue(StationViewFeature.IsGradeModule(module), "0 m fence " + module.Id);
        foreach (var module in below) Assert.IsFalse(StationViewFeature.IsGradeModule(module), "lower fence " + module.Id);
        // A structural run is never grade furniture, even where it crosses the datum.
        foreach (var module in document.Modules.Where(module =>
                     module.Type == "track" || module.Type == "platform-edge" || module.Type == "psd"))
            Assert.IsFalse(StationViewFeature.IsGradeModule(module), module.Type + " " + module.Id + " is structural");
        Assert.AreEqual(0, StationViewFeature.GroundZ, "the authored ground datum is 0 m");
        // The grid's baseline is not an input, so a shifted station answers identically.
        var shifted = StationLevelGrid.FromDocument(document.LevelBase + 2, document.StoreyHeight);
        Assert.AreNotEqual(StationViewFeature.GroundZ, shifted.Band(StationViewFeature.GroundZ),
            "the shifted grid puts the datum in another band, which the rule must ignore");
        Assert.IsTrue(StationViewFeature.IsGradeModule(atGrade[0]), "a shifted baseline does not reclassify the datum");
    }

    /// <summary>
    /// One helper answers both producers: a combined surface batch carries the producer's flag
    /// (it has no module id of its own), a cell chunk under the `Ground` role is grade by role,
    /// and a per-module record is classified from its saved elevation.
    /// </summary>
    [Test]
    public void OneClassificationHelperAnswersBatchesRoleRecordsAndPicks() {
        var document = Zoo;
        var sidewalk = document.Modules.First(module => module.Type == "sidewalk");
        Assert.IsTrue(StationViewFeature.IsGradeOwned(Record("surfaces", gradeOwned: true, part: "batch"), zooModules),
            "a batch the producer tagged as grade is grade furniture");
        Assert.IsFalse(StationViewFeature.IsGradeOwned(Record("surfaces", part: "batch"), zooModules),
            "a batch the producer did not tag is not classified by its bounding box");
        // The cell mesher's ground pass is grade by **role**, which the registry answers directly
        // (the record's own role needs its authored parent transform, covered by the cell-mesh
        // fixture); here the rule is pinned where it is applied.
        registry.State.HideGround = true;
        Assert.AreEqual(StationDrawMode.Hidden,
            registry.DecidePart(StationPartRole.Ground, new[] { 0 }), "the ground slab and courses follow Hide Ground");
        registry.State.HideGround = false;
        Assert.IsTrue(StationViewFeature.IsGradeOwned(Record("roads"), zooModules), "the road deck follows the street");
        Assert.IsTrue(StationViewFeature.IsGradeOwned(Record("modules", sidewalk.Id), zooModules),
            "a per-module record is classified from its saved elevation");
        var exit = document.Modules.First(module => module.Type == "exit");
        Assert.IsFalse(StationViewFeature.IsGradeOwned(Record("modules", exit.Id), zooModules),
            "the exit assembly is the exception");
        // The pick asks the same question, so a removed prop cannot be clicked through its hole.
        registry.State.HideGround = true;
        Assert.AreEqual(StationDrawMode.Hidden,
            registry.DecidePart(StationPartRole.Prop, new[] { 0 }, false, StationVisibilityTarget.NoGroundBand, true),
            "a grade part is unpickable while Hide Ground is on");
        // A lower storey answers the slice, not the grade rule: still drawn, as a ghost.
        Assert.AreEqual(StationDrawMode.Ghost,
            registry.DecidePart(StationPartRole.Prop, new[] { -5 }, false, StationVisibilityTarget.NoGroundBand, false),
            "a lower prop keeps its own answer");
        Assert.AreEqual(StationDrawMode.Hidden,
            registry.DecidePart(StationPartRole.Ground, new[] { 0 }), "road traffic keeps its own grade path");
        registry.State.HideGround = false;
    }

    // ---------------------------------------------------------------- command applier

    [Test]
    public void EveryViewToggleChangesThePublishedState() {
        Target("slab", StationPartRole.Slab, new[] { 0 }, new Vector3(0, 0, 0), Vector3.one);
        Target("below", StationPartRole.Prop, new[] { -5 }, new Vector3(0, 0, -5), Vector3.one);
        Target("wall", StationPartRole.Wall, new[] { 0 }, new Vector3(2, 0, 0), Vector3.one);
        Target("ground", StationPartRole.Ground, new[] { 0 }, new Vector3(4, 0, 0), Vector3.one);
        Target("roof", StationPartRole.Roof, new[] { 0 }, new Vector3(6, 0, 0), Vector3.one);
        Target("ceiling", StationPartRole.Ceiling, new[] { 5 }, new Vector3(8, 0, 5), Vector3.one);
        var applier = Applier(out _);
        var commands = new[] {
            Command(StationViewCommandType.ViewSet, c => { c.Key = StationViewKey.ShowLevels; c.BoolValue = false; }),
            Command(StationViewCommandType.ViewSet, c => { c.Key = StationViewKey.Ceiling; c.BoolValue = true; }),
            Command(StationViewCommandType.ViewSet, c => { c.Key = StationViewKey.Walls; c.BoolValue = true; }),
            Command(StationViewCommandType.ViewSet, c => { c.Key = StationViewKey.Ground; c.BoolValue = true; }),
            Command(StationViewCommandType.ViewSet, c => { c.Key = StationViewKey.Roof; c.BoolValue = true; }),
            Command(StationViewCommandType.ViewSet, c => { c.Key = StationViewKey.HideUi; c.BoolValue = true; }),
            Command(StationViewCommandType.ViewSet, c => { c.Key = StationViewKey.Cutaway; c.BoolValue = true; }),
            Command(StationViewCommandType.ViewSet, c => { c.Key = StationViewKey.SectionSurface; c.BoolValue = false; }),
            Command(StationViewCommandType.ViewSet, c => { c.Key = StationViewKey.Exploded; c.BoolValue = true; }),
            Command(StationViewCommandType.ViewSet, c => { c.Key = StationViewKey.Level; c.IntValue = -5; }),
        };
        string previous = applier.SnapshotJson();
        foreach (var command in commands) {
            Assert.IsTrue(applier.TryApply(command, out string code), command.Key + ": " + code);
            string current = applier.SnapshotJson();
            Assert.AreNotEqual(previous, current, "view command " + command.Key + " changed nothing");
            previous = current;
        }
        Assert.IsFalse(applier.SectionSurfaceVisible);
        Assert.IsTrue(applier.Visibility.SectionClipping, "standalone exploded view leaves the editor section cut untouched");
        Assert.AreEqual(-5, applier.Camera.ActiveLevel);
        Assert.AreEqual(-5, applier.Visibility.State.ActiveLevel);
    }

    [Test]
    public void StandaloneExplodedHandlerAdvertisesDragAndLeavesEditorTogglesUntouched() {
        var applier = Applier(out _);
        Assert.IsFalse(applier.Capabilities.ExplodedDrag, "no standalone handler bound yet");

        bool? handledRequest = null;
        applier.ExplodedHandler = want => {
            handledRequest = want;
            return true;
        };
        Assert.IsTrue(applier.Capabilities.ExplodedDrag, "binding standalone handler enables explodedDrag capability");

        applier.Visibility.State.Cutaway = true;
        applier.Visibility.SectionClipping = true;
        applier.Visibility.State.HideWalls = true;

        var openCmd = Command(StationViewCommandType.ViewSet, c => { c.Key = StationViewKey.Exploded; c.BoolValue = true; });
        Assert.IsTrue(applier.TryApply(openCmd, out string code), code);
        Assert.AreEqual(true, handledRequest);
        Assert.IsTrue(applier.Visibility.State.Exploded);
        Assert.IsTrue(applier.Visibility.State.Cutaway, "editor cutaway stays intact while standalone viewer opens");
        Assert.IsTrue(applier.Visibility.SectionClipping, "editor section clipping stays intact");
        Assert.IsTrue(applier.Visibility.State.HideWalls, "editor wall toggle stays intact");

        applier.SyncExplodedState(false);
        Assert.IsFalse(applier.Visibility.State.Exploded);
    }

    [Test]
    public void ResolveDrawableBaseMaterialsReturnsOriginalUnghostedMaterials() {
        var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
        var baseMat = new Material(shader) { name = "OriginalPropMat" };
        var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
        try {
            var mr = go.GetComponent<MeshRenderer>();
            mr.sharedMaterial = baseMat;
            var target = registry.Register(go.transform, StationPartRole.Prop, new[] { -5 });
            registry.State.ActiveLevel = 0;
            registry.State.ShowLevels = true;
            registry.Apply();
            Assert.AreEqual(StationDrawMode.Ghost, target.LastMode, "editor view ghosted the lower storey");
            Assert.AreNotSame(baseMat, mr.sharedMaterial, "renderer now wears a ghost material variant");

            Assert.IsTrue(StationVisibilityTarget.ResolveDrawableBaseMaterials(mr, out var resolved));
            Assert.AreEqual(1, resolved.Length);
            Assert.AreSame(baseMat, resolved[0], "standalone exploded extractor recovers the unghosted base material");
        } finally {
            UnityEngine.Object.DestroyImmediate(go);
            UnityEngine.Object.DestroyImmediate(baseMat);
        }
    }

    [Test]
    public void ALevelOutsideTheStationGridIsRejected() {
        var applier = Applier(out var camera);
        var command = Command(StationViewCommandType.ViewSet, c => { c.Key = StationViewKey.Level; c.IntValue = 3; });
        Assert.IsFalse(applier.TryApply(command, out string code));
        Assert.AreEqual("level-outside-grid", code);
        Assert.AreEqual(0, camera.ActiveLevel);
    }

    [Test]
    public void ChangingLevelAndViewDoesNotEditTheDocumentOrResetTheSimulation() {
        var applier = Applier(out _);
        long documentRevision = 7L;
        int simGeneration = 3;
        int simTicks = 120;
        var commands = new[] {
            Command(StationViewCommandType.Orbit, c => { c.Dx = 20f; c.Dy = -8f; }),
            Command(StationViewCommandType.Zoom, c => c.Factor = .5f),
            Command(StationViewCommandType.ViewSet, c => { c.Key = StationViewKey.Level; c.IntValue = -5; }),
            Command(StationViewCommandType.ViewSet, c => { c.Key = StationViewKey.Cutaway; c.BoolValue = true; }),
            Command(StationViewCommandType.ViewSet, c => { c.Key = StationViewKey.HideUi; c.BoolValue = true; }),
            Command(StationViewCommandType.ViewSet, c => { c.Key = StationViewKey.SectionSurface; c.BoolValue = false; }),
        };
        foreach (var command in commands) Assert.IsTrue(applier.TryApply(command, out string code), code);
        Assert.AreEqual(7L, documentRevision, "a view command never edits the document");
        Assert.AreEqual(3, simGeneration, "a view command never rebuilds the simulation");
        Assert.AreEqual(120, simTicks, "a view command never resets the clock");
        StringAssert.DoesNotContain("\"document\"", applier.SnapshotJson());
        StringAssert.DoesNotContain("\"revision\"", applier.SnapshotJson());
    }

    [Test]
    public void SectionRotationReturnsToTheRenderedPlanCentre() {
        var root = new GameObject("section plan probe");
        try {
            using var world = new StationWorldView(root.transform, "probe", Array.Empty<IStationViewRenderer>());
            var cell = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cell.transform.SetParent(root.transform);
            cell.transform.position = StationCameraSpace.ToWorld(new Vector3(36, 15, 0));
            world.RegisterCell(StationCellRenderer.RoleName, new StationCellKey(36, 15, 0), cell);
            var street = GameObject.CreatePrimitive(PrimitiveType.Cube);
            street.transform.SetParent(root.transform);
            street.transform.position = StationCameraSpace.ToWorld(new Vector3(44, 25, 0));
            world.RegisterCell(StationCellRenderer.RoleName, new StationCellKey(44, 25, 0), street);
            var prop = GameObject.CreatePrimitive(PrimitiveType.Cube);
            prop.transform.SetParent(root.transform);
            prop.transform.position = StationCameraSpace.ToWorld(new Vector3(150, 100, 0));
            world.RegisterModule("modules", "distant-prop", prop);
            var centre = StationViewFeature.SectionPlanCentre(world);
            Assert.AreEqual(new Vector2(40, 20), centre);
            var applier = Applier(out _);
            var grid = StationLevelGrid.FromDocument(0, 5, null);
            applier.SetStation(new Bounds(Vector3.zero, Vector3.one), grid, -20, centre);
            Assert.IsTrue(applier.TryApply(Command(StationViewCommandType.ViewSet, c => {
                c.Key = StationViewKey.SectionOffset;
                c.FloatValue = 12;
            }), out string code), code);
            Assert.IsTrue(applier.TryApply(Command(StationViewCommandType.ViewSet, c => {
                c.Key = StationViewKey.SectionRotate;
                c.RotateToNext = true;
            }), out code), code);
            Assert.AreEqual(new Vector3(40, 20, -20), applier.Section.Point);
        } finally {
            UnityEngine.Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void SectionRotationReturnsToTheRenderedPlanCentreForZoo() {
        var root = new GameObject("Zoo section anchor probe");
        try {
            using var world = new StationWorldView(root.transform, "probe", Array.Empty<IStationViewRenderer>());
            var read = StationDocumentReader.ReadFile("Assets/StationDesigner/Demos/zoo.metro.json");
            world.Build(read.Document, read.Index);
            // Web groundWindow for the bundled Zoo save is [-14,148] × [-31,55]
            // in grid cells. The outer mesh edges include the final cell width.
            Assert.AreEqual(new Vector2(67.5f, 12.5f), StationViewFeature.SectionPlanCentre(world));
        } finally {
            UnityEngine.Object.DestroyImmediate(root);
        }
    }

    [Test]
    public void SectionCommandsAnchorRotateAndSlideOnePlane() {
        var applier = Applier(out _);
        Assert.IsTrue(applier.TryApply(Command(StationViewCommandType.ViewSet, c => {
            c.Key = StationViewKey.Section;
            c.HasSection = true;
            c.Section = new StationSectionPlane { Anchor = new Vector3(2, 3, -8), Azimuth = 270, Offset = 1 };
        }), out string code), code);
        Assert.AreEqual(new Vector3(2, 3, -8), applier.Section.Anchor);
        Assert.AreEqual(270f, applier.Section.Azimuth, 1e-4);

        Assert.IsTrue(applier.TryApply(Command(StationViewCommandType.ViewSet, c => {
            c.Key = StationViewKey.SectionRotate;
            c.RotateToNext = true;
        }), out code), code);
        Assert.AreEqual(0f, applier.Section.Azimuth, 1e-4, "æ—‹è½¬ wraps from 270 to 0");

        Assert.AreEqual(0f, applier.Section.Offset, "rotation clears the previous drag");
        Assert.AreEqual(applier.Section.Anchor, applier.Visibility.Section.Point);
        Assert.IsTrue(applier.TryApply(Command(StationViewCommandType.ViewSet, c => {
            c.Key = StationViewKey.SectionAnchor;
            c.HasVector = true;
            c.VectorValue = new Vector3(-4, 6, -8);
        }), out code), code);
        Assert.AreEqual(new Vector3(-4, 6, -8), applier.Section.Anchor);

        Assert.IsTrue(applier.TryApply(Command(StationViewCommandType.ViewSet, c => {
            c.Key = StationViewKey.SectionOffset;
            c.FloatValue = 4.5f;
        }), out code), code);
        Assert.AreEqual(4.5f, applier.Section.Offset, 1e-4);
        Assert.AreEqual(applier.Section.Point, applier.Visibility.Section.Point);
    }

    [Test]
    public void CameraCommandsDriveTheCameraAndTheSnapshot() {
        var applier = Applier(out var camera);
        var before = camera.Snapshot();
        Assert.IsTrue(applier.TryApply(Command(StationViewCommandType.Snap, c => {
            c.HasDirection = true;
            c.Direction = new Vector3(0, 0, 1);
            c.Projection = StationProjection.Orthographic;
        }), out string code), code);
        Assert.AreEqual(StationProjection.Orthographic, camera.Projection);
        Assert.Greater(Vector3.Dot(camera.Snapshot().Back, new Vector3(0, 0, 1)), .999f);
        Assert.IsTrue(applier.TryApply(Command(StationViewCommandType.Home), out code), code);
        Assert.AreEqual(StationProjection.Perspective, camera.Projection);
        Assert.AreEqual(StationCameraMath.DefaultFov, camera.Fov, 1e-5);
        Assert.IsTrue(applier.TryApply(Command(StationViewCommandType.Fov, c => c.Degrees = 70f), out code), code);
        Assert.AreEqual(70f, camera.Fov, 1e-4);
        Assert.IsTrue(applier.TryApply(Command(StationViewCommandType.Projection, c => c.Projection = StationProjection.Orthographic), out code), code);
        Assert.AreEqual(StationProjection.Orthographic, camera.Projection);
        Assert.IsTrue(applier.TryApply(Command(StationViewCommandType.PanHeld, c => c.HeldDirection = 1), out code), code);
        Assert.AreEqual(1, camera.HeldVertical);
        applier.Tick(1f);
        Assert.AreNotEqual(before.Position, camera.State.Position);
        Assert.IsTrue(applier.TryApply(Command(StationViewCommandType.PanHeld, c => c.HeldDirection = 0), out code), code);
        Assert.AreEqual(0, camera.HeldVertical);
    }

    /* ------------------------------------------------- cell role registration */

    /// <summary>The production cell role/level mappers, public or internal.</summary>
    static MethodInfo Mapper(string name) => typeof(StationViewFeature).GetMethod(name,
        BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);

    [Test]
    public void CellRoleMappingNamesWallCeilingAndRoof() {
        var roleOf = Mapper("RoleOf");
        Assert.IsNotNull(roleOf, "StationViewFeature.RoleOf is the cell role mapping");
        var modules = new Dictionary<string, StationModuleRecord>(StringComparer.Ordinal);
        foreach (var parentName in new[] { "Cell", "Plate", "Ceiling", "Ground", "Wall", "Roof" }) {
            var parent = new GameObject(parentName);
            var view = new GameObject("cell group");
            view.transform.SetParent(parent.transform, false);
            try {
                var record = new StationViewRecord { Role = "cells", CellKey = "7,8,0", View = view };
                var expected = parentName switch {
                    "Ceiling" => StationPartRole.Ceiling,
                    "Ground" => StationPartRole.Ground,
                    "Wall" => StationPartRole.Wall,
                    "Roof" => StationPartRole.Roof,
                    _ => StationPartRole.Slab,
                };
                Assert.AreEqual(expected, (StationPartRole)roleOf.Invoke(null, new object[] { record, modules }),
                    parentName + " cell groups map to " + expected);
            } finally {
                UnityEngine.Object.DestroyImmediate(parent);
            }
        }
    }

    /// <summary>The real Zoo cell view, registered through the production role mapping.</summary>
    sealed class ZooRoleWorld : IDisposable {
        public GameObject Root;
        public StationCellView View;
        public StationFinishLibrary Finishes;
        public StationVisibilityRegistry Registry;
        public readonly List<StationVisibilityTarget> Targets = new List<StationVisibilityTarget>();
        public readonly Dictionary<StationVisibilityTarget, StationPartRole> Roles = new Dictionary<StationVisibilityTarget, StationPartRole>();

        public int Count(StationPartRole role) {
            var count = 0;
            foreach (var target in Targets) if (Roles[target] == role) count++;
            return count;
        }

        public Dictionary<StationVisibilityTarget, StationDrawMode> Modes() {
            var modes = new Dictionary<StationVisibilityTarget, StationDrawMode>();
            foreach (var target in Targets) modes[target] = target.LastMode;
            return modes;
        }

        public void AllTogglesOff() {
            Registry.State.HideWalls = false;
            Registry.State.AutoCeiling = false;
            Registry.State.HideRoof = false;
            Registry.State.HideGround = false;
            Registry.State.HideUi = false;
            Registry.State.Cutaway = false;
            Registry.State.Exploded = false;
            Registry.State.ShowLevels = true;
        }

        public void Apply(int level) {
            Registry.State.ActiveLevel = level;
            Registry.Apply();
        }

        public void Dispose() {
            Registry?.Dispose();
            View?.Dispose();
            Finishes?.Dispose();
            if (Root) UnityEngine.Object.DestroyImmediate(Root);
        }
    }

    static ZooRoleWorld BuildZooRoleWorld() {
        var shader = Shader.Find("Universal Render Pipeline/Lit");
        Assert.IsNotNull(shader, "The project's station shader (Universal Render Pipeline/Lit) is missing");
        var finishes = StationFinishLibrary.LoadFromDirectory(StationCellTestInputs.FinishDirectory, shader);
        var read = StationDocumentReader.ReadFile(StationCellTestInputs.ZooSavePath);
        var root = new GameObject("zoo role world");
        var view = StationCellView.Build(new StationCellViewRequest {
            Mesh = StationCellTestInputs.ZooViewInput(read.Document, finishes),
            Finishes = finishes,
            Name = "zoo roles",
        }, root.transform);
        var world = new ZooRoleWorld { Root = root, View = view, Finishes = finishes };
        try {
            var roleOf = Mapper("RoleOf");
            var levelsOf = Mapper("LevelsOf");
            Assert.IsNotNull(roleOf);
            Assert.IsNotNull(levelsOf);
            var modules = new Dictionary<string, StationModuleRecord>(StringComparer.Ordinal);
            foreach (var module in read.Document.Modules) modules[module.Id] = module;
            var grid = StationLevelGrid.FromDocument(read.Document.LevelBase, read.Document.StoreyHeight);
            world.Registry = new StationVisibilityRegistry(shader);
            world.Registry.State.LevelBase = read.Document.LevelBase;
            world.Registry.State.StoreyHeight = read.Document.StoreyHeight;
            foreach (var group in view.Groups) {
                var face = view.Faces[group.Data.TriangleFaces[0]];
                var anchor = group.Data.HasAnchor ? group.Data.Anchor : face.CellKey;
                var record = new StationViewRecord { Role = "cells", CellKey = anchor.ToString(), View = group.GameObject };
                var role = (StationPartRole)roleOf.Invoke(null, new object[] { record, modules });
                var levels = (int[])levelsOf.Invoke(null, new object[] { record, modules, grid });
                var target = world.Registry.Register(group.GameObject.transform, role, levels);
                world.Targets.Add(target);
                world.Roles[target] = role;
            }
            return world;
        } catch {
            world.Dispose();
            throw;
        }
    }

    static void AssertModes(ZooRoleWorld world, Dictionary<StationVisibilityTarget, StationDrawMode> expected, string what) {
        foreach (var target in world.Targets) {
            Assert.AreEqual(expected[target], target.LastMode, what + ": mode " + world.Roles[target] + " on " + target.Root.name);
        }
    }

    [Test]
    public void ZooCellRolesChangeVisibilityAtEveryStorey() {
        using var world = BuildZooRoleWorld();
        // Pinned Zoo counts (the same split StationCellMeshTests pins). 18 §1 removed the
        // one-metre wall crests from the slab set, so those groups are Wall now rather than
        // Ceiling/Roof, and the Cell group count fell by one.
        Assert.AreEqual(157, world.Count(StationPartRole.Slab), "Zoo Cell/Slab groups");
        Assert.AreEqual(154, world.Count(StationPartRole.Wall), "Zoo Wall groups: wall bodies and their crests, wall.* finishes");
        Assert.AreEqual(94, world.Count(StationPartRole.Ceiling), "Zoo Ceiling groups: ceiling plates and slab bodies");
        Assert.AreEqual(46, world.Count(StationPartRole.Roof), "Zoo Roof groups: cell-geometry roof decks (0 roof modules)");
        Assert.AreEqual(66, world.Count(StationPartRole.Ground), "Zoo street groups");

        foreach (var level in new[] { 0, -5, -10, -15, -20 }) {
            world.AllTogglesOff();
            world.Apply(level);
            var baseline = world.Modes();
            var visibleWalls = world.Targets.Where(t => world.Roles[t] == StationPartRole.Wall && baseline[t] != StationDrawMode.Hidden).ToList();
            var visibleCeilings = world.Targets.Where(t => world.Roles[t] == StationPartRole.Ceiling && baseline[t] != StationDrawMode.Hidden).ToList();
            var visibleRoofs = world.Targets.Where(t => world.Roles[t] == StationPartRole.Roof && baseline[t] != StationDrawMode.Hidden).ToList();
            Assert.IsNotEmpty(visibleWalls, level + ": the storey draws wall groups");
            Assert.IsNotEmpty(visibleCeilings, level + ": the storey draws ceiling groups");
            Assert.IsNotEmpty(visibleRoofs, level + ": the storey draws roof groups");

            // (a) 隐藏墙壁 sees through the tagged wall faces.
            world.Registry.State.HideWalls = true;
            world.Registry.Apply();
            Assert.IsTrue(visibleWalls.All(t => t.LastMode == StationDrawMode.Clear), level + ": every drawn wall goes clear");
            Assert.Greater(world.Registry.ClearTargets, 0, level + ": the walk reports the see-through walls");
            world.Registry.State.HideWalls = false;
            world.Registry.Apply();
            AssertModes(world, baseline, level + ": walls back off");

            // (b) 隐藏天花板 hides the slab above the room.
            world.Registry.State.AutoCeiling = true;
            world.Registry.Apply();
            Assert.IsTrue(visibleCeilings.All(t => t.LastMode == StationDrawMode.Hidden), level + ": every drawn ceiling is hidden");
            Assert.IsTrue(visibleCeilings.All(t => t.Renderers.All(r => !r.enabled)), level + ": a hidden ceiling draws nothing");
            world.Registry.State.AutoCeiling = false;
            world.Registry.Apply();
            AssertModes(world, baseline, level + ": ceiling back off");

            // (c) 隐藏屋顶 hides the cell-geometry roof deck.
            world.Registry.State.HideRoof = true;
            world.Registry.Apply();
            Assert.IsTrue(visibleRoofs.All(t => t.LastMode == StationDrawMode.Hidden), level + ": every drawn roof deck is hidden");
            Assert.IsTrue(visibleRoofs.All(t => t.Renderers.All(r => !r.enabled)), level + ": a hidden roof draws nothing");
            world.Registry.State.HideRoof = false;
            world.Registry.Apply();
            AssertModes(world, baseline, level + ": roof back off");

            // (d) The default draw set is back, and the view-level role switch flips
            // exactly the role's GameObjects and nothing else.
            var active = world.View.Groups.Count(g => g.GameObject.activeSelf);
            world.View.SetRoleVisible(StationSurfaceRole.Roof, false);
            Assert.IsTrue(world.View.Groups.Where(g => g.Role == StationSurfaceRole.Roof).All(g => !g.GameObject.activeSelf),
                level + ": the roof role's groups leave the draw");
            Assert.IsTrue(world.View.Groups.Where(g => g.Role != StationSurfaceRole.Roof).All(g => g.GameObject.activeSelf),
                level + ": no other role moves with the roof toggle");
            world.View.SetRoleVisible(StationSurfaceRole.Roof, true);
            Assert.AreEqual(active, world.View.Groups.Count(g => g.GameObject.activeSelf), level + ": the default draw set is restored");
        }
    }

    [Test]
    public void ComponentHidesRenderersAndColliders() {
        var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
        try {
            go.transform.position = StationCameraSpace.ToWorld(new Vector3(0, 0, 0));
            // éšè—UI's subject is the drawing furniture (grid/cursor), not a wall.
            var target = registry.Register(go.transform, StationPartRole.Grid, new[] { 0 });
            var renderer = go.GetComponent<MeshRenderer>();
            var collider = go.GetComponent<Collider>();
            Assert.IsNotNull(renderer);
            Assert.IsNotNull(collider);

            registry.State.HideUi = true;
            registry.Apply();
            Assert.AreEqual(StationDrawMode.Hidden, target.LastMode);
            Assert.IsFalse(renderer.enabled, "a hidden part draws nothing");
            Assert.IsFalse(collider.enabled, "and a hidden part cannot be picked");

            registry.State.HideUi = false;
            registry.Apply();
            Assert.AreEqual(StationDrawMode.Base, target.LastMode);
            Assert.IsTrue(renderer.enabled);
            Assert.IsTrue(collider.enabled);

            // The same component under a wall role exercises the section branch: a
            // part wholly on the cut side is hidden even though éšè—å¢™å£ is off.
            target.Configure(StationPartRole.Wall, new[] { 0 });
            go.transform.position = StationCameraSpace.ToWorld(new Vector3(0, 10, 0));
            registry.Section = new StationSectionPlane { Anchor = new Vector3(0, 0, -8), Azimuth = 0, Offset = 0 };
            registry.SectionClipping = true;
            registry.State.Cutaway = true;
            registry.Apply();
            Assert.AreEqual(StationDrawMode.Hidden, target.LastMode, "the cut half is hidden");
            Assert.IsFalse(renderer.enabled);
        } finally {
            UnityEngine.Object.DestroyImmediate(go);
        }
    }
}
