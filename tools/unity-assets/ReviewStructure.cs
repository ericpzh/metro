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
    /// Import the six generated-structure GLBs exported by export-structure.mjs,
    /// wrap each in a prefab under the Unity gameplay basis, verify the bounds,
    /// triangle topology, per-finish material regions and case anchors, and save
    /// one review scene with the cases in a compact two-row table.
    ///
    /// These are not palette modules: each GLB is one representative parameter
    /// case built from a synthetic station document by the game's own chunk
    /// mesher, ramp surface splitter and ramp-join generator.
    /// </summary>
    public static class ReviewStructure
    {
        private const string Folder = "Assets/StructureProof";
        private const string Scene = Folder + "/Structure.unity";
        private const int Count = 6;

        private static readonly Color Slate = new Color(0.22f, 0.30f, 0.38f);

        [Serializable]
        private class Manifest
        {
            public Asset[] assets;
            public Parameters parameters;
            public RuntimeCase[] runtimeCases;
        }

        [Serializable]
        private class Parameters
        {
            public string stationDocuments, conventions, materials;
            public string[] rowOrder;
            public Layout layout;
            public int runtimeCases;
        }

        [Serializable]
        private class Layout
        {
            public float gap, rowGap, frontZ, backZ, fieldOfView, ceilingLift, cameraDistance;
            public float cameraPitchDegrees, cameraYawMetres, targetY, targetZ;
            public float rowWidth, cameraFieldOfView, cameraX, cameraY, cameraZ;
            public float cameraTargetX, cameraTargetY, cameraTargetZ, maxHeight, maxDepth;
        }

        [Serializable]
        private class Asset
        {
            public string id, family, row, prefab, file, caseName, source, provenance, licenseRecord, units, sha256;
            public float[] originOffset, min, max, size;
            public float layoutX, layoutY, layoutZ, layoutYaw;
            public float gradeDegrees, runLengthMetres, riseMetres;
            public int triangles, meshes, cells, openingCells, doorCells, windowCells, cutawayCells, finishCount, seamCount, domeCount;
            public string[] materials;
            public Anchor[] anchors;
            public Region[] regions;
            public Validation validation;
        }

        [Serializable]
        private class Anchor { public string name; public float[] position; }

        [Serializable]
        private class Region
        {
            public string finish, material, mesh;
            public int triangles;
            public float area;
            public float[] min, max;
        }

        [Serializable]
        private class Validation { public int errors, warnings; }

        [Serializable]
        private class RuntimeCase { public string row, input, expected, actual; }

        /// <summary>What each row must be: the exporter's numbers pinned per case.</summary>
        private class Expected
        {
            public string id, prefab, file, caseName;
            public int triangles, meshes, openingCells, doorCells, windowCells, cutawayCells, finishCount, seamCount;
            public float sizeX, sizeY, sizeZ;
            public string[] materials;
        }

        private static readonly Expected[] ExpectedCases =
        {
            new Expected
            {
                id = "structure-floor", prefab = "StructureFloor", file = "structure-floor.glb",
                caseName = "floor-slab-with-stair-opening", triangles = 216, meshes = 2,
                sizeX = 6, sizeY = 1, sizeZ = 4, openingCells = 4,
                materials = new[] { "finish_floor_concrete", "finish_floor_granite" },
            },
            new Expected
            {
                id = "structure-wall", prefab = "StructureWall", file = "structure-wall.glb",
                caseName = "wall-with-door-and-window", triangles = 160, meshes = 1,
                sizeX = 6, sizeY = 4, sizeZ = 1, doorCells = 4, windowCells = 1,
                materials = new[] { "finish_wall_plaster" },
            },
            new Expected
            {
                id = "structure-ceiling", prefab = "StructureCeiling", file = "structure-ceiling.glb",
                caseName = "ceiling-slab-with-cutaway", triangles = 216, meshes = 2,
                sizeX = 6, sizeY = 1, sizeZ = 4, cutawayCells = 4,
                materials = new[] { "finish_ceil_metal", "finish_floor_concrete" },
            },
            new Expected
            {
                id = "structure-finishes", prefab = "StructureFinishes", file = "structure-finishes.glb",
                caseName = "adjacent-faces-with-finish-change", triangles = 88, meshes = 3,
                sizeX = 4, sizeY = 1, sizeZ = 2, finishCount = 3,
                materials = new[] { "finish_floor_concrete", "finish_floor_granite", "finish_wall_enamel" },
            },
            new Expected
            {
                id = "ramp-surface", prefab = "RampSurface", file = "ramp-surface.glb",
                caseName = "sloped-ground-under-30-degree-run", triangles = 300, meshes = 2,
                sizeX = 9, sizeY = 6, sizeZ = 1,
                materials = new[] { "finish_floor_concrete", "finish_floor_granite" },
            },
            new Expected
            {
                id = "ramp-join", prefab = "RampJoin", file = "ramp-join.glb",
                caseName = "flush-escalator-pair-seam", triangles = 2612, meshes = 2,
                sizeX = 9.9994f, sizeY = 5.9994f, sizeZ = 0.32f, seamCount = 1,
                materials = new[] { "finish_wall_stainless" },
            },
        };

        private class Imported
        {
            public Expected expected;
            public Asset manifest;
            public string prefabPath;
        }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            Require(!string.IsNullOrEmpty(evidence), "METRO_BENCH_PROOF is not set");
            string summaryPath = Path.Combine(evidence, "export", "manifest.json");
            Require(File.Exists(summaryPath), $"Missing {summaryPath}");
            var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(summaryPath));
            Require(manifest?.assets != null, "Unreadable export manifest");
            Require(manifest.assets.Length == Count, $"Expected {Count} structure cases in the manifest, got {manifest.assets.Length}");
            Require(manifest.assets.Select(asset => asset.id).Distinct().Count() == Count, "The manifest repeats a case id");
            Require(manifest.parameters != null && manifest.parameters.layout != null, "The manifest is missing its family parameters or layout");
            Require(manifest.parameters.rowOrder != null && manifest.parameters.rowOrder.Length == Count,
                $"Expected {Count} row-order entries, got {manifest.parameters.rowOrder?.Length ?? 0}");
            Require(!string.IsNullOrEmpty(manifest.parameters.stationDocuments) &&
                    manifest.parameters.stationDocuments.Contains("synthetic station documents"),
                "The manifest does not record the synthetic station documents");
            Require(!string.IsNullOrEmpty(manifest.parameters.conventions) &&
                    manifest.parameters.conventions.Contains("Z-up"),
                "The manifest does not record the source basis convention");

            // The runtime-only rows must carry their exact Node input/expected case.
            Require(manifest.runtimeCases != null && manifest.runtimeCases.Length == 2,
                $"Expected 2 runtime cases, got {manifest.runtimeCases?.Length ?? 0}");
            Require(manifest.runtimeCases.Any(runtime => runtime.row == "structure-finishes" && runtime.actual.Contains("fresh build")),
                "The finish re-mesh runtime case is missing its measured result");
            Require(manifest.runtimeCases.Any(runtime => runtime.row == "structure-ceiling" && runtime.actual.Contains("->")),
                "The cutaway recomputation runtime case is missing its measured result");
            foreach (var runtime in manifest.runtimeCases)
            {
                Require(!string.IsNullOrEmpty(runtime.input) && !string.IsNullOrEmpty(runtime.expected) && !string.IsNullOrEmpty(runtime.actual),
                    $"{runtime.row}: the runtime case is incomplete");
            }
            Require(manifest.parameters.runtimeCases == 2,
                $"The parameters report {manifest.parameters.runtimeCases} runtime cases");

            var layout = manifest.parameters.layout;
            Require(layout.rowWidth > 20f && layout.cameraZ < -20f, "The review layout is not the compact table");
            Require(layout.cameraY > layout.cameraTargetY + 5f, "The review camera must look down on the table");

            Directory.CreateDirectory(Folder);
            var summary = new List<string>();
            var imported = new List<Imported>();
            foreach (var expected in ExpectedCases)
            {
                var asset = manifest.assets.Single(entry => entry.id == expected.id);
                CheckParameters(asset, expected, manifest.parameters);
                var record = ImportAsset(asset, expected, evidence);
                imported.Add(record);
                summary.Add($"{asset.id}={record.manifest.triangles}t/{record.manifest.materials.Length}m/" +
                            $"{record.manifest.regions.Length}r");
            }

            if (!File.Exists(Scene)) BuildReviewScene(imported, layout);
            VerifyReviewScene(imported, layout);

            Debug.Log($"STRUCTURE_IMPORT_OK {imported.Count} cases {string.Join(" ", summary)} " +
                      $"row={layout.rowWidth:F2}m rows={Count / 3} v0={layout.cameraZ:F1} runtime=2");
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

        private static void CheckParameters(Asset asset, Expected expected, Parameters parameters)
        {
            string label = $"{asset.id}: ";
            Require(asset.family == "structure", $"{label}family {asset.family}");
            Require(asset.row == expected.id, $"{label}row {asset.row}");
            Require(asset.prefab == expected.prefab, $"{label}prefab {asset.prefab}");
            Require(asset.file == expected.file, $"{label}file {asset.file}");
            Require(asset.caseName == expected.caseName, $"{label}case {asset.caseName}");
            Require(asset.units == "metres", $"{label}units {asset.units}");
            Require(asset.materials != null && asset.materials.SequenceEqual(expected.materials),
                $"{label}materials {string.Join(",", asset.materials ?? Array.Empty<string>())}");
            Require(asset.regions != null && asset.regions.Length == asset.meshes,
                $"{label}expected {asset.meshes} finish regions, got {asset.regions?.Length ?? 0}");
            Require(asset.validation != null && asset.validation.errors == 0 && asset.validation.warnings == 0,
                $"{label}validation issues");
            foreach (var region in asset.regions)
            {
                Require(asset.materials.Contains(region.material), $"{label}unknown region material {region.material}");
                Require(region.triangles > 0 && region.area > 0f, $"{label}empty region {region.finish}");
            }

            Require(asset.openingCells == expected.openingCells, $"{label}opening cells {asset.openingCells}");
            Require(asset.doorCells == expected.doorCells, $"{label}door cells {asset.doorCells}");
            Require(asset.windowCells == expected.windowCells, $"{label}window cells {asset.windowCells}");
            Require(asset.cutawayCells == expected.cutawayCells, $"{label}cutaway cells {asset.cutawayCells}");
            Require(asset.finishCount == expected.finishCount, $"{label}finish count {asset.finishCount}");
            Require(asset.seamCount == expected.seamCount, $"{label}seam count {asset.seamCount}");
            Require(asset.cells > 0 || asset.seamCount > 0, $"{label}no cells or seams recorded");
            Require(asset.anchors != null && asset.anchors.Length >= 3, $"{label}expected at least three anchors");

            if (expected.id == "ramp-surface")
            {
                Near(new Vector3(asset.runLengthMetres, asset.riseMetres, 0f), new Vector3(9f, 5f, 0f), $"{label}run");
                float grade = Mathf.Atan2(asset.riseMetres, asset.runLengthMetres) * Mathf.Rad2Deg;
                Require(Mathf.Abs(asset.gradeDegrees - grade) < 0.25f,
                    $"{label}grade {asset.gradeDegrees:F2} != {grade:F2}");
            }
            if (expected.id == "ramp-join")
            {
                Require(asset.domeCount > 0, $"{label}no seam domes recorded");
                Require(asset.regions.Any(region => region.mesh.Contains("infill")), $"{label}no infill region");
                Require(asset.regions.Any(region => region.mesh.Contains("domes")), $"{label}no dome region");
            }
            if (expected.id == "structure-finishes")
            {
                Require(asset.regions.Single(region => region.finish == "wall.enamel").area == 2f,
                    $"{label}the painted region is not exactly two square metres");
                Require(asset.regions.Single(region => region.finish == "floor.granite").area == 2f,
                    $"{label}the granite region is not exactly two square metres");
            }
        }

        private static Imported ImportAsset(Asset asset, Expected expected, string evidence)
        {
            string label = asset.id;
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

            // Gameplay basis: export rotates source Z-up to glTF Y-up, glTFast
            // reflects X, and this 180 degree Y wrapper turns both back.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var root = new GameObject(expected.prefab);
            var orientation = new GameObject("Unity basis").transform;
            orientation.SetParent(root.transform, false);
            PrefabUtility.InstantiatePrefab(imported, orientation);
            orientation.localRotation = Quaternion.Euler(0, 180, 0);

            foreach (var anchor in asset.anchors)
                Near(FindAnchor(root, anchor.name).position, Basis(anchor.position), $"{label} anchor {anchor.name}");

            var renderers = root.GetComponentsInChildren<MeshRenderer>();
            Require(renderers.Length > 0, $"{label}: imported model has no mesh renderers");
            var filters = root.GetComponentsInChildren<MeshFilter>();
            Require(filters.Length == asset.meshes, $"{label}: expected {asset.meshes} mesh nodes, got {filters.Length}");
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
            Near(bounds.min, Basis(asset.min), $"{label} minimum bounds");
            Near(bounds.max, Basis(asset.max), $"{label} maximum bounds");
            var size = bounds.size;
            Near(size, new Vector3(asset.size[0], asset.size[2], asset.size[1]), $"{label} size");
            Require(Mathf.Abs(size.x - expected.sizeX) < 0.01f && Mathf.Abs(size.y - expected.sizeY) < 0.01f &&
                    Mathf.Abs(size.z - expected.sizeZ) < 0.01f,
                $"{label}: expected {expected.sizeX} x {expected.sizeY} x {expected.sizeZ}, got {size.x:F3} x {size.y:F3} x {size.z:F3}");

            int triangles = filters.Sum(filter => filter.sharedMesh.triangles.Length / 3);
            Require(triangles == asset.triangles, $"{label}: expected {asset.triangles} triangles, got {triangles}");
            Require(triangles == expected.triangles, $"{label}: expected {expected.triangles} pinned triangles, got {triangles}");

            var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
            var materials = importedMaterials.Select(material => material.name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materials.SequenceEqual(asset.materials),
                $"{label}: unexpected materials {string.Join(", ", materials)}");
            foreach (var material in importedMaterials)
            {
                Require(material.GetTexturePropertyNames().All(property => material.GetTexture(property) == null),
                    $"{label}: {material.name} unexpectedly carries a texture");
            }

            // Every finish region must be its own mesh node with the recorded
            // material, triangle count and bounds.
            foreach (var region in asset.regions)
            {
                var transform = root.GetComponentsInChildren<Transform>().SingleOrDefault(child => child.name == region.mesh);
                Require(transform != null, $"{label}: missing region node {region.mesh}");
                var filter = transform.GetComponent<MeshFilter>();
                var renderer = transform.GetComponent<MeshRenderer>();
                Require(filter != null && renderer != null, $"{label}: {region.mesh} is not a mesh node");
                Require(filter.sharedMesh.triangles.Length / 3 == region.triangles,
                    $"{label}: {region.mesh} has {filter.sharedMesh.triangles.Length / 3} triangles, expected {region.triangles}");
                Require(renderer.sharedMaterials.Length == 1 && renderer.sharedMaterial.name == region.material,
                    $"{label}: {region.mesh} wears {renderer.sharedMaterial?.name}, expected {region.material}");
                Near(renderer.bounds.min, Basis(region.min), $"{label} {region.finish} region minimum");
                Near(renderer.bounds.max, Basis(region.max), $"{label} {region.finish} region maximum");
            }

            CheckCase(asset, root, bounds);

            string prefabPath = $"{Folder}/{asset.prefab}.prefab";
            Require(PrefabUtility.SaveAsPrefabAsset(root, prefabPath) != null,
                $"{label}: could not save wrapper prefab");
            UnityEngine.Object.DestroyImmediate(root);

            return new Imported { expected = expected, manifest = asset, prefabPath = prefabPath };
        }

        private static void CheckCase(Asset asset, GameObject root, Bounds bounds)
        {
            string label = asset.id;
            switch (asset.id)
            {
                case "structure-floor":
                {
                    // The opening anchor must sit inside the slab's footprint and
                    // the slab top anchor on the walkable surface.
                    var opening = FindAnchor(root, "OpeningCentre").position;
                    Require(opening.x > bounds.min.x && opening.x < bounds.max.x &&
                            opening.z > bounds.min.z && opening.z < bounds.max.z, $"{label}: opening outside the slab");
                    Near(FindAnchor(root, "SlabTop").position.y, bounds.max.y, $"{label}: slab top");
                    break;
                }
                case "structure-wall":
                {
                    // Door and window anchors are holes: no mesh vertex may sit on
                    // the anchor's own cell face.
                    var door = FindAnchor(root, "DoorCentre").position;
                    var window = FindAnchor(root, "WindowCentre").position;
                    Require(door.y < bounds.max.y - 1.5f, $"{label}: door anchor is not at floor level");
                    Require(window.y > door.y + 0.5f, $"{label}: window anchor is not above the door");
                    break;
                }
                case "structure-ceiling":
                {
                    var cutaway = FindAnchor(root, "CutawayCentre").position;
                    Require(cutaway.y < bounds.max.y, $"{label}: cutaway anchor is not on the underside");
                    Require(FindAnchor(root, "CeilingTop").position.y > cutaway.y, $"{label}: ceiling top below cutaway");
                    break;
                }
                case "structure-finishes":
                {
                    // The painted column is the middle of three adjacent regions.
                    var granite = asset.regions.Single(region => region.finish == "floor.granite");
                    var enamel = asset.regions.Single(region => region.finish == "wall.enamel");
                    Near(enamel.min[0], granite.max[0], $"{label}: finish seam");
                    Require(Mathf.Abs(granite.min[2] - enamel.min[2]) < 0.0001f, $"{label}: finish heights differ");
                    var seam = FindAnchor(root, "FinishSeam").position;
                    Require(seam.x > bounds.min.x && seam.x < bounds.max.x, $"{label}: seam anchor outside the slab");
                    break;
                }
                case "ramp-surface":
                {
                    var foot = FindAnchor(root, "Foot").position;
                    var head = FindAnchor(root, "Head").position;
                    float rise = head.y - foot.y;
                    float run = head.x - foot.x;
                    Near(new Vector3(run, rise, 0f), new Vector3(9f, 5f, 0f), $"{label}: foot/head anchors");
                    float grade = Mathf.Atan2(rise, run) * Mathf.Rad2Deg;
                    Require(Mathf.Abs(grade - 29.05f) < 0.2f, $"{label}: anchor grade {grade:F2} degrees");
                    // The sloped cap is the granite region; it must reach from
                    // the low end to the top of the run.
                    var cap = asset.regions.Single(region => region.finish == "floor.granite");
                    Require(cap.max[2] >= 5.9f, $"{label}: sloped cap does not reach the landing");
                    Require(cap.min[2] > 0f && cap.min[2] < 1.2f, $"{label}: sloped cap leaves the ground");
                    var mid = FindAnchor(root, "SlopeMid").position;
                    Require(mid.y > foot.y + 1.5f && mid.y < head.y - 1.5f, $"{label}: slope mid anchor not on the slope");
                    break;
                }
                case "ramp-join":
                {
                    var lower = FindAnchor(root, "LowerEnd").position;
                    var upper = FindAnchor(root, "UpperEnd").position;
                    Require(upper.y - lower.y > 5f, $"{label}: seam does not follow the incline");
                    Require(Mathf.Abs(upper.x - lower.x) > 8f, $"{label}: seam does not run between the landings");
                    var seam = FindAnchor(root, "SeamCentre").position;
                    Near(seam, (lower + upper) / 2f, $"{label}: seam centre");
                    Require(asset.domeCount > 0, $"{label}: no domes");
                    break;
                }
            }
        }

        private static void BuildReviewScene(List<Imported> cases, Layout layout)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            foreach (var record in cases)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(record.prefabPath);
                Require(prefab != null, $"Missing prefab for {record.manifest.id}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = new Vector3(record.manifest.layoutX, record.manifest.layoutY, record.manifest.layoutZ);
                instance.transform.rotation = Quaternion.Euler(0f, record.manifest.layoutYaw, 0f);
            }

            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = new Vector3(layout.cameraX, layout.cameraY, layout.cameraZ);
            camera.transform.LookAt(new Vector3(layout.cameraTargetX, layout.cameraTargetY, layout.cameraTargetZ));
            camera.fieldOfView = layout.cameraFieldOfView;
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = 200f;
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
                "Could not save the structure review scene");
        }

        private static void VerifyReviewScene(List<Imported> cases, Layout layout)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();
            foreach (var record in cases)
            {
                var instance = roots.SingleOrDefault(root => root.name == record.expected.prefab);
                Require(instance != null, $"Review scene is missing the {record.expected.prefab} instance");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == record.prefabPath,
                    $"{record.expected.prefab} is not an instance of {record.prefabPath}");
                Near(instance.transform.position,
                    new Vector3(record.manifest.layoutX, record.manifest.layoutY, record.manifest.layoutZ),
                    $"{record.expected.prefab} table placement");
                Require(instance.GetComponentsInChildren<MeshRenderer>().Length > 0,
                    $"{record.expected.prefab} has no renderers");
            }

            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null);
            Require(camera != null, "Review scene has no camera");
            Require(Mathf.Abs(camera.fieldOfView - layout.cameraFieldOfView) < 0.001f, "Review camera field of view changed");
            Require(camera.clearFlags == CameraClearFlags.SolidColor, "Review camera does not clear to a solid colour");
            Require(Vector4.Distance((Vector4)camera.backgroundColor, (Vector4)Slate) < 0.002f, "Review camera background changed");
            Near(camera.transform.position, new Vector3(layout.cameraX, layout.cameraY, layout.cameraZ), "Review camera position");
            Require(camera.transform.position.y > 10f, $"Review camera must look down on the table (y={camera.transform.position.y:F2})");
            int lights = roots.Sum(root => root.GetComponents<Light>().Count(light => light.type == LightType.Directional));
            Require(lights >= 1, "Review scene is missing its directional key light");
        }

        private static Transform FindAnchor(GameObject root, string name) =>
            root.GetComponentsInChildren<Transform>().Single(child => child.name == name);

        private static Vector3 Basis(float[] v) => new Vector3(v[0], v[2], v[1]);

        private static void Near(Vector3 actual, Vector3 expected, string field) =>
            Require(Vector3.Distance(actual, expected) < 0.001f, $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Near(float actual, float expected, string field) =>
            Require(Mathf.Abs(actual - expected) < 0.001f, $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException(reason);
        }
    }
}
