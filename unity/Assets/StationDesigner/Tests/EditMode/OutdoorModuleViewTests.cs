using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

/// <summary>
/// B1 proof for the outdoor module views: Zoo's 86 trees and 213 fences must
/// instantiate the promoted prefab their resolved key names, choose the right
/// variant, keep the saved/derived placement, and never fall back to a batched
/// box. The fixture is the shipped `ZooSave.json` read through the ordinary v1
/// document path, so the counts come from the exact document and not a constant.
/// </summary>
public class OutdoorModuleViewTests {
    const string SavePath = "Assets/StationDesigner/Zoo/ZooSave.json";
    const string BinPrefabPath = "Assets/StationDesigner/Generated/Prefabs/Bin.prefab";
    const int ExpectedTrees = 86;
    const int ExpectedFences = 213;

    static readonly HashSet<string> BuiltinMeshNames = new HashSet<string>(StringComparer.Ordinal) {
        "Cube", "Sphere", "Capsule", "Cylinder", "Quad", "Plane",
    };

    /// <summary>
    /// Measured extents of the promoted one-cell panels, from each GLB's
    /// `POSITION` accessor min/max transformed by the GLB node matrices (the
    /// wrapper adds only a basis rotation, so the sizes carry over):
    /// glass/gate span the cell plus their end posts and floor shoes (1.030 m wide,
    /// 0.999 m tall), the iron barrier is exactly the 1.000 m cell and 0.986 m tall
    /// (its feet run across the rail), and the steel-blue fence is a 1.000 Ã— 2.000 m
    /// panel. The iron value is why a single 1.03 expectation is wrong.
    /// </summary>
    static void ExpectedPanelSize(string key, out float width, out float height) {
        switch (key) {
            case "fence":
            case "fence-gate": width = 1.03f; height = .999f; return;
            case "fence-iron": width = 1f; height = .986f; return;
            case "fence-steel-blue": width = 1f; height = 2f; return;
            default:
                Assert.Fail("no measured fence extent for view key " + key);
                width = height = 0f;
                return;
        }
    }

    static RuntimeCatalogue catalogue;
    static ModuleFacts[] station;
    static int treeCount, fenceCount;

    readonly List<GameObject> roots = new List<GameObject>();

    [OneTimeSetUp]
    public void LoadZooAndCatalogue() {
        catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
        Assert.IsNotNull(catalogue, "runtime catalogue asset missing; run the catalogue generator first");
        var asset = AssetDatabase.LoadAssetAtPath<TextAsset>(SavePath);
        Assert.IsNotNull(asset, "Zoo save fixture missing: " + SavePath);
        var document = StationSaveV1.Read(asset.text);
        station = ModuleFactsReader.Read(document.CopyModules());
        treeCount = station.Count(module => module.Type == "tree");
        fenceCount = station.Count(module => module.Type == "fence");
        Assert.AreEqual(ExpectedTrees, treeCount, "the Zoo fixture's tree count changed");
        Assert.AreEqual(ExpectedFences, fenceCount, "the Zoo fixture's fence count changed");
    }

    [TearDown]
    public void Release() {
        foreach (var root in roots) if (root) UnityEngine.Object.DestroyImmediate(root);
        roots.Clear();
    }

    static ModuleFacts Fence(string id, int x, int y, int rotation = 0, string variant = null) {
        var values = new Dictionary<string, string>();
        if (variant != null) values["variant"] = variant;
        return new ModuleFacts {
            Id = id, Type = "fence", X = x, Y = y, Z = 0, Rotation = rotation,
            Config = new ModuleConfig(values),
        };
    }

    static OutdoorModuleRequest Request(ModuleFacts module, string key, GameObject prefab, RuntimeCatalogue views,
        IReadOnlyList<ModuleFacts> neighbourhood, OutdoorPlacement placement = OutdoorPlacement.ParentPlaced) =>
        new OutdoorModuleRequest {
            ModuleId = module.Id,
            Type = module.Type,
            ViewKey = key,
            Variant = module.Config.Text("variant"),
            Mount = module.Config.Text("mount"),
            ConfigJson = "",
            DimensionsJson = "",
            X = module.X, Y = module.Y, Z = module.Z,
            Rotation = module.Rotation,
            Width = module.Width, Depth = module.Depth,
            Prefab = prefab,
            Catalogue = views,
            Placement = placement,
            Neighbours = OutdoorModuleViews.Neighbours(module, neighbourhood),
        };

    Transform Holder(ModuleFacts module, RuntimeCatalogue.Entry entry) {
        var holder = new GameObject(module.Id + " pivot");
        holder.transform.SetPositionAndRotation(ModulePlacement.Position(module, entry), ModulePlacement.Rotation(module.Rotation));
        roots.Add(holder);
        return holder.transform;
    }

    OutdoorModuleView Build(ModuleFacts module, ModuleVisual visual, IReadOnlyList<ModuleFacts> neighbourhood) {
        Assert.IsTrue(visual.HasModel, module.Id + " did not resolve: " + visual.Detail);
        Assert.AreEqual(ModuleViewKind.Prefab, visual.Kind, module.Id + " is not a prefab view");
        Assert.IsTrue(catalogue.TryGet(visual.Key, out var entry), module.Id + " has no catalogue entry for " + visual.Key);
        Assert.IsNotNull(entry.prefab, module.Id + " resolved to a key without a prefab");
        var renderers = new List<Renderer>();
        var built = OutdoorModuleViews.TryBuild(
            Request(module, visual.Key, entry.prefab, catalogue, neighbourhood), Holder(module, entry), renderers, out var view);
        Assert.IsTrue(built, module.Id + ": " + view.Diagnostic);
        Assert.IsNotNull(view.Instance, module.Id + " built no instance");
        Assert.AreEqual(module.Id, view.Instance.name, "the instance must carry the stable module ID");
        Assert.AreEqual(entry.prefabPath, view.PrefabPath, module.Id + " was built from a different prefab than its key");
        Assert.AreEqual(view.Renderers.Length, renderers.Count, module.Id + " outRenderers does not mirror the instance");
        return view;
    }

    static void AssertNoBuiltinMesh(OutdoorModuleView view) {
        var filters = view.Instance.GetComponentsInChildren<MeshFilter>(true);
        Assert.Greater(filters.Length, 0, view.ModuleId + " carries no mesh");
        foreach (var filter in filters) {
            Assert.IsNotNull(filter.sharedMesh, view.ModuleId + " has a mesh filter without a mesh");
            Assert.IsFalse(BuiltinMeshNames.Contains(filter.sharedMesh.name),
                view.ModuleId + " is the built-in " + filter.sharedMesh.name + " primitive, not the promoted model");
        }
    }

    static bool HasTransform(GameObject instance, string name) =>
        instance.GetComponentsInChildren<Transform>(true).Any(node => node.name == name);

    static HashSet<string> MaterialNames(OutdoorModuleView view) => new HashSet<string>(
        view.Renderers.SelectMany(renderer => renderer.sharedMaterials)
            .Where(material => material != null).Select(material => material.name),
        StringComparer.Ordinal);

    /// <summary>The legacy host's early batched-type set, read only to prove the intercept is gone.</summary>
    static HashSet<string> LegacyBatchedTypes() {
        var type = Type.GetType("Metro.App.ZooGeometry, Metro.App");
        if (type == null) return null;
        var field = type.GetField("BatchedTypes", BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public);
        Assert.IsNotNull(field, "ZooGeometry still exists but its BatchedTypes set was not found; update this guard to the new intercept");
        var value = field.GetValue(null) as HashSet<string>;
        Assert.IsNotNull(value, "ZooGeometry.BatchedTypes is not a HashSet<string>; update this guard");
        return value;
    }

    [Test]
    public void EveryZooTreeAndFenceInstantiatesItsResolvedPrefab() {
        Assert.IsFalse(OutdoorModuleViews.SourceHasMotion, "motion-inventory.md names no fence or tree channel");
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        int builtTrees = 0, builtFences = 0;
        foreach (var module in station) {
            if (!OutdoorModuleViews.Owns(module.Type)) continue;
            var visual = ModuleViews.Resolve(module, station, catalogue);
            var view = Build(module, visual, station);
            counts[visual.Key] = counts.TryGetValue(visual.Key, out var seen) ? seen + 1 : 1;
            Assert.IsFalse(view.Animated, module.Id + " must stay static: the source has no fence or tree motion channel");
            AssertNoBuiltinMesh(view);
            if (module.Type == "tree") {
                builtTrees++;
                Assert.AreEqual(18432, view.TriangleCount, module.Id + " is not the 18k-triangle street ash");
                Assert.AreEqual(4.5f, view.Bounds.size.y, .02f, module.Id + " tree height");
                Assert.IsTrue(HasTransform(view.Instance, "tree-trunk"), module.Id + " has no tree-trunk mesh");
                Assert.IsTrue(HasTransform(view.Instance, "tree-crown"), module.Id + " has no tree-crown mesh");
                Assert.AreEqual(0f,
                    Mathf.DeltaAngle(view.Instance.transform.eulerAngles.y, ModulePlacement.Yaw(module.Rotation)), .05f,
                    module.Id + " must keep the saved turn (`placeLocal`)");
                Assert.AreEqual(OutdoorYawSource.SavedRotation, view.YawSource);
            } else {
                builtFences++;
                Assert.GreaterOrEqual(view.TriangleCount, view.ComposedArms > 0 ? 180 : 300, module.Id + " fence model is too small to be the panel");
                ExpectedPanelSize(visual.Key, out var panelWidth, out var panelHeight);
                Assert.AreEqual(panelHeight, view.Bounds.size.y, .01f,
                    module.Id + " fence height (" + visual.Key + ")");
                // RCA 15 §4: a two-axis junction is now composed from the arms `FenceArms` derives,
                // so its extent is the arm span around the centre post — not the isolated one-metre
                // panel. Everything else still draws the promoted panel unchanged.
                if (view.ComposedArms > 0) {
                    var neighbours = OutdoorModuleViews.Neighbours(module, station);
                    var junctionArms = OutdoorModuleViews.FenceArms(module.Rotation, neighbours);
                    // The centre post's floor shoe is 0.11 m wide, so the bound never falls inside
                    // ±0.055 even where an arm runs one way only; sealed arms extend into adjacent objects.
                    bool gatePosts = visual.Key == "fence-gate";
                    float capShoe = visual.Key == "fence-iron" ? 0f : .015f;
                    float halfFoot = visual.Key == "fence-iron" ? .18f : .055f;
                    float loX = Mathf.Min(junctionArms.RunsAlongX ? junctionArms.X0 - neighbours.SealWest - ((junctionArms.CapWest || gatePosts) ? capShoe : 0f) : 0f, -halfFoot);
                    float hiX = Mathf.Max(junctionArms.RunsAlongX ? junctionArms.X1 + neighbours.SealEast + ((junctionArms.CapEast || gatePosts) ? capShoe : 0f) : 0f, halfFoot);
                    float loZ = Mathf.Min(junctionArms.RunsAlongY ? junctionArms.Y0 - neighbours.SealSouth - ((junctionArms.CapSouth || gatePosts) ? capShoe : 0f) : 0f, -halfFoot);
                    float hiZ = Mathf.Max(junctionArms.RunsAlongY ? junctionArms.Y1 + neighbours.SealNorth + ((junctionArms.CapNorth || gatePosts) ? capShoe : 0f) : 0f, halfFoot);
                    float spanX = hiX - loX, spanZ = hiZ - loZ;
                    float longest = Mathf.Max(spanX, spanZ), shortest = Mathf.Min(spanX, spanZ);
                    Assert.AreEqual(longest, Mathf.Max(view.Bounds.size.x, view.Bounds.size.z), .02f,
                        module.Id + " composed arm span (long) x[]=" + spanX + " z[]=" + spanZ);
                    if (Mathf.Abs(longest - shortest) > .05f) {
                        Assert.AreEqual(shortest, Mathf.Min(view.Bounds.size.x, view.Bounds.size.z), .02f,
                            module.Id + " composed arm span (short) x[]=" + spanX + " z[]=" + spanZ);
                    }
                    continue;
                }
                Assert.AreEqual(panelWidth, Mathf.Max(view.Bounds.size.x, view.Bounds.size.z), .01f,
                    module.Id + " panel is not its measured cell span (" + visual.Key + ")");
                var alongZ = Mathf.Abs(Mathf.Sin(view.Yaw * Mathf.Deg2Rad)) > .5f;
                Assert.Greater(alongZ ? view.Bounds.size.z : view.Bounds.size.x,
                    alongZ ? view.Bounds.size.x : view.Bounds.size.z,
                    module.Id + " panel is across its chosen axis");
            }
        }
        Assert.AreEqual(ExpectedTrees, builtTrees);
        Assert.AreEqual(ExpectedFences, builtFences);
        Assert.AreEqual(ExpectedTrees + ExpectedFences, builtTrees + builtFences,
            "every tree and fence in the document must be built");
        Assert.AreEqual(4, counts.Count, "Zoo's outdoor families resolve to four keys");
        Assert.AreEqual(ExpectedTrees, counts["tree"]);
        Assert.AreEqual(126, counts["fence"], "118 records without cfg plus 8 explicit glass");
        Assert.AreEqual(86, counts["fence-iron"]);
        Assert.AreEqual(1, counts["fence-gate"]);
    }

    [Test]
    public void FenceVariantsSelectDifferentPrefabs() {
        var expected = new[] {
            (variant: "", key: "fence", material: "glass", triangles: 360),
            (variant: "glass", key: "fence", material: "glass", triangles: 360),
            (variant: "iron", key: "fence-iron", material: "steel", triangles: 768),
            (variant: "gate", key: "fence-gate", material: "darkSteel", triangles: 432),
        };
        var prefabs = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in expected) {
            var module = station.FirstOrDefault(candidate =>
                candidate.Type == "fence" && candidate.Config.Text("variant") == item.variant);
            Assert.IsNotNull(module, "the Zoo fixture has no fence with variant '" + item.variant + "'");
            var visual = ModuleViews.Resolve(module, station, catalogue);
            Assert.AreEqual(item.key, visual.Key, "fence variant '" + item.variant + "' resolved to the wrong key");
            var view = Build(module, visual, new[] { module });
            Assert.AreEqual(item.triangles, view.TriangleCount, module.Id + " is not the " + item.key + " model");
            ExpectedPanelSize(item.key, out var panelWidth, out var panelHeight);
            Assert.AreEqual(panelHeight, view.Bounds.size.y, .01f, module.Id + " height (" + item.key + ")");
            Assert.AreEqual(panelWidth, Mathf.Max(view.Bounds.size.x, view.Bounds.size.z), .01f,
                module.Id + " panel width (" + item.key + ")");
            CollectionAssert.Contains(MaterialNames(view), item.material,
                module.Id + " does not carry the " + item.material + " material slot");
            prefabs.Add(view.PrefabPath);
            if (item.variant == "iron") CollectionAssert.DoesNotContain(MaterialNames(view), "glass", "the iron fence has no glass");
        }
        Assert.AreEqual(3, prefabs.Count, "glass, iron and gate fences must use three different prefabs");

        // Steel blue is not present in Zoo (Tianhe carries it); the same resolver and
        // builder must select it from the catalogue when a document stores it.
        var steelBlue = Fence("fence-steel-blue-test", 0, 0, 0, "steel-blue");
        var lone = new[] { steelBlue };
        var steelVisual = ModuleViews.Resolve(steelBlue, lone, catalogue);
        Assert.AreEqual("fence-steel-blue", steelVisual.Key);
        var steelView = Build(steelBlue, steelVisual, lone);
        Assert.AreEqual(1668, steelView.TriangleCount, "steel blue is not the BlueSteelFence model");
        ExpectedPanelSize("fence-steel-blue", out var steelWidth, out var steelHeight);
        Assert.AreEqual(steelHeight, steelView.Bounds.size.y, .01f, "the steel-blue fence is the 2 m panel");
        Assert.AreEqual(steelWidth, Mathf.Max(steelView.Bounds.size.x, steelView.Bounds.size.z), .01f,
            "the steel-blue fence is one cell wide");
        CollectionAssert.Contains(MaterialNames(steelView), "steelBlueFence");
        prefabs.Add(steelView.PrefabPath);
        Assert.AreEqual(4, prefabs.Count, "the four fence variants must use four different prefabs");

        var tree = station.First(module => module.Type == "tree");
        var treeVisual = ModuleViews.Resolve(tree, station, catalogue);
        Assert.AreEqual(OutdoorModuleViews.TreeKey, treeVisual.Key);
        var treeView = Build(tree, treeVisual, station);
        StringAssert.EndsWith("Tree.prefab", treeView.PrefabPath);
        Assert.AreEqual(18432, treeView.TriangleCount, "the tree is not the promoted street ash");
    }

    [Test]
    public void ValidKeyWithAMissingOrForeignPrefabDrawsNothing() {
        var module = station.First(candidate => candidate.Type == "fence");
        var visual = ModuleViews.Resolve(module, station, catalogue);
        Assert.IsTrue(catalogue.TryGet(visual.Key, out var entry));
        var holder = Holder(module, entry);

        // A valid key without a prefab is an unresolved diagnostic, never a box.
        Assert.IsFalse(OutdoorModuleViews.TryBuild(Request(module, visual.Key, null, null, station), holder, out var missing));
        Assert.IsNull(missing.Instance);
        StringAssert.StartsWith("unresolved:no-prefab", missing.Diagnostic);
        Assert.AreEqual(0, holder.childCount, "a failed build must not leave stand-in geometry");

        // A valid key with another key's prefab is a substitution and must fail too.
        var bin = AssetDatabase.LoadAssetAtPath<GameObject>(BinPrefabPath);
        Assert.IsNotNull(bin, "the negative case needs a foreign prefab");
        Assert.IsFalse(OutdoorModuleViews.TryBuild(Request(module, visual.Key, bin, catalogue, station), holder, out var foreign));
        Assert.IsNull(foreign.Instance);
        StringAssert.StartsWith("unresolved:prefab-key-mismatch", foreign.Diagnostic);
        Assert.AreEqual(0, holder.childCount, "a mismatched prefab must not be instantiated");

        // An empty key is refused before any catalogue lookup.
        Assert.IsFalse(OutdoorModuleViews.TryBuild(Request(module, "", entry.prefab, catalogue, station), holder, out var noKey));
        Assert.IsNull(noKey.Instance);
        StringAssert.StartsWith("unresolved:no-key", noKey.Diagnostic);

        // The legacy intercept must not claim either family any more. When the legacy
        // host type has been removed the families cannot be batched, so the guard passes.
        var legacy = LegacyBatchedTypes();
        if (legacy != null) {
            Assert.IsFalse(legacy.Contains("tree"),
                "ZooGeometry still intercepts tree before prefab resolution");
            Assert.IsFalse(legacy.Contains("fence"),
                "ZooGeometry still intercepts fence before prefab resolution");
        }
    }

    [Test]
    public void BuildAllReportsEveryOutdoorModuleAndSkipsOtherTypes() {
        var north = Fence("bulk-north", 0, 1);
        var centre = Fence("bulk-centre", 0, 0);
        var glass = Fence("bulk-glass", 5, 5, 0, "glass");
        var bench = new ModuleFacts { Id = "bulk-bench", Type = "bench", X = 9, Y = 9, Z = 0 };
        var tree = new ModuleFacts { Id = "bulk-tree", Type = "tree", X = 7, Y = 7, Z = 0 };
        var document = new[] { centre, north, glass, bench, tree };
        var root = new GameObject("bulk root");
        roots.Add(root);
        var built = new List<string>();
        var failures = new List<string>();
        var count = OutdoorModuleViews.BuildAll(document, catalogue, root.transform,
            (module, view) => {
                built.Add(module.Id);
                Assert.AreEqual(module.Id, view.Instance.name);
            },
            (module, diagnostic) => failures.Add(module.Id + ":" + diagnostic));
        Assert.AreEqual(4, count, "two fences plus two more fences and a tree; the bench is not this family");
        CollectionAssert.AreEquivalent(new[] { "bulk-north", "bulk-centre", "bulk-glass", "bulk-tree" }, built);
        Assert.IsEmpty(failures);
        Assert.AreEqual(4, root.transform.childCount, "one pivot per built module");

        var missing = new List<string>();
        var bare = new GameObject("bulk root without catalogue");
        roots.Add(bare);
        Assert.AreEqual(0, OutdoorModuleViews.BuildAll(document, null, bare.transform, null,
            (module, diagnostic) => missing.Add(diagnostic)));
        Assert.AreEqual(4, missing.Count, "every tree/fence must be reported, none drawn");
        Assert.IsTrue(missing.All(diagnostic => diagnostic.StartsWith("unresolved:no-prefab")),
            string.Join(", ", missing));
        Assert.AreEqual(0, bare.transform.childCount, "a failed family build leaves no pivots");
    }

    [Test]
    public void FenceArmsMatchTheSourceAndTheRunAxisWins() {
        var isolated = OutdoorModuleViews.FenceArms(0, new OutdoorNeighbours { Known = true });
        Assert.AreEqual(-.5f, isolated.X0, 1e-6);
        Assert.AreEqual(.5f, isolated.X1, 1e-6);
        Assert.IsTrue(isolated.CapEast && isolated.CapWest, "a lone rot 0 panel caps both ends of +x");
        Assert.AreEqual(0f, isolated.YSpan, 1e-6);

        var isolatedY = OutdoorModuleViews.FenceArms(1, new OutdoorNeighbours { Known = true });
        Assert.AreEqual(-.5f, isolatedY.Y0, 1e-6);
        Assert.AreEqual(.5f, isolatedY.Y1, 1e-6);
        Assert.IsTrue(isolatedY.CapNorth && isolatedY.CapSouth, "a lone rot 1 panel caps both ends of +y");

        var runEnd = OutdoorModuleViews.FenceArms(0, new OutdoorNeighbours { Known = true, East = true });
        Assert.IsTrue(runEnd.CapWest && !runEnd.CapEast, "a run end caps the far edge only");
        Assert.AreEqual(-.5f, runEnd.X0, 1e-6);

        var straight = OutdoorModuleViews.FenceArms(0,
            new OutdoorNeighbours { Known = true, East = true, West = true });
        Assert.IsFalse(straight.CapEast || straight.CapWest, "a straight run has no end caps");

        var junction = OutdoorModuleViews.FenceArms(0,
            new OutdoorNeighbours { Known = true, East = true, North = true });
        Assert.IsTrue(junction.RunsAlongX && junction.RunsAlongY, "an L junction draws both arms");
        Assert.AreEqual(0f, junction.X0, 1e-6);
        Assert.AreEqual(0f, junction.Y0, 1e-6);

        Assert.AreEqual("fence", OutdoorModuleViews.ExpectedKey("fence", ""));
        Assert.AreEqual("fence", OutdoorModuleViews.ExpectedKey("fence", "glass"));
        Assert.AreEqual("fence-gate", OutdoorModuleViews.ExpectedKey("fence", "gate"));
        Assert.AreEqual("fence-iron", OutdoorModuleViews.ExpectedKey("fence", "iron"));
        Assert.AreEqual("fence-steel-blue", OutdoorModuleViews.ExpectedKey("fence", "steel-blue"));
        Assert.AreEqual("noise-barrier", OutdoorModuleViews.ExpectedKey("fence", "sound-barrier"));
        Assert.AreEqual("noise-barrier-half", OutdoorModuleViews.ExpectedKey("fence", "sound-barrier-half"));
        Assert.AreEqual("noise-barrier-railing", OutdoorModuleViews.ExpectedKey("fence", "bridge-railing"));
        Assert.AreEqual("tree", OutdoorModuleViews.ExpectedKey("tree", ""));
        Assert.IsNull(OutdoorModuleViews.ExpectedKey("bench", "steel-1"));

        // A connected cell's axis comes from its run, not from a stale saved turn.
        var north = Fence("fence-north", 0, 1);
        var centre = Fence("fence-centre", 0, 0);
        var pair = new[] { centre, north };
        var view = Build(centre, ModuleViews.Resolve(centre, pair, catalogue), pair);
        Assert.AreEqual(OutdoorYawSource.ArmAxis, view.YawSource, "the run axis must win over the saved turn");
        Assert.AreEqual(1, view.ComposedArms, "a connected one-axis fence composes its arm directly");
        Assert.AreEqual(-90f, view.Yaw, .01f, "a north neighbour turns the panel onto +y even at rot 0");
        Assert.AreEqual(1.015f, view.Bounds.size.z, .03f, "a north neighbour spans along +y even at rot 0");
        Assert.IsTrue(view.PanelExtentMatchesSource, "a one-axis panel covers the whole cell");
        StringAssert.Contains("fence-arms-composed:1arms", view.Diagnostic);

        // An L is composed from the computed arms (RCA 15 §4): one centre post and a half span
        // toward each neighbour, which is exactly what `fenceArms` describes.
        var east = Fence("fence-east", 1, 0);
        var turn = new[] { centre, north, east };
        var corner = Build(centre, ModuleViews.Resolve(centre, turn, catalogue), turn);
        Assert.IsTrue(corner.PanelExtentMatchesSource, "the composed arms are the source's own geometry");
        Assert.AreEqual(2, corner.ComposedArms, "an L composes two arms");
        StringAssert.Contains("fence-arms-composed:2arms", corner.Diagnostic);
        Assert.AreEqual(0f, corner.Yaw, .01f, "a composed junction is drawn in the cell frame");
    }

    [Test]
    public void ZooFenceCellsReportTheirNeighbourRule() {
        int isolated = 0, runEnd = 0, straight = 0, junction = 0, overridden = 0;
        foreach (var module in station.Where(candidate => candidate.Type == "fence")) {
            var neighbours = OutdoorModuleViews.Neighbours(module, station);
            Assert.IsTrue(neighbours.Known, module.Id + " has no neighbour facts");
            var arms = OutdoorModuleViews.FenceArms(module.Rotation, neighbours);
            Assert.IsTrue(arms.RunsAlongX || arms.RunsAlongY, module.Id + " draws no panel");
            if (neighbours.Degree == 0) isolated++;
            else if (neighbours.Degree == 1) runEnd++;
            else if (arms.RunsAlongX && arms.RunsAlongY) junction++;
            else straight++;
            bool savedAlongY = ((module.Rotation % 4) + 4) % 4 % 2 == 1;
            bool armsAlongY = arms.RunsAlongY && !arms.RunsAlongX;
            if (neighbours.Degree > 0 && !(arms.RunsAlongX && arms.RunsAlongY) && savedAlongY != armsAlongY) overridden++;
        }
        Assert.AreEqual(ExpectedFences, isolated + runEnd + straight + junction);
        // The counts the document-level `fenceConnectionIndex` gives (RCA 15 §4): the fence-only
        // scan saw 4 isolated / 36 end / 165 straight / 8 L cells, because it could not see a fare
        // gate's machine face or a rail landing. Twelve fences changed arms when the full index
        // replaced it; the junction count doubles.
        Assert.AreEqual(2, isolated, "two Zoo fence cells meet neither a fence, a machine nor a landing");
        Assert.AreEqual(28, runEnd, "run-end cells");
        Assert.AreEqual(167, straight, "straight-run cells");
        Assert.AreEqual(16, junction, "L, T and + junctions across fences, gate machines and landings");
        Assert.AreEqual(6, overridden,
            "six Zoo fences store a saved turn that disagrees with the axis their run draws");
    }
}
