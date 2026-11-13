using System.Linq;
using Metro.View;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

/// <summary>
/// The generated assets and the Zoo scene wiring: the catalogue carries the palette,
/// the scene owns its player references, and the build carries no review-only models.
/// </summary>
public class RuntimeCatalogueAssetTests {
    const string ScenePath = "Assets/StationDesigner/Scenes/ZooPlayable.unity";

    static RuntimeCatalogue Catalogue() {
        var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
        Assert.IsNotNull(catalogue, "the runtime catalogue asset is missing; run Metro.Editor.RuntimeCatalogue.Generate");
        return catalogue;
    }

    [Test] public void TheCatalogueCarriesThePaletteAndItsViews() {
        var catalogue = Catalogue();
        Assert.GreaterOrEqual(catalogue.Count, 200, "the mapping covers the 152 palette ids, supplemental variants and city pieces");
        var keys = catalogue.Entries.Select(entry => entry.key).ToArray();
        Assert.AreEqual(keys.Length, keys.Distinct().Count(), "duplicate catalogue key");
        Assert.GreaterOrEqual(catalogue.Entries.Count(entry => entry.palette), 152, "every palette id must be mapped");
        foreach (var entry in catalogue.Entries) {
            if (entry.kind == "generated") Assert.IsNotEmpty(entry.generator, entry.key + " has no generator");
            else Assert.IsNotNull(entry.prefab, entry.key + " has no prefab reference");
        }
        Assert.AreEqual("Assets/StationDesigner/Generated/Prefabs/Tv.prefab", catalogue.Entries.First(entry => entry.key == "tv").prefabPath);
        Assert.AreEqual("Assets/StationDesigner/Generated/Prefabs/TvDouble.prefab", catalogue.Entries.First(entry => entry.key == "tv-double").prefabPath);
        Assert.AreEqual("Assets/StationDesigner/Generated/Prefabs/Gate.prefab", catalogue.Entries.First(entry => entry.key == "gate").prefabPath);
        Assert.AreEqual("Assets/StationDesigner/Generated/Prefabs/GateNew.prefab", catalogue.Entries.First(entry => entry.key == "gate-new").prefabPath);
    }

    [Test] public void PlacementOffsetsFollowTheSourcePivots() {
        var catalogue = Catalogue();
        Vector3 Offset(string key) => catalogue.Entries.First(entry => entry.key == key).offset;
        Assert.AreEqual(new Vector3(.5f, .5f, 1f), Offset("bin"));
        Assert.AreEqual(new Vector3(1f, .575f, 1f), Offset("bench-steel-2"), "a 2 m bench centres across both cells with the edge inset");
        Assert.AreEqual(new Vector3(.5f, .575f, 1f), Offset("bench-steel-1"));
        Assert.AreEqual(new Vector3(1f, .09f, 1f), Offset("door-steel-2"), "a two-cell door sits on the leading edge");
        Assert.AreEqual(new Vector3(.5f, .09f, 1f), Offset("door-steel-1"));
        Assert.AreEqual(new Vector3(.5f, .5f, 0f), Offset("psd-end"));
        Assert.AreEqual(new Vector3(.5f, .669873f, 1f), Offset("escalator"));
    }

    [Test] public void TheZooSceneOwnsItsPlayerReferences() {
        var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Additive);
        try {
            var view = Object.FindAnyObjectByType<Metro.App.ZooPlayableView>();
            Assert.IsNotNull(view, "the Zoo scene lost its playable view");
            Assert.IsNotNull(view.fixture, "fixture missing");
            Assert.IsNotNull(view.layout, "layout missing");
            Assert.IsNotNull(view.catalogue, "runtime catalogue is not assigned");
            Assert.IsNotNull(view.trainCatalogue, "train catalogue is not assigned");
            Assert.IsNotNull(view.passengerPrefab, "the cleared passenger rig is not assigned");
            Assert.IsNotNull(view.stationShader, "station shader missing");
            Assert.GreaterOrEqual(view.passengerClips.Length, 3, "the passenger rig needs idle, walk and board clips");
        } finally {
            if (scene.IsValid() && scene.isLoaded) EditorSceneManager.CloseScene(scene, true);
        }
    }

    [Test] public void TheZooBuildCarriesNoReviewOnlyModels() {
        var dependencies = AssetDatabase.GetDependencies(ScenePath, true);
        var leaked = dependencies.Where(path =>
            path.Contains("/Generated/Review/") ||
            path.Contains("Generated/Passengers/") ||
            path.Contains("TrainProof/") ||
            path.Contains("/Generated/Models/train-a.glb")).ToArray();
        Assert.IsEmpty(leaked, "review-only assets leaked into the Zoo build: " + string.Join(", ", leaked));
        Assert.IsTrue(dependencies.Any(path => path.EndsWith("passenger-adult.glb")), "the cleared stand-in must ship with the scene");
        Assert.IsTrue(dependencies.Any(path => path.Contains("FormationL6ThirdRailZoo")), "Zoo's own formation must ship with the scene");
    }

    [Test] public void TheFirstPlayableSceneUsesThePromotedTypeAConsist() {
        Assert.IsFalse(AssetDatabase.IsValidFolder("Assets/TrainProof"), "Assets/TrainProof was retired in favour of promoted Generated assets");
        const string firstScenePath = "Assets/StationDesigner/Scenes/FirstPlayable.unity";
        var dependencies = AssetDatabase.GetDependencies(firstScenePath, true);
        Assert.IsEmpty(dependencies.Where(path => path.Contains("TrainProof")).ToArray());
        var scene = EditorSceneManager.OpenScene(firstScenePath, OpenSceneMode.Additive);
        GameObject instance = null;
        try {
            var view = scene.GetRootGameObjects()
                .Select(root => root.GetComponent<Metro.App.FirstPlayableView>())
                .FirstOrDefault(component => component != null);
            Assert.IsNotNull(view, "FirstPlayable scene lost its view");
            Assert.AreEqual("Assets/StationDesigner/Generated/Prefabs/TrainA.prefab", AssetDatabase.GetAssetPath(view.trainPrefab));
            Assert.IsNotNull(view.platformDoors, "platform door clip missing");
            Assert.AreEqual("OpenMinus", view.platformDoors.name);
            Assert.AreEqual("Assets/StationDesigner/Generated/Models/train-a.glb", AssetDatabase.GetAssetPath(view.platformDoors));
            Assert.IsNotNull(view.stationShader, "station shader missing");

            instance = Object.Instantiate(view.trainPrefab);
            var basis = instance.transform.Find("Unity basis");
            Assert.IsNotNull(basis, "TrainA wrapper lost its Unity basis node");
            var animated = basis.GetChild(0).gameObject;
            var door = instance.GetComponentsInChildren<Transform>(true).FirstOrDefault(node => node.name == "TrainADoor00");
            Assert.IsNotNull(door, "TrainA lost TrainADoor00");
            view.platformDoors.SampleAnimation(animated, 0f);
            var closed = door.localPosition;
            view.platformDoors.SampleAnimation(animated, 1f);
            Assert.Greater(Vector3.Distance(door.localPosition, closed), .5f, "OpenMinus did not move TrainADoor00");
        } finally {
            if (instance != null) Object.DestroyImmediate(instance);
            if (scene.IsValid() && scene.isLoaded) EditorSceneManager.CloseScene(scene, true);
        }
    }
}
