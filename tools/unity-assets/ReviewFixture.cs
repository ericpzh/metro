using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.AssetExample
{
    /// <summary>
    /// Import the ten 固定设施 (fixture) GLBs exported by export-fixture.mjs, wrap each
    /// in a prefab under the Unity gameplay basis, verify the family parameters, the
    /// palette material slots, the transparent queue of the switchboard fascia, the
    /// vent's near-zero-thickness ceiling plate and the basis anchors, then save one
    /// review scene with all ten pieces in a row.
    ///
    /// The family is the bench/seat/office-chair group plus the three plant-room
    /// pieces (desk, chiller, ceiling grille, switchboard). `bench-seat-2` is already
    /// delivered as Bench.prefab by the batch-1 bench row and is deliberately absent.
    /// </summary>
    public static class ReviewFixture
    {
        private const string Folder = "Assets/FixtureProof";
        private const string Scene = Folder + "/Fixture.unity";
        private const int Count = 10;
        // The chiller and the switchboard are ~3 m wide, so the row needs 3.4 m
        // centres to keep every piece clear of its neighbour.
        private const float Spacing = 3.4f;

        /// <summary>The camera looks along +z at the row from the Approach (-z) side.</summary>
        private static readonly Vector3 CameraPosition = new Vector3(0f, 4.6f, -30f);
        private static readonly Vector3 CameraTarget = new Vector3(0f, 1.4f, 0f);
        private const float CameraFieldOfView = 42f;
        private const float CameraFarPlane = 120f;
        private static readonly Color Slate = new Color(0.22f, 0.30f, 0.38f);

        [Serializable]
        private class Manifest
        {
            public Asset[] assets;
            public Parameters parameters;
        }

        [Serializable]
        private class Parameters
        {
            public int models, rot;
            public string stationData, placement, palette, textures, basis, anchors, benchFamilies;
            public BenchSpecParameter[] benchSpecs;
        }

        [Serializable]
        private class BenchSpecParameter
        {
            public string paletteId, variant, style;
            public int cells;
            public float runMetres;
        }

        [Serializable]
        private class Asset
        {
            public string id, catalogueId, paletteId, family, variant, style, prefab, file, sha256, source, facade;
            public float[] min, max, size, placementOffset;
            public int footprintCells, triangles, meshes, textures;
            public string[] materials, alphaMaterials, glassMaterials;
            public Anchors anchors;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        /// <summary>
        /// The recipe the family claims, repeated here so a drift in the builder,
        /// the palette or the module payload fails the import instead of quietly
        /// shipping a different piece. `materials` is the sorted palette slot list
        /// and `textures` the number of canvas maps the piece draws.
        /// </summary>
        private class Expected
        {
            public string paletteId, variant, prefab, id, style, facade;
            public int cells, textures;
            public float width, depth, height;
            public string[] materials;
            public bool Bench => variant != "standard";
        }

        private static readonly Expected[] ExpectedFixtures =
        {
            new Expected
            {
                paletteId = "bench-office-1", variant = "office-1", prefab = "BenchOffice1", id = "station.bench.office-1",
                style = "office", facade = "local +y (sitter enters from +y)", cells = 1,
                width = 0.42f, depth = 0.40f, height = 0.98f, textures = 0,
                materials = new[] { "darkSteel", "rubber" },
            },
            new Expected
            {
                paletteId = "bench-seat-1", variant = "seat-1", prefab = "BenchSeat1", id = "station.bench.seat-1",
                style = "seat", facade = "local +y (back on local -y)", cells = 1,
                width = 1.04f, depth = 0.685f, height = 1.105f, textures = 0,
                materials = new[] { "darkSteel", "trainSeat", "white" },
            },
            new Expected
            {
                paletteId = "bench-steel-1", variant = "steel-1", prefab = "BenchSteel1", id = "station.bench.steel-1",
                style = "steel", facade = "local +y (front apron, no back)", cells = 1,
                width = 0.90f, depth = 0.415f, height = 0.49f, textures = 1,
                materials = new[] { "darkSteel", "steel" },
            },
            new Expected
            {
                paletteId = "bench-steel-2", variant = "steel-2", prefab = "BenchSteel2", id = "station.bench.steel-2",
                style = "steel", facade = "local +y (front apron, no back)", cells = 2,
                width = 1.90f, depth = 0.415f, height = 0.49f, textures = 1,
                materials = new[] { "darkSteel", "steel" },
            },
            new Expected
            {
                paletteId = "bench-wood-1", variant = "wood-1", prefab = "BenchWood1", id = "station.bench.wood-1",
                style = "wood", facade = "symmetric (no back)", cells = 1,
                width = 0.90f, depth = 0.645f, height = 0.49f, textures = 0,
                materials = new[] { "darkSteel", "wood", "woodLight" },
            },
            new Expected
            {
                paletteId = "bench-wood-2", variant = "wood-2", prefab = "BenchWood2", id = "station.bench.wood-2",
                style = "wood", facade = "symmetric (no back)", cells = 2,
                width = 1.90f, depth = 0.645f, height = 0.49f, textures = 0,
                materials = new[] { "darkSteel", "wood", "woodLight" },
            },
            new Expected
            {
                paletteId = "desk", variant = "standard", prefab = "Desk", id = "station.desk.standard",
                style = "desk", facade = "local -y (operator and chair on -y)", cells = 1,
                width = 0.98f, depth = 0.965f, height = 1.22f, textures = 1,
                materials = new[] { "darkSteel", "desktopScreen", "rubber", "white" },
            },
            new Expected
            {
                paletteId = "ac-unit", variant = "standard", prefab = "AcUnit", id = "station.ac-unit.standard",
                style = "ac-unit", facade = "symmetric (coil grilles front and back)", cells = 3,
                width = 2.88f, depth = 1.975f, height = 2.70f, textures = 1,
                materials = new[] { "black", "darkSteel", "steel" },
            },
            new Expected
            {
                paletteId = "vent", variant = "standard", prefab = "Vent", id = "station.vent.standard",
                style = "vent", facade = "symmetric (flush ceiling grille)", cells = 1,
                width = 0.70f, depth = 0.70f, height = 0.06f, textures = 1,
                materials = new[] { "black", "steel" },
            },
            new Expected
            {
                paletteId = "electrical-cabinet", variant = "standard", prefab = "ElectricalCabinet",
                id = "station.electrical-cabinet.standard",
                style = "electrical-cabinet", facade = "local -y (doors, meters and breakers on -y)", cells = 3,
                width = 2.95f, depth = 0.9475f, height = 2.20f, textures = 1,
                materials = new[] { "black", "darkSteel", "gateRed", "green", "orange", "steel" },
            },
        };

        private class ImportedFixture
        {
            public Expected expected;
            public Asset manifest;
            public string prefabPath;
            /// <summary>Source-space x of the piece's own centre, for the review row.</summary>
            public float centreX;
        }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            Require(!string.IsNullOrEmpty(evidence), "METRO_BENCH_PROOF is not set");
            string summaryPath = Path.Combine(evidence, "export", "manifest.json");
            Require(File.Exists(summaryPath), $"Missing {summaryPath}");
            var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(summaryPath));
            Require(manifest?.assets != null, "Unreadable export manifest");
            Require(manifest.assets.Length == Count, $"Expected {Count} fixture models in the manifest, got {manifest.assets.Length}");
            Require(manifest.assets.Select(asset => asset.paletteId).Distinct().Count() == Count,
                "The manifest repeats a palette id");
            Require(manifest.assets.All(asset => ExpectedFixtures.Any(expected => expected.paletteId == asset.paletteId)),
                "The manifest carries a model the family does not claim");
            CheckFamilyParameters(manifest.parameters);

            Directory.CreateDirectory(Folder);
            var summary = new List<string>();
            var imported = new List<ImportedFixture>();
            foreach (var expected in ExpectedFixtures)
            {
                var asset = manifest.assets.Single(entry => entry.paletteId == expected.paletteId);
                CheckAssetParameters(asset, expected, manifest.parameters);
                var fixture = ImportAsset(asset, expected, evidence);
                imported.Add(fixture);
                summary.Add($"{asset.id}={fixture.manifest.triangles}t/{fixture.manifest.materials.Length}m/" +
                            $"{fixture.manifest.alphaMaterials.Length}a/{fixture.manifest.textures}tex");
            }

            // Unity mints fresh scene fileIDs on every SaveScene call, so a
            // regenerated scene is never byte-identical between two imports. The
            // scene is a pure view over the wrapper prefabs, which are rebuilt
            // deterministically above, so create it only when it is missing and
            // verify its content on every run.
            if (!File.Exists(Scene)) BuildReviewScene(imported);
            VerifyReviewScene(imported);

            Debug.Log($"FIXTURE_IMPORT_OK {imported.Count} models {string.Join(" ", summary)} " +
                      $"row={RowX(0):F2}..{RowX(Count - 1):F2} spacing={Spacing:F1} " +
                      $"cameraY={CameraPosition.y:F2} far={CameraFarPlane:F0}");
        }

        public static void BuildWeb()
        {
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.decompressionFallback = false;
            PlayerSettings.WebGL.template = "APPLICATION:Default";
            var report = BuildPipeline.BuildPlayer(
                new[] { Scene }, Environment.GetEnvironmentVariable("METRO_BENCH_WEB"),
                BuildTarget.WebGL, BuildOptions.None);
            Require(report.summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded, report.summary.result.ToString());
        }

        private static void CheckFamilyParameters(Parameters parameters)
        {
            Require(parameters != null, "The manifest is missing its family parameters");
            Require(parameters.models == Count, $"Expected {Count} family models, got {parameters.models}");
            Require(parameters.rot == 0, $"Expected rot 0 exports, got {parameters.rot}");
            Require(!string.IsNullOrEmpty(parameters.stationData) && parameters.stationData.Contains("empty"),
                "Expected the exports to stand in an empty station document");
            Require(!string.IsNullOrEmpty(parameters.placement) && parameters.placement.Contains("placeLocal"),
                "The manifest does not record how the pieces are placed");
            Require(!string.IsNullOrEmpty(parameters.palette) && parameters.palette.Contains("createModelMaterials()"),
                "The manifest does not name the palette the pieces are made from");
            Require(!string.IsNullOrEmpty(parameters.textures) && parameters.textures.Contains("brushed"),
                "The manifest does not record the brushed-steel canvas map");
            Require(!string.IsNullOrEmpty(parameters.basis) && parameters.basis.Contains("-90"),
                "The manifest does not record the Z-up to glTF basis transform");
            Require(!string.IsNullOrEmpty(parameters.anchors) && parameters.anchors.Contains("Approach"),
                "The manifest does not record the basis anchors");
            Require(!string.IsNullOrEmpty(parameters.benchFamilies) && parameters.benchFamilies.Contains("bench-seat-2"),
                "The manifest does not record that bench-seat-2 belongs to the batch-1 bench row");
            int benches = ExpectedFixtures.Count(expected => expected.Bench);
            Require(parameters.benchSpecs != null && parameters.benchSpecs.Length == benches,
                $"Expected {benches} bench spec entries, got {parameters.benchSpecs?.Length ?? 0}");
        }

        private static void CheckAssetParameters(Asset asset, Expected expected, Parameters parameters)
        {
            string label = $"{asset.paletteId}: ";
            Require(asset.id == expected.id, $"{label}manifest id {asset.id} != {expected.id}");
            Require(asset.catalogueId == expected.paletteId, $"{label}catalogue id {asset.catalogueId}");
            Require(asset.family == "fixture", $"{label}family {asset.family}");
            Require(asset.variant == expected.variant, $"{label}variant {asset.variant} != {expected.variant}");
            Require(asset.style == expected.style, $"{label}style {asset.style} != {expected.style}");
            Require(asset.prefab == expected.prefab, $"{label}prefab {asset.prefab}");
            Require(asset.file == expected.paletteId + ".glb", $"{label}file {asset.file}");
            Require(asset.facade == expected.facade, $"{label}facade {asset.facade}");
            Require(asset.footprintCells == expected.cells, $"{label}footprint {asset.footprintCells} != {expected.cells} cells");
            Require(asset.materials != null && asset.materials.SequenceEqual(expected.materials),
                $"{label}palette slots {string.Join(", ", asset.materials ?? new string[0])} != {string.Join(", ", expected.materials)}");
            Require(asset.textures == expected.textures, $"{label}textures {asset.textures} != {expected.textures}");

            Require(asset.size != null && asset.size.Length == 3, $"{label}manifest is missing its bounds");
            Near(asset.size[0], expected.width, $"{label}width");
            Near(asset.size[1], expected.depth, $"{label}depth");
            Near(asset.size[2], expected.height, $"{label}height");
            for (int axis = 0; axis < 3; axis++)
                Near(asset.max[axis] - asset.min[axis], asset.size[axis], $"{label}size[{axis}] disagrees with min/max");
            // A piece never overgrows the floor cells its module reserves.
            Require(asset.size[0] <= expected.cells + 0.06f,
                $"{label}is {asset.size[0]:F2} m wide over {expected.cells} cell(s)");

            // Every piece stands on its cell corner; only the bench run is centred
            // on its cells and inset from the wall by 0.075 m.
            Require(asset.placementOffset != null && asset.placementOffset.Length == 3,
                $"{label}manifest is missing the placement offset");
            float offsetX = expected.Bench ? 0.5f + (expected.cells - 1) / 2f : 0.5f;
            float offsetY = expected.Bench ? 0.575f : 0.5f;
            Near(new Vector3(asset.placementOffset[0], asset.placementOffset[1], asset.placementOffset[2]),
                new Vector3(offsetX, offsetY, 1f), $"{label}placement offset");
            Require(Mathf.Abs(asset.min[2]) < 0.0001f || expected.style == "vent",
                $"{label}floor piece does not start on the tile floor (z={asset.min[2]:F4})");

            if (expected.style == "vent")
            {
                // The vent is a 6 cm ceiling plate hanging from the 4 m fallback
                // line of an empty station: thin depth must still bound and place.
                Near(asset.size[2], 0.06f, $"{label}plate thickness", 0.001f);
                Near(asset.max[2], 4f, $"{label}ceiling line", 0.01f);
                Require(asset.min[2] > 3.9f, $"{label}plate is not up at the ceiling (z={asset.min[2]:F3})");
            }

            if (expected.Bench)
            {
                var spec = parameters.benchSpecs.Single(entry => entry.paletteId == expected.paletteId);
                Require(spec.variant == expected.variant, $"{label}family variant {spec.variant} != {expected.variant}");
                Require(spec.style == expected.style, $"{label}family bench style {spec.style} != {expected.style}");
                Require(spec.cells == expected.cells, $"{label}family run {spec.cells} != {expected.cells} cells");
                float run = expected.cells == 1 ? 0.9f : 1.9f;
                Near(spec.runMetres, run, $"{label}family run length");
            }
        }

        private static ImportedFixture ImportAsset(Asset asset, Expected expected, string evidence)
        {
            string label = asset.paletteId;
            string modelPath = $"{Folder}/{asset.file}";
            string glbPath = Path.Combine(evidence, "export", asset.file);
            Require(File.Exists(glbPath), $"{label}: missing {glbPath}");
            byte[] bytes = File.ReadAllBytes(glbPath);
            string digest = BitConverter.ToString(SHA256.Create().ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
            Require(digest == asset.sha256, $"{label}: GLB digest differs from the validated manifest");
            if (!File.Exists(modelPath) || !bytes.SequenceEqual(File.ReadAllBytes(modelPath)))
                File.WriteAllBytes(modelPath, bytes);

            AssetDatabase.ImportAsset(modelPath, ImportAssetOptions.ForceSynchronousImport);
            var imported = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
            Require(imported != null, $"{label}: glTFast did not produce a model");

            // Build the wrapper prefab in a clean scene: basis parent rotated 180
            // degrees about Y, as in ReviewBench/ReviewBin/ReviewCctv/ReviewShelf.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var root = new GameObject(expected.prefab);
            var orientation = new GameObject("Unity basis").transform;
            orientation.SetParent(root.transform, false);
            PrefabUtility.InstantiatePrefab(imported, orientation);
            // Export rotates source Z-up to glTF Y-up, then glTFast reflects X.
            // The wrapper turns X and Z back to the gameplay convention (x,z,y).
            orientation.localRotation = Quaternion.Euler(0, 180, 0);

            CheckAnchor(root, "AxisX", Basis(asset.anchors.AxisX));
            CheckAnchor(root, "Front", Basis(asset.anchors.Front));
            CheckAnchor(root, "Up", Basis(asset.anchors.Up));
            CheckAnchor(root, "Approach", Basis(asset.anchors.Approach));

            var renderers = root.GetComponentsInChildren<MeshRenderer>();
            Require(renderers.Length > 0, $"{label}: imported model has no mesh renderers");
            var filters = root.GetComponentsInChildren<MeshFilter>();
            Require(filters.Length == asset.meshes,
                $"{label}: expected {asset.meshes} mesh nodes, got {filters.Length}");
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers)
                bounds.Encapsulate(renderer.bounds);
            Near(bounds.min, Basis(asset.min), $"{label} minimum bounds");
            Near(bounds.max, Basis(asset.max), $"{label} maximum bounds");

            int triangles = filters.Sum(filter => filter.sharedMesh.triangles.Length / 3);
            Require(triangles == asset.triangles,
                $"{label}: expected {asset.triangles} triangles, got {triangles}");

            var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
            var materials = importedMaterials.Select(material => material.name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materials.SequenceEqual(asset.materials),
                $"{label}: unexpected materials {string.Join(", ", materials)}");
            Require(materials.SequenceEqual(expected.materials),
                $"{label}: palette slots drifted to {string.Join(", ", materials)}");

            // Every transparent palette slot keeps the alpha queue glTFast assigns
            // to a BLEND material; every other slot stays opaque. The 配电柜's red
            // fascia (gateRed, opacity 0.82, double sided) is the family's only
            // transparent material — the fixtures carry no glazing.
            foreach (var material in importedMaterials)
            {
                bool alpha = asset.alphaMaterials.Contains(material.name);
                if (alpha)
                    Require(material.renderQueue >= (int)RenderQueue.Transparent,
                        $"{label}: {material.name} lost its transparent queue ({material.renderQueue})");
                else
                    Require(material.renderQueue < (int)RenderQueue.Transparent,
                        $"{label}: {material.name} should be opaque ({material.renderQueue})");
            }
            Require(asset.glassMaterials.Length == 0,
                $"{label}: the family glazes nothing, but glassMaterials is {string.Join(", ", asset.glassMaterials)}");
            if (expected.paletteId == "electrical-cabinet")
            {
                Require(asset.alphaMaterials.SequenceEqual(new[] { "gateRed" }),
                    $"{label}: expected the gateRed fascia to be the only alpha slot, got {string.Join(", ", asset.alphaMaterials)}");
                Require(importedMaterials.Single(material => material.name == "gateRed").renderQueue >= (int)RenderQueue.Transparent,
                    $"{label}: the red fascia lost its alpha queue");
            }
            else
            {
                Require(asset.alphaMaterials.Length == 0,
                    $"{label}: unexpected alpha slot {string.Join(", ", asset.alphaMaterials)}");
            }

            var textures = importedMaterials
                .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                .Where(texture => texture != null).Distinct().ToArray();
            Require(textures.Length == asset.textures,
                $"{label}: expected {asset.textures} textures, got {textures.Length}");
            // The steel-faced pieces wear the palette's brushed-steel canvas; the
            // desk wears its desktop-screen canvas.
            if (expected.textures > 0)
            {
                Require(importedMaterials.Any(material => material.name == "steel" || material.name == "desktopScreen"),
                    $"{label}: the canvas-textured slot is missing");
                Require(textures.All(texture => texture.width >= 64),
                    $"{label}: a canvas texture did not import at its authored size");
            }

            var axisX = FindAnchor(root, "AxisX");
            var front = FindAnchor(root, "Front");
            var up = FindAnchor(root, "Up");
            var approach = FindAnchor(root, "Approach");
            for (int i = 0; i < 4; i++)
            {
                var rotation = Quaternion.Euler(0, i * 90, 0);
                root.transform.rotation = rotation;
                Near(axisX.position, rotation * Vector3.right, $"{label} AxisX at facing {i}");
                Near(front.position, rotation * Vector3.forward, $"{label} Front at facing {i}");
                Near(up.position, rotation * Vector3.up, $"{label} Up at facing {i}");
                Near(approach.position, rotation * Vector3.back, $"{label} Approach at facing {i}");
            }
            root.transform.rotation = Quaternion.identity;

            string prefabPath = $"{Folder}/{asset.prefab}.prefab";
            Require(PrefabUtility.SaveAsPrefabAsset(root, prefabPath) != null,
                $"{label}: could not save wrapper prefab");
            UnityEngine.Object.DestroyImmediate(root);

            return new ImportedFixture
            {
                expected = expected,
                manifest = asset,
                prefabPath = prefabPath,
                centreX = (asset.min[0] + asset.max[0]) / 2f,
            };
        }

        /// <summary>
        /// One review scene: all ten wrapper prefabs in a row on 3.4 m centres, each
        /// piece centred in its own slot (the chiller and the switchboard are built
        /// from their cell corner, so their origins are 1 m off-centre), framed by a
        /// slate-clearing camera from the Approach side. Only called when the scene
        /// is missing.
        /// </summary>
        private static void BuildReviewScene(List<ImportedFixture> fixtures)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            for (int i = 0; i < fixtures.Count; i++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(fixtures[i].prefabPath);
                Require(prefab != null, $"Missing prefab for {fixtures[i].manifest.paletteId}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = RowPosition(i, fixtures[i]);
                instance.transform.rotation = Quaternion.identity;
            }

            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = CameraPosition;
            camera.transform.LookAt(CameraTarget);
            camera.fieldOfView = CameraFieldOfView;
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = CameraFarPlane;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Slate;

            var key = new GameObject("Key light").AddComponent<Light>();
            key.type = LightType.Directional;
            key.intensity = 2.6f;
            key.transform.rotation = Quaternion.Euler(35f, -35f, 0f);
            var fill = new GameObject("Fill light").AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.intensity = 1.1f;
            fill.transform.rotation = Quaternion.Euler(16f, 148f, 0f);

            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.5f;

            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene),
                "Could not save the fixture review scene");
        }

        /// <summary>
        /// Reopen the saved scene and check what it actually contains: ten prefab
        /// instances linked to the wrapper prefabs at their row positions, the slate
        /// camera with its 120 m far plane and the key light the Web check depends on.
        /// </summary>
        private static void VerifyReviewScene(List<ImportedFixture> fixtures)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();
            for (int i = 0; i < fixtures.Count; i++)
            {
                var fixture = fixtures[i];
                var instance = roots.SingleOrDefault(root => root.name == fixture.expected.prefab);
                Require(instance != null, $"Review scene is missing the {fixture.expected.prefab} instance");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == fixture.prefabPath,
                    $"{fixture.expected.prefab} is not an instance of {fixture.prefabPath}");
                Near(instance.transform.position, RowPosition(i, fixture), $"{fixture.expected.prefab} row placement");
                Require(instance.GetComponentsInChildren<MeshRenderer>().Length > 0,
                    $"{fixture.expected.prefab} instance has no renderers");
            }

            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null);
            Require(camera != null, "Review scene has no camera");
            Require(Mathf.Abs(camera.fieldOfView - CameraFieldOfView) < 0.001f, "Review camera field of view changed");
            Require(Mathf.Abs(camera.farClipPlane - CameraFarPlane) < 0.001f,
                $"Review camera far plane must frame the whole row ({camera.farClipPlane:F1} m)");
            Require(camera.clearFlags == CameraClearFlags.SolidColor, "Review camera does not clear to a solid colour");
            Require(Vector4.Distance((Vector4)camera.backgroundColor, (Vector4)Slate) < 0.002f, "Review camera background changed");
            Near(camera.transform.position, CameraPosition, "Review camera position");
            Require(camera.transform.position.z < -20f,
                $"Review camera must stand back to frame the 30 m row (z={camera.transform.position.z:F2})");
            int lights = roots.Sum(root => root.GetComponents<Light>().Count(light => light.type == LightType.Directional));
            Require(lights >= 1, "Review scene is missing its directional key light");
        }

        private static float RowX(int index) => (index - (Count - 1) / 2f) * Spacing;

        private static Vector3 RowPosition(int index, ImportedFixture fixture) =>
            new Vector3(RowX(index) - fixture.centreX, 0f, 0f);

        private static Vector3 Basis(float[] v) => new Vector3(v[0], v[2], v[1]);

        private static Transform FindAnchor(GameObject root, string name) =>
            root.GetComponentsInChildren<Transform>().Single(child => child.name == name);

        private static void CheckAnchor(GameObject root, string name, Vector3 expected) =>
            Near(FindAnchor(root, name).position, expected, name);

        private static void Near(Vector3 actual, Vector3 expected, string field, float tolerance = 0.001f) =>
            Require(Vector3.Distance(actual, expected) < tolerance, $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Near(float actual, float expected, string field, float tolerance = 0.02f) =>
            Require(Mathf.Abs(actual - expected) < tolerance, $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException(reason);
        }
    }
}
