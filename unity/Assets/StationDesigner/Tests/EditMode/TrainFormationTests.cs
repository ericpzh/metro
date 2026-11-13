using System.Collections.Generic;
using System.Linq;
using Metro.View;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

/// <summary>
/// The formation key is stock class + car count + power. Every menu cell must map to
/// a promoted consist, and Zoo's Line 5 selection must resolve the promoted livery
/// variant without re-applying its baked scale.
/// </summary>
public class TrainFormationTests {
    const string CataloguePath = Metro.View.TrainCatalogue.AssetPath;
    const string ZooPrefab = "Assets/StationDesigner/Generated/Prefabs/FormationL6ThirdRailZoo.prefab";
    const string ModelPath = "Assets/StationDesigner/Generated/Models/train-l.glb";

    static TrainCatalogue Catalogue() {
        var catalogue = AssetDatabase.LoadAssetAtPath<TrainCatalogue>(CataloguePath);
        Assert.IsNotNull(catalogue, "the train catalogue asset is missing; run Metro.Editor.TrainCatalogue.Generate");
        return catalogue;
    }

    [Test] public void TheFormationMenuHasFiftyUniqueKeys() {
        var keys = TrainFormations.All().ToArray();
        Assert.AreEqual(50, keys.Length);
        Assert.AreEqual(50, keys.Distinct().Count());
        Assert.AreEqual(50, TrainFormations.Stocks.Length * TrainFormations.CarCounts.Length * TrainFormations.Powers.Length);
    }

    [Test] public void EveryMenuKeySelectsAPromotedFormation() {
        var catalogue = Catalogue();
        var missing = TrainFormations.All().Where(key => !catalogue.Has(key)).ToArray();
        Assert.IsEmpty(missing, "missing formations: " + string.Join(", ", missing));
        foreach (var key in TrainFormations.All()) {
            Assert.IsTrue(catalogue.TryGet(key, out var entry), key);
            Assert.IsNotNull(entry.prefab, key + " has no prefab reference");
            // Only the promoted Line 5 livery bakes the 0.98 model scale; every other
            // formation is authored at 1:1 and gets its scale from the line.
            float expected = key == "L.6.third-rail" ? .98f : 1f;
            Assert.AreEqual(expected, entry.bakedScale, 1e-4f, key + " baked scale");
        }
    }

    [Test] public void KeysRoundTripThroughTheirParts() {
        foreach (var key in TrainFormations.All()) {
            Assert.IsTrue(TrainFormations.TryParse(key, out var stock, out var cars, out var power, out var zoo), key);
            Assert.IsFalse(zoo, key);
            Assert.AreEqual(key, TrainFormations.Key(stock, cars, power), key);
        }
        Assert.AreEqual("third-rail", TrainFormations.Power("thirdRail"));
        Assert.AreEqual("overhead", TrainFormations.Power(""));
        Assert.AreEqual("A.2.overhead", TrainFormations.Key("a", 2, "catenary"));
        Assert.AreEqual("A.2.overhead", TrainFormations.Key("Z", 2, "overhead"), "an unknown stock class falls back to A's family");
        Assert.IsTrue(TrainFormations.TryParse("L.6.third-rail@zoo", out _, out var zooCars, out _, out var livery));
        Assert.AreEqual(6, zooCars);
        Assert.IsTrue(livery);
    }

    [Test] public void ZooLineFiveSelectsThePromotedLiveryAndKeepsItsBakedScale() {
        var catalogue = Catalogue();
        var key = TrainFormations.Select("L", 6, "third-rail", catalogue);
        Assert.AreEqual("L.6.third-rail@zoo", key);
        Assert.IsTrue(catalogue.TryGet(key, out var entry), "Zoo formation is missing");
        Assert.AreEqual(ZooPrefab, entry.prefabPath);
        Assert.AreEqual(.98f, entry.bakedScale, 1e-4f, "the consist bakes Line 5's 0.98 model scale");
        // The menu slot and its livery variant resolve the same promoted consist.
        Assert.IsTrue(catalogue.TryGet("L.6.third-rail", out var plain), "the plain Line 5 slot is missing");
        Assert.AreEqual(entry.prefabPath, plain.prefabPath);
        Assert.AreEqual(6, entry.cars);
        // The livery is baked into the promoted prefab; the runtime must not rescale it.
        var prefab = entry.prefab;
        var consist = prefab.GetComponentsInChildren<Transform>(true).First(node => node.name == "Consist");
        Assert.IsNotNull(consist, "the promoted consist lost its Consist node");
        Assert.AreEqual(.98f, consist.localScale.x, 1e-4f);
        Assert.AreEqual(1f, prefab.transform.localScale.x, 1e-4f, "the wrapper must stay unscaled");
    }

    [Test] public void TheZooConsistCarriesDoorCentresAndBothBanks() {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(ZooPrefab);
        Assert.IsNotNull(prefab);
        var centres = prefab.GetComponentsInChildren<Transform>(true)
            .Where(node => node.name.StartsWith("DoorCentre-", System.StringComparison.Ordinal)).ToArray();
        Assert.AreEqual(18, centres.Length, "six L cars carry three doors each");
        var clips = AssetDatabase.LoadAllAssetsAtPath(ModelPath).OfType<AnimationClip>().ToArray();
        var names = clips.Select(clip => clip.name).ToArray();
        Assert.Contains("OpenPlus", names);
        Assert.Contains("OpenMinus", names);
        // Leaves are named per car body (TrainLMidDoor00, TrainLCabLeadDoor00, ...).
        var leaves = prefab.GetComponentsInChildren<Transform>(true)
            .Count(node => node.name.Contains("Door") && char.IsDigit(node.name[node.name.Length - 1]));
        Assert.Greater(leaves, 0, "the imported leaves must be reachable from the promoted consist");
    }

    [Test] public void ThePromotedConsistGeneratesDoorBindings() {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(ZooPrefab);
        Assert.IsNotNull(prefab);
        var instance = Object.Instantiate(prefab);
        try {
            var rig = new Metro.App.TrainDoorRig(instance, .98f);
            Assert.Greater(rig.Leaves, 0, "no exported leaves found under the promoted consist");
            Assert.Greater(rig.Doors, 0, "door pairs were not grouped: " + rig.Describe());
            rig.Apply(0f);
            rig.Apply(1f);
            Assert.Greater(rig.Movement, .3f,
                "the platform bank did not move: " + rig.Describe());
        } finally {
            Object.DestroyImmediate(instance);
        }
    }

    [Test] public void PassengerRigCarriesTheClearedClips() {
        var clips = AssetDatabase.LoadAllAssetsAtPath("Assets/StationDesigner/Generated/Models/passenger-adult.glb")
            .OfType<AnimationClip>().Select(clip => clip.name).ToArray();
        foreach (var name in new[] { "Idle", "Walk", "Board", "Stairs", "Escalator", "Seated" }) {
            Assert.Contains(name, clips, "the cleared rig lost its " + name + " clip");
        }
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/StationDesigner/Generated/Models/passenger-adult.glb");
        Assert.IsNotNull(prefab);
        var renderers = prefab.GetComponentsInChildren<Renderer>(true);
        Assert.IsNotEmpty(renderers);
        var bounds = renderers[0].bounds;
        foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
        Assert.AreEqual(1.70f, bounds.max.y - bounds.min.y, .08f, "the cleared stand-in is 1.70 m");
    }
}
