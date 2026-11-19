using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Metro.App.Views;
using Metro.View;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Packet H oracle tests. Every expected appearance, gait, arm-mode and
/// walk-distance value comes from the real TypeScript modules via
/// <c>tools/unity-parity/record-passenger-appearance.mjs</c>; the catalogue is the
/// asset built from the exact 440-row library manifest by
/// <c>Metro.Editor.PassengerCatalogueBuilder</c>.
///
/// The view tests instantiate the real promoted prefab and assert the recipe,
/// clip, sample time and feet transform the renderer chose — not a counter.
/// </summary>
public class PassengerCatalogueTests {
    const string OraclePath = "StationDesigner/Tests/EditMode/passenger-appearance-oracle.json";

    // ------------------------------------------------------------------ oracle

    [Serializable] public sealed class SpecimenDto { public string recipe; public int id; }
    [Serializable] public sealed class AppearanceDto {
        public int id, outfit, walkProfile;
        public string recipe;
        public bool child;
        public double height, depth, width, tone, walkSpeed, stride, cycleSeconds;
    }
    [Serializable] public sealed class GaitRowDto {
        public int profile, frameA, frameB;
        public double distance, phase, weight, blend, frameWeight, frame, sampleTime;
    }
    [Serializable] public sealed class GaitDto { public int id; public double depth; public GaitRowDto[] rows; }
    [Serializable] public sealed class ActivityDto {
        public int id, kind, outfit, mode, preferredRightMode, preferredLeftMode, displayed, channel;
        public double time;
    }
    [Serializable] public sealed class WalkDistanceDto { public int state; public double dx, dy, dz, distance; }
    [Serializable] public sealed class ChildSampleDto {
        public int id;
        public bool child;
        public double proportionsHeight, proportionsDepth, proportionsWidth, proportionsTone;
        public double height, depth, width, tone;
    }
    [Serializable] public sealed class OracleDto {
        public int schemaVersion, manifestCount, walkFrames;
        public string generatedBy, sourceSha, manifestPath, manifestSha256, recipeSha256, sourceSha256, rights;
        public double visualScale, childChance;
        public string[] activityNames;
        public double[] activityDurations;
        public int[] adultPool, childPool;
        public SpecimenDto[] specimenIds;
        public AppearanceDto[] appearance;
        public GaitDto gait;
        public ActivityDto[] activities;
        public WalkDistanceDto[] walkDistance;
        public ChildSampleDto childSample;
    }

    // --------------------------------------------------------------- manifest

    [Serializable] public sealed class LowDto { public bool runtimeVariant; public int triangles; }
    [Serializable] public sealed class ManifestAssetDto {
        public int sequence, triangles;
        public string recipe, sex, outfit, accessory, modelPath, prefabPath, sha256, rights, role, detail;
        public LowDto low;
    }
    [Serializable] public sealed class ManifestParametersDto { public int models, boneCount, clipCount, walkFrames; public string[] clips, boneNames; }
    [Serializable] public sealed class ManifestSourceDto { public string path, sha256, recipeSha256; }
    [Serializable] public sealed class ManifestDto {
        public string family;
        public ManifestSourceDto source;
        public ManifestParametersDto parameters;
        public ManifestAssetDto[] assets;
    }

    PassengerCatalogue catalogue;
    OracleDto oracle;
    readonly List<GameObject> roots = new List<GameObject>();

    [SetUp]
    public void SetUp() {
        catalogue = LoadCatalogue();
        Assert.That(catalogue, Is.Not.Null,
            "Passenger catalogue is missing; run Metro/Passengers/Build Catalogue (it is built automatically on import)");
        oracle = JsonUtility.FromJson<OracleDto>(ReadAsset(OraclePath));
        Assert.That(oracle, Is.Not.Null, "Passenger appearance oracle is missing or unreadable: " + OraclePath);
    }

    /// <summary>
    /// Load the built catalogue, letting the editor builder create it when the test
    /// run started before the import callback completed. The builder lives in the
    /// editor assembly, so the test reaches it by reflection instead of adding an
    /// Assembly-CSharp-Editor reference.
    /// </summary>
    static PassengerCatalogue LoadCatalogue() {
        var asset = AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(PassengerCatalogue.AssetPath);
        if (asset != null) return asset;
        try {
            var builder = Type.GetType("Metro.Editor.PassengerCatalogueBuilder, Assembly-CSharp-Editor");
            var ensure = builder?.GetMethod("Ensure", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
            ensure?.Invoke(null, null);
        } catch (Exception error) {
            Debug.LogWarning("Passenger catalogue auto-build failed: " + error.GetBaseException().Message);
        }
        return AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(PassengerCatalogue.AssetPath);
    }

    [TearDown]
    public void TearDown() {
        for (int i = 0; i < roots.Count; i++) if (roots[i]) UnityEngine.Object.DestroyImmediate(roots[i]);
        roots.Clear();
        PassengerCatalogueAnchor.ClearInjection();
        PassengerPoseFeeds.Clear();
    }

    static string ReadAsset(string relativePath) {
        var path = Path.Combine(Application.dataPath, relativePath.Replace('/', Path.DirectorySeparatorChar));
        Assert.That(File.Exists(path), Is.True, "Missing test fixture " + path);
        return File.ReadAllText(path);
    }

    static string ReadProjectFile(string relativePath) =>
        File.ReadAllText(Path.Combine(Directory.GetParent(Application.dataPath).FullName, relativePath.Replace('/', Path.DirectorySeparatorChar)));

    static void Within(double expected, double actual, string what, double tolerance = 1e-9) {
        Assert.That(actual, Is.EqualTo(expected).Within(tolerance), what);
    }

    // ---------------------------------------------------------- the catalogue

    [Test]
    public void CatalogueMatchesTheExactManifest() {
        var manifest = JsonUtility.FromJson<ManifestDto>(ReadProjectFile(PassengerCatalogue.ManifestPath));
        Assert.That(manifest, Is.Not.Null);
        Assert.That(manifest.family, Is.EqualTo("passenger-library"));
        Assert.That(manifest.assets.Length, Is.EqualTo(440), "manifest asset count");
        Assert.That(oracle.manifestCount, Is.EqualTo(440), "oracle was recorded against a different manifest");
        Assert.That(catalogue.entries.Length, Is.EqualTo(manifest.assets.Length), "catalogue entries");
        Assert.That(catalogue.Count, Is.EqualTo(440));
        Assert.That(catalogue.AdultPoolCount, Is.EqualTo(440));
        Assert.That(catalogue.ChildPoolCount, Is.EqualTo(440));
        Assert.That(catalogue.PoolEquals(oracle.adultPool, false), Is.True, "adult pool order");
        Assert.That(catalogue.PoolEquals(oracle.childPool, true), Is.True, "child pool order");
        Assert.That(catalogue.rights, Is.EqualTo("INTERNAL_REVIEW_ONLY"));
        Assert.That(catalogue.recipeSha256, Is.EqualTo(oracle.recipeSha256));

        for (int i = 0; i < manifest.assets.Length; i++) {
            var row = manifest.assets[i];
            Assert.That(catalogue.TryGet(row.recipe, out var entry), Is.True, row.recipe + " must resolve");
            Assert.That(entry.index, Is.EqualTo(i), row.recipe + " index");
            Assert.That(entry.prefab, Is.Not.Null, row.recipe + " prefab reference");
            Assert.That(entry.prefab.name, Is.EqualTo(row.recipe), row.recipe + " prefab root name");
            Assert.That(entry.modelPath, Is.EqualTo(row.modelPath), row.recipe + " model path");
            Assert.That(entry.prefabPath, Is.EqualTo(row.prefabPath), row.recipe + " prefab path");
            Assert.That(entry.assetSha256, Is.EqualTo(row.sha256), row.recipe + " GLB hash");
            Assert.That(entry.modelPath.StartsWith(PassengerCatalogue.InternalRoot + "/", StringComparison.Ordinal), Is.True,
                row.recipe + " model is outside the internal passenger root");
            Assert.That(entry.prefabPath.StartsWith(PassengerCatalogue.InternalRoot + "/", StringComparison.Ordinal), Is.True,
                row.recipe + " prefab is outside the internal passenger root");
            Assert.That(entry.rights, Is.EqualTo("INTERNAL_REVIEW_ONLY"));
            Assert.That(entry.triangles, Is.EqualTo(row.triangles), row.recipe + " triangles");
            Assert.That(entry.lowTriangles, Is.EqualTo(row.low.triangles), row.recipe + " Low triangles");
            Assert.That(entry.lowDetail, Is.True, row.recipe + " declares a runtime Low variant");
            Assert.That(entry.adultEligible && entry.childEligible, Is.True, row.recipe + " age eligibility");
        }
        var report = catalogue.Verify();
        Assert.That(report.Ok, Is.True, report.ToString());
        Assert.That(report.Clips, Is.EqualTo(49));
        Assert.That(report.Bones, Is.EqualTo(16));
    }

    [Test]
    public void ClipSetAndBonesMatchTheManifest() {
        var manifest = JsonUtility.FromJson<ManifestDto>(ReadProjectFile(PassengerCatalogue.ManifestPath));
        Assert.That(catalogue.clipSet.clipNames, Is.EqualTo(manifest.parameters.clips), "clip name order");
        Assert.That(catalogue.clipSet.bones, Is.EqualTo(manifest.parameters.boneNames), "bone order");
        Assert.That(catalogue.clipSet.clips.Length, Is.EqualTo(49));
        for (int i = 0; i < catalogue.clipSet.clips.Length; i++) {
            var clip = catalogue.clipSet.clips[i];
            Assert.That(clip, Is.Not.Null, catalogue.clipSet.clipNames[i] + " clip binding");
            Assert.That(clip.length, Is.GreaterThan(0f), catalogue.clipSet.clipNames[i] + " length");
        }
        foreach (var name in new[] { "Idle", "WalkSlow", "Walk", "WalkFast", "Wait", "Queue", "Escalator", "Lift", "Sit" })
            Assert.That(catalogue.Clip(name), Is.Not.Null, "missing clip " + name);
        Assert.That(catalogue.clipSet.walkProfiles.Length, Is.EqualTo(3));
        Assert.That(catalogue.clipSet.walkProfiles[2].stride, Is.EqualTo(1.568).Within(1e-12));
    }

    [Test]
    public void NamedSpecimensResolveByRecipeAndIdentity() {
        foreach (var specimen in oracle.specimenIds) {
            Assert.That(catalogue.TryGet(specimen.recipe, out var entry), Is.True, specimen.recipe);
            Assert.That(entry.prefab.name, Is.EqualTo(specimen.recipe));
            Assert.That(catalogue.RecipeForSimId(specimen.id), Is.EqualTo(specimen.recipe),
                "sim id " + specimen.id + " must select " + specimen.recipe);
            Assert.That(PassengerAppearance.Look(catalogue, specimen.id).Recipe, Is.EqualTo(specimen.recipe));
        }
    }

    // ------------------------------------------------------------- appearance

    [Test]
    public void AppearanceMatchesTheTypeScriptOracle() {
        Assert.That(oracle.schemaVersion, Is.EqualTo(1));
        Assert.That(oracle.generatedBy, Does.EndWith("record-passenger-appearance.mjs"));
        Within(oracle.visualScale, PassengerAppearance.VisualScale, "visual scale");
        Within(oracle.childChance, PassengerAppearance.ChildChance, "child chance");
        Assert.That(oracle.walkFrames, Is.EqualTo(PassengerAppearance.WalkFrames));
        Assert.That(oracle.activityNames, Is.EqualTo(PassengerAppearance.ActivityNames));
        for (int i = 0; i < oracle.activityDurations.Length; i++)
            Within(oracle.activityDurations[i], PassengerAppearance.ActivityDurations[i], "duration " + i);

        Assert.That(oracle.appearance.Length, Is.GreaterThan(20));
        foreach (var row in oracle.appearance) {
            var look = PassengerAppearance.Look(catalogue, row.id);
            Assert.That(look.OutfitIndex, Is.EqualTo(row.outfit), "id " + row.id + " recipe index");
            Assert.That(look.Recipe, Is.EqualTo(row.recipe), "id " + row.id + " recipe");
            Assert.That(look.IsChild, Is.EqualTo(row.child), "id " + row.id + " age");
            Within(row.height, look.Height, "id " + row.id + " height");
            Within(row.depth, look.Depth, "id " + row.id + " depth");
            Within(row.width, look.Width, "id " + row.id + " width");
            Within(row.tone, look.Tone, "id " + row.id + " tone");
            Assert.That(look.WalkProfile, Is.EqualTo(row.walkProfile), "id " + row.id + " walk profile");
            Within(row.walkSpeed, look.WalkSpeed, "id " + row.id + " walk speed");
            Within(row.stride, look.WalkStride, "id " + row.id + " stride");
            Within(row.cycleSeconds, look.WalkCycleSeconds, "id " + row.id + " cycle");
            // Determinism: the same identity always selects the same look.
            var again = PassengerAppearance.Look(catalogue, row.id);
            Assert.That(again.Recipe, Is.EqualTo(look.Recipe));
            Assert.That(again.Height, Is.EqualTo(look.Height));
        }
    }

    [Test]
    public void ChildSizeMatchesTheOracle() {
        var sample = oracle.childSample;
        Assert.That(sample.child, Is.True);
        PassengerAppearance.Proportions(sample.id, out var height, out var depth, out var width, out var tone);
        Within(sample.proportionsHeight, height, "child raw height");
        Within(sample.proportionsDepth, depth, "child raw depth");
        Within(sample.proportionsWidth, width, "child raw width");
        Within(sample.proportionsTone, tone, "child tone");
        var look = PassengerAppearance.Look(catalogue, sample.id);
        Assert.That(look.IsChild, Is.True);
        Within(sample.height, look.Height, "child displayed height");
        Within(sample.depth, look.Depth, "child displayed depth");
        Within(sample.width, look.Width, "child displayed width");
        Within(sample.tone, look.Tone, "child displayed tone");
        Assert.That(look.Height, Is.LessThan(0.80), "child height must fit the child band");
    }

    [Test]
    public void GaitFramesAndSampleTimeMatchTheOracle() {
        var look = PassengerAppearance.Look(catalogue, oracle.gait.id);
        Within(oracle.gait.depth, look.Depth, "gait depth");
        Assert.That(oracle.gait.rows.Length, Is.EqualTo(180));
        foreach (var row in oracle.gait.rows) {
            var gait = PassengerAppearance.Gait(look, row.profile, row.distance, row.phase, row.weight);
            Assert.That(gait.FrameA, Is.EqualTo(row.frameA), "profile " + row.profile + " d " + row.distance + " p " + row.phase + " A");
            Assert.That(gait.FrameB, Is.EqualTo(row.frameB), "profile " + row.profile + " B");
            Within(row.blend, gait.Blend, "blend", 1e-12);
            Within(row.frameWeight, gait.Weight, "weight");
            Within(row.frame, gait.Frame, "frame", 1e-12);
            Within(row.sampleTime, gait.SampleTime, "sample time", 1e-12);
        }
    }

    [Test]
    public void ActivityArmsAndBeltSideMatchTheOracle() {
        Assert.That(oracle.activities.Length, Is.EqualTo(135));
        foreach (var row in oracle.activities) {
            catalogue.TryGetForSimId(row.id, out var entry);
            var kind = (PassengerActivity)row.kind;
            Assert.That(PassengerAppearance.ActionMode(row.id, entry, kind, 0), Is.EqualTo(row.mode),
                "id " + row.id + " kind " + row.kind + " time " + row.time + " mode");
            Assert.That(PassengerAppearance.ActionMode(row.id, entry, kind, 1), Is.EqualTo(row.preferredRightMode));
            Assert.That(PassengerAppearance.ActionMode(row.id, entry, kind, 2), Is.EqualTo(row.preferredLeftMode));
            Assert.That((int)PassengerAppearance.DisplayedActivity(kind, entry, row.time), Is.EqualTo(row.displayed),
                "id " + row.id + " kind " + row.kind + " time " + row.time + " displayed");
            Assert.That(PassengerAppearance.ActionChannel(row.id, entry, kind, PassengerAppearance.WalkProfile(row.id)),
                Is.EqualTo(row.channel));
        }
    }

    [Test]
    public void RailRideUsesExactlyOneReachHoldReleaseSequence() {
        for (int variant = 0; variant < 4; variant++) {
            double frame = 10.0 / 23;
            double start = variant * 6 * frame;
            Assert.That(PassengerAppearance.RailTimeline(0, 24, variant), Is.EqualTo(start).Within(1e-8));
            for (int seconds = 2; seconds <= 22; seconds++) {
                Assert.That(PassengerAppearance.RailTimeline(seconds, 24, variant),
                    Is.InRange(start + 2 * frame - 1e-8, start + 3 * frame + 1e-8));
            }
            Assert.That(PassengerAppearance.RailTimeline(24, 24, variant), Is.EqualTo(start + 5 * frame).Within(1e-8));
        }
    }

    [Test]
    public void WalkDistanceMatchesTheOracle() {
        Assert.That(oracle.walkDistance.Length, Is.EqualTo(10));
        foreach (var row in oracle.walkDistance) {
            var distance = PassengerAppearance.WalkDistance((PassengerMotionState)row.state, row.dx, row.dy, row.dz);
            Within(row.distance, distance, "state " + row.state, 1e-12);
        }
    }

    // ------------------------------------------------------------------ view

    PassengerCrowdView BuildView(PassengerCatalogue source, string name = "passenger-crowd") {
        var root = new GameObject(name);
        roots.Add(root);
        return PassengerCrowdView.Build(root.transform, source);
    }

    static PassengerPose PoseFor(int simId, double x = 3.25, double y = -7.5, double z = 0) => new PassengerPose {
        SimId = simId, X = x, Y = y, Z = z, Heading = 0, Activity = PassengerActivity.Walk,
        ActivitySeconds = 0, WalkDistance = 1.44, WalkPhase = 0.2, WalkWeight = 1,
        Detail = PassengerDetail.Full, PreferredHand = 0, Visible = true,
    };

    [Test]
    public void ViewInstantiatesTheRecipePrefabWithFeetPivotAndClip() {
        var specimen = oracle.specimenIds.First(row => row.recipe == "soft-male-commuter-none");
        var view = BuildView(catalogue);
        var pose = PoseFor(specimen.id);
        view.Render(new[] { pose }, 120);
        Assert.That(view.Spawned, Is.EqualTo(1), "one passenger spawned");
        Assert.That(view.TryGetActor(pose.SimId, out var actor), Is.True);
        Assert.That(actor.Recipe, Is.EqualTo("soft-male-commuter-none"), "recipe-selected prefab");
        Assert.That(actor.Root, Is.Not.Null);
        Assert.That(actor.Root.name, Does.Contain("soft-male-commuter-none"));
        Assert.That(actor.LegacyAnimation, Is.Not.Null, "the real imported legacy rig");
        Assert.That(actor.LegacyAnimation.enabled, Is.False, "manual sampling must own the pose");
        Assert.That(actor.Skin, Is.Not.Null);

        var look = PassengerAppearance.Look(catalogue, pose.SimId);
        var expectedScale = PassengerAppearance.LocalScale(look);
        Assert.That(actor.Scale.x, Is.EqualTo(expectedScale.x).Within(1e-6f), "lateral scale");
        Assert.That(actor.Scale.y, Is.EqualTo(expectedScale.y).Within(1e-6f), "height scale");
        Assert.That(actor.Scale.z, Is.EqualTo(expectedScale.z).Within(1e-6f), "fore/aft scale");
        var expectedPosition = StationCoordinates.Point(new Vector3((float)pose.X, (float)pose.Y, (float)pose.Z));
        Assert.That((actor.Position - expectedPosition).magnitude, Is.LessThan(1e-4f), "document point");
        var expectedYaw = PassengerAppearance.Rotation(pose.Heading);
        Assert.That(Quaternion.Angle(actor.Rotation, expectedYaw), Is.LessThan(0.01f), "heading");
        // The prefab's bind-pose feet sit on local y≈0: the scale pivot is the feet,
        // so the world feet plane is the document elevation the pose published.
        float feet = actor.Position.y + actor.Skin.sharedMesh.bounds.min.y * actor.Scale.y;
        Assert.That(feet, Is.EqualTo((float)pose.Z).Within(0.01f), "feet on the walking plane");

        var gait = PassengerAppearance.Gait(look, pose.WalkDistance, pose.WalkPhase, pose.WalkWeight);
        Assert.That(actor.ClipName, Is.EqualTo(PassengerAppearance.WalkClipName(look.WalkProfile)));
        Assert.That(actor.ClipTime, Is.EqualTo((float)gait.SampleTime).Within(1e-4f), "TS stride/phase sample time");
        Assert.That(actor.Sampled, Is.True);

        var ray = new Ray(actor.Skin.bounds.center + Vector3.back * 3, Vector3.forward);
        Assert.That(view.TryPick(ray, float.PositiveInfinity, out int selected), Is.True);
        Assert.That(selected, Is.EqualTo(pose.SimId));
        Assert.That(view.TryPick(ray, 1, out _), Is.False, "station geometry hides the actor behind it");

        // Pause: the same frame samples the same time, not a clock-advanced one.
        view.Render(new[] { pose }, 120);
        Assert.That(view.Spawned, Is.EqualTo(1), "reuse, not duplicate");
        Assert.That(actor.ClipTime, Is.EqualTo((float)gait.SampleTime).Within(1e-4f));
        // Advance only the published travel: the gait frame advances with distance.
        var moved = pose;
        moved.WalkDistance += 1.44;
        view.Render(new[] { moved }, 121);
        var advanced = PassengerAppearance.Gait(look, moved.WalkDistance, moved.WalkPhase, moved.WalkWeight);
        Assert.That(actor.ClipTime, Is.EqualTo((float)advanced.SampleTime).Within(1e-4f));
        Assert.That(advanced.SampleTime, Is.Not.EqualTo(gait.SampleTime).Within(1e-6));
        // The minimal pose contract (identity, position, activity, phase) has no
        // published idle/walk weight: a walk activity must still walk.
        var minimal = pose;
        minimal.WalkWeight = 0;
        view.Render(new[] { minimal }, 122);
        Assert.That(actor.ClipName, Is.EqualTo(PassengerAppearance.WalkClipName(look.WalkProfile)),
            "an unpublished weight must not freeze a walking passenger in Idle");
        Assert.That(actor.ClipTime, Is.EqualTo((float)gait.SampleTime).Within(1e-4f));
    }

    [Test]
    public void ChildIdentitySpawnsTheScaledChildOfTheSameRecipe() {
        var childId = oracle.childSample.id;
        var look = PassengerAppearance.Look(catalogue, childId);
        Assert.That(look.IsChild, Is.True);
        var view = BuildView(catalogue);
        var pose = PoseFor(childId);
        view.Render(new[] { pose });
        Assert.That(view.TryGetActor(childId, out var actor), Is.True);
        Assert.That(actor.Recipe, Is.EqualTo(look.Recipe));
        Assert.That(actor.Scale.y, Is.EqualTo((float)look.Height).Within(1e-6f));
        Assert.That(actor.Scale.y, Is.LessThan(0.8f), "child height");
        Assert.That(actor.Scale.x, Is.EqualTo((float)look.Width).Within(1e-6f));
        Assert.That(actor.Scale.z, Is.EqualTo((float)look.Depth).Within(1e-6f));
    }

    [Test]
    public void CarriedSideAndWaitActivitiesChooseTheirOwnClips() {
        var view = BuildView(catalogue);
        var bag = oracle.specimenIds.First(row => row.recipe == "soft-male-commuter-handbag-left");
        var escalator = PoseFor(bag.id);
        escalator.Activity = PassengerActivity.Escalator;
        escalator.ActivitySeconds = 2;
        view.Render(new[] { escalator });
        Assert.That(view.TryGetActor(bag.id, out var actor), Is.True);
        Assert.That(actor.ClipName, Is.EqualTo("Escalator_Right"),
            "a left-hand bag reserves that hand, so the right-hand gesture clip is selected");

        var wait = PoseFor(bag.id);
        wait.Activity = PassengerActivity.Wait;
        wait.ActivitySeconds = 6;
        view.Render(new[] { wait });
        Assert.That(actor.ClipName, Is.EqualTo("Wait"));
        Assert.That(actor.ClipTime, Is.EqualTo(6f).Within(1e-3f), "wait timeline is the published activity clock");
    }

    [Test]
    public void PausedFramesKeepTheActorAndHiddenFramesPoolIt() {
        var specimen = oracle.specimenIds[0];
        var view = BuildView(catalogue);
        var pose = PoseFor(specimen.id);
        view.Render(new[] { pose }, 30);
        Assert.That(view.VisibleActors, Is.EqualTo(1));
        // A paused frame publishes the same pose and must stay visible.
        view.Render(new[] { pose }, 30);
        Assert.That(view.VisibleActors, Is.EqualTo(1));
        var hidden = pose;
        hidden.Visible = false;
        view.Render(new[] { hidden }, 30);
        Assert.That(view.VisibleActors, Is.EqualTo(0));
        Assert.That(view.Spawned, Is.EqualTo(1), "hidden actors stay pooled for replay");
        // Re-appearing at an earlier replayed time still samples from the pose, not a wall clock.
        var replay = pose;
        replay.WalkDistance = 0;
        replay.WalkPhase = 0;
        view.Render(new[] { replay }, 10);
        Assert.That(view.VisibleActors, Is.EqualTo(1));
        var look = PassengerAppearance.Look(catalogue, specimen.id);
        var gait = PassengerAppearance.Gait(look, replay.WalkDistance, replay.WalkPhase, replay.WalkWeight);
        Assert.That(view.TryGetActor(specimen.id, out var actor), Is.True);
        Assert.That(actor.ClipTime, Is.EqualTo((float)gait.SampleTime).Within(1e-4f));
    }

    [Test]
    public void MissingRecipeFailsInsteadOfSelectingTheStandIn() {
        var empty = ScriptableObject.CreateInstance<PassengerCatalogue>();
        empty.clipSet = catalogue.clipSet;
        empty.entries = Array.Empty<PassengerCatalogueEntry>();
        empty.Invalidate();
        Assert.That(empty.Verify().Ok, Is.False);
        var view = BuildView(empty, "empty-crowd");
        var pose = PoseFor(oracle.specimenIds[0].id);
        view.Render(new[] { pose });
        Assert.That(view.Spawned, Is.EqualTo(0), "no stand-in passenger may be created");
        Assert.That(view.Diagnostics.Any(diagnostic => diagnostic.Code == "passenger-recipe-missing"), Is.True,
            "the missing recipe must be reported by name");
        UnityEngine.Object.DestroyImmediate(empty);

        // A row whose prefab reference is gone is also a failure, not a fallback.
        var broken = ScriptableObject.CreateInstance<PassengerCatalogue>();
        broken.clipSet = catalogue.clipSet;
        var clone = Clone(catalogue.entries.First(entry => entry.recipe == "soft-male-commuter-none"));
        clone.prefab = null;
        broken.entries = new[] { clone };
        broken.Invalidate();
        var brokenView = BuildView(broken, "broken-crowd");
        brokenView.Render(new[] { PoseFor(oracle.specimenIds[0].id) });
        Assert.That(brokenView.Spawned, Is.EqualTo(0));
        Assert.That(brokenView.Diagnostics.Any(diagnostic => diagnostic.Code == "passenger-recipe-missing"), Is.True);
        UnityEngine.Object.DestroyImmediate(broken);
    }

    [Test]
    public void LowDetailIsReportedNotSilentlySubstituted() {
        var view = BuildView(catalogue);
        var pose = PoseFor(oracle.specimenIds[0].id);
        pose.Detail = PassengerDetail.Low;
        view.Render(new[] { pose });
        Assert.That(view.SupportsLowDetail, Is.False);
        Assert.That(view.Diagnostics.Any(diagnostic => diagnostic.Code == "low-topology-unported"), Is.True,
            "Low must be reported by name until its topology is rendered");
        Assert.That(view.Spawned, Is.EqualTo(1), "the recipe itself is still the real prefab");
    }

    [Test]
    public void ReleaseDisposesTheSpawnedViews() {
        var view = BuildView(catalogue);
        view.Render(new[] { PoseFor(oracle.specimenIds[0].id) });
        Assert.That(view.TryGetActor(oracle.specimenIds[0].id, out var actor), Is.True);
        var instance = actor.Root;
        view.Release();
        Assert.That(view.Spawned, Is.EqualTo(0));
        Assert.That(instance == null, Is.True, "the passenger instance was destroyed");
    }

    static PassengerCatalogueEntry Clone(PassengerCatalogueEntry source) {
        var clone = new PassengerCatalogueEntry();
        foreach (var field in typeof(PassengerCatalogueEntry).GetFields())
            field.SetValue(clone, field.GetValue(source));
        return clone;
    }
}
