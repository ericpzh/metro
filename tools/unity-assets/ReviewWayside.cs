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
    /// Import the thirteen wayside GLBs exported by export-wayside.mjs, wrap each
    /// in a prefab under the Unity gameplay basis, verify the digest, bounds,
    /// topology, material set, named parts and anchors, then save one review scene
    /// with the platform-edge run first, followed by the track kit, tunnel and
    /// bridge pieces.
    /// </summary>
    public static class ReviewWayside
    {
        private const string Folder = "Assets/WaysideProof";
        private const string Scene = Folder + "/Wayside.unity";
        private const int Count = 13;
        private const float RowSpacing = 2f;
        private const float RowDepthB = 40f;
        private const float RowDepthC = 80f;
        private static readonly Color Slate = new Color(0.22f, 0.30f, 0.38f);
        private const float CameraFieldOfView = 30f;
        private static readonly Vector3 CameraPosition = new Vector3(0f, 55f, -95f);
        private static readonly Vector3 CameraTarget = new Vector3(0f, 2f, 40f);

        // Row order: the platform-edge run first, then the track pieces, the
        // tunnel and the bridge assembly. Rows B and C carry the layer-specific
        // and bridge sub-assembly assets so every prefab is visible in one frame.
        private static readonly string[] RowA =
        {
            "platform-edge", "track-kit", "track-tunnel", "bridge-kit",
        };
        private static readonly string[] RowB =
        {
            "platform-edge-housing", "platform-edge-header", "platform-edge-decals",
            "track-details", "track-gantry",
        };
        private static readonly string[] RowC =
        {
            "bridge-railing", "bridge-noise-barrier", "bridge-edge-concrete", "bridge-pillar",
        };

        [Serializable]
        private class Manifest
        {
            public Asset[] assets;
            public Parameters parameters;
        }

        [Serializable]
        private class Parameters
        {
            public string family, station, stationEn, lineId, stock, platformRun, platformPair, trackKit, tunnel, bridge;
            public string curvedPaths, junctionPaths, materials, textures, instanceExpansion, basis, anchors;
            public int assets, cars;
            public float modelScale;
            public RuntimeCase[] runtime;
            public PathCase[] paths;
        }

        [Serializable]
        private class RuntimeCase
        {
            public string id, kind, input, expected, actual, pass;
        }

        [Serializable]
        private class PathCase
        {
            public string kind, note;
            public int rot, w, d;
        }

        [Serializable]
        private class Asset
        {
            public string id, row, family, prefab, file, sha256, source, provenance, licenseRecord, units;
            public float[] placementOffset, min, max, size, openings;
            public int triangles, meshes, textures, doorLeafCount;
            public string[] materials, alphaMaterials, glassMaterials;
            public Anchor[] anchors;
            public Part[] parts;
            public KeyValue[] parameters;
            public DoorLeaf[] doorLeaves;
            public Validation validation;
        }

        [Serializable]
        private class Anchor
        {
            public string name;
            public float[] position;
        }

        [Serializable]
        private class Part
        {
            public string name;
            public int triangles, meshes;
        }

        [Serializable]
        private class KeyValue
        {
            public string key, value;
        }

        [Serializable]
        private class DoorLeaf
        {
            public string name;
            public float x, travel, leafWidth;
            public int openSign;
            public bool glass;
        }

        [Serializable]
        private class Validation
        {
            public int errors, warnings;
        }

        private class Expected
        {
            public string id, prefab, source;
            public int minMeshes, minTriangles, openings;
            public string[] parts;
            public string[] materials;
            public string[] glass;
            public string[] anchors;
            public string[] parameters;
        }

        // One entry per checklist row. The part, material and anchor names are the
        // contract between the exporter's named layers and the imported prefab.
        private static readonly Expected[] ExpectedRows =
        {
            new Expected
            {
                id = "platform-edge", prefab = "PlatformEdge",
                source = "game/src/render/models/pieces/PsdModel.ts",
                minMeshes = 60, minTriangles = 3000, openings = 4,
                parts = new[] { "psd-threshold", "psd-info-housing", "psd-fixed-glass", "psd-door-glass", "psd-door-meeting-frame", "psd-fixed-post", "psd-section-pillar", "psd-route-header", "psd-station-header", "psd-fixed-band", "psd-door-warning", "psd-door-arrow", "psd-station-light" },
                materials = new[] { "black", "white", "steel", "waysideConcrete", "psdFixedGlass", "psdMovingGlass", "psd-route-header-ink", "psd-station-header-ink" },
                glass = new[] { "psdFixedGlass", "psdMovingGlass" },
                anchors = new[] { "AxisX", "Up", "TrackFace", "PlatformSide" },
                parameters = new[] { "line", "platformPair", "doorCadence", "openings", "leaves" },
            },
            new Expected
            {
                id = "platform-edge-housing", prefab = "PlatformEdgeHousing",
                source = "game/src/render/models/pieces/PsdHousing.ts",
                minMeshes = 10, minTriangles = 200,
                parts = new[] { "psd-threshold", "psd-concrete-foundation", "psd-info-housing", "psd-fixed-post", "psd-section-pillar", "psd-line-colour-band" },
                materials = new[] { "black", "white", "waysideConcrete" },
                glass = new string[0],
                anchors = new[] { "AxisX", "Up", "TrackFace" },
                parameters = new[] { "enclosure", "segmentation" },
            },
            new Expected
            {
                id = "platform-edge-header", prefab = "PlatformEdgeHeader",
                source = "game/src/render/models/pieces/PsdHeader.ts",
                minMeshes = 6, minTriangles = 120,
                parts = new[] { "psd-info-housing", "psd-route-header", "psd-station-header", "psd-line-colour-band" },
                materials = new[] { "psd-route-header-ink", "psd-station-header-ink", "psd-line-colour-band-ink" },
                glass = new string[0],
                anchors = new[] { "AxisX", "Up", "TrackFace" },
                parameters = new[] { "headerHeightMetres", "headerPixels", "stationName", "lineColour" },
            },
            new Expected
            {
                id = "platform-edge-decals", prefab = "PlatformEdgeDecals",
                source = "game/src/render/models/pieces/PsdDecals.ts",
                minMeshes = 20, minTriangles = 40,
                parts = new[] { "psd-fixed-band", "psd-door-band", "psd-door-warning", "psd-door-arrow" },
                materials = new[] { "psd-fixed-band-ink", "psd-door-band-ink", "psd-door-warning-ink", "psd-door-arrow-ink" },
                glass = new string[0],
                anchors = new[] { "AxisX", "Up", "TrackFace" },
                parameters = new[] { "fixedBand", "doorBand", "warning", "arrows" },
            },
            new Expected
            {
                id = "track-kit", prefab = "TrackKit",
                source = "game/src/render/models/pieces/TrackModel.ts",
                minMeshes = 50, minTriangles = 15000,
                parts = new[] { "track-bed", "track-running-rail", "track-trench-wall", "concrete sleepers", "rail seats", "spring clips", "anchor bolts", "third-rail-guard" },
                materials = new[] { "steel", "psu", "trackRailWeb", "waysideConcrete" },
                glass = new string[0],
                anchors = new[] { "AxisX", "Up", "BedCentre" },
                parameters = new[] { "straight", "turned", "curved", "junction" },
            },
            new Expected
            {
                id = "track-details", prefab = "TrackDetails",
                source = "game/src/render/models/pieces/TrackDetails.ts",
                minMeshes = 25, minTriangles = 8000,
                parts = new[] { "track-bed", "track-running-rail", "third-rail-guard", "concrete sleepers", "rail seats", "spring clips", "anchor bolts" },
                materials = new[] { "psu", "trackRailWeb", "waysideConcrete", "darkSteel" },
                glass = new string[0],
                anchors = new[] { "AxisX", "Up", "BedCentre" },
                parameters = new[] { "rail", "bed", "sleepers", "power" },
            },
            new Expected
            {
                id = "track-gantry", prefab = "TrackGantry",
                source = "game/src/render/models/pieces/TrackGantry.ts",
                minMeshes = 50, minTriangles = 12000,
                parts = new[] { "station-gantry-post", "catenary-contact-wire", "catenary-cantilever-arm", "catenary-messenger-wire", "catenary-ribbed-insulator" },
                materials = new[] { "steel", "darkSteel", "wood", "trainDark" },
                glass = new string[0],
                anchors = new[] { "AxisX", "Up", "BedCentre" },
                parameters = new[] { "posts", "support", "wire", "headroomCourses" },
            },
            new Expected
            {
                id = "track-tunnel", prefab = "TrackTunnel",
                source = "game/src/render/models/pieces/TrackModel.ts",
                minMeshes = 30, minTriangles = 8000,
                parts = new[] { "tunnel-shell-wall", "tunnel-shell-ceiling", "tunnel-shell-roof", "tunnel-shell-portal", "track-running-rail", "third-rail-guard" },
                materials = new[] { "waysideConcrete", "steel", "psu" },
                glass = new string[0],
                anchors = new[] { "AxisX", "Up", "BoreCentre" },
                parameters = new[] { "bore", "shell", "portal", "track" },
            },
            new Expected
            {
                id = "bridge-kit", prefab = "BridgeKit",
                source = "game/src/render/models/pieces/TrackModel.ts",
                minMeshes = 90, minTriangles = 18000,
                parts = new[] { "bridge-deck", "bridge-edge-concrete", "bridge-railing-top", "bridge-railing-post", "bridge-gantry-post", "track-running-rail" },
                materials = new[] { "waysideConcrete", "steel", "darkSteel", "trackRailWeb" },
                glass = new string[0],
                anchors = new[] { "AxisX", "Up", "DeckUnderside", "ShoulderNorth", "ShoulderSouth" },
                parameters = new[] { "span", "deck", "power", "supports" },
            },
            new Expected
            {
                id = "bridge-railing", prefab = "BridgeRailing",
                source = "game/src/render/models/pieces/BridgeRailing.ts",
                minMeshes = 20, minTriangles = 200,
                parts = new[] { "bridge-railing-top", "bridge-railing-post" },
                materials = new[] { "steel" },
                glass = new string[0],
                anchors = new[] { "AxisX", "Up", "DeckUnderside" },
                parameters = new[] { "profile", "runs" },
            },
            new Expected
            {
                id = "bridge-noise-barrier", prefab = "BridgeNoiseBarrier",
                source = "game/src/render/models/pieces/BridgeNoiseBarrier.ts",
                minMeshes = 100, minTriangles = 1200,
                parts = new[] { "bridge-barrier-lower-panel", "bridge-barrier-glass", "bridge-barrier-middle-rail", "bridge-barrier-top-rail", "bridge-barrier-post" },
                materials = new[] { "glass", "steel", "white" },
                glass = new[] { "glass" },
                anchors = new[] { "AxisX", "Up", "ShoulderNorth" },
                parameters = new[] { "topMetres", "bays", "glazing" },
            },
            new Expected
            {
                id = "bridge-edge-concrete", prefab = "BridgeEdgeConcrete",
                source = "game/src/render/models/pieces/BridgeEdgeConcrete.ts",
                minMeshes = 2, minTriangles = 20,
                parts = new[] { "bridge-edge-concrete" },
                materials = new[] { "waysideConcrete" },
                glass = new string[0],
                anchors = new[] { "AxisX", "Up" },
                parameters = new[] { "shoulderDepthMetres", "heightMetres", "runs" },
            },
            new Expected
            {
                id = "bridge-pillar", prefab = "BridgePillar",
                source = "game/src/render/models/pieces/PillarModel.ts",
                minMeshes = 3, minTriangles = 500,
                parts = new[] { "bridge-pillar-shaft", "bridge-pillar-collar" },
                materials = new[] { "waysideConcrete", "steel" },
                glass = new string[0],
                anchors = new[] { "AxisX", "Up", "Base" },
                parameters = new[] { "placement", "site", "heightMetres", "candidates" },
            },
        };

        private class Imported
        {
            public Expected expected;
            public Asset asset;
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
            Require(manifest.assets.Length == Count, $"Expected {Count} wayside models, got {manifest.assets.Length}");
            Require(manifest.assets.Select(asset => asset.id).Distinct().Count() == Count, "The manifest repeats a row id");
            Require(manifest.parameters != null, "The manifest is missing its family parameters");
            Require(manifest.parameters.family == "wayside", $"family {manifest.parameters.family}");
            Require(manifest.parameters.assets == Count, $"family assets {manifest.parameters.assets}");
            Require(manifest.parameters.runtime != null && manifest.parameters.runtime.Length >= 5,
                "The manifest is missing its runtime cases");
            Require(manifest.parameters.runtime.All(record => record.pass == "true"),
                "A runtime case did not pass: " + string.Join("; ", manifest.parameters.runtime.Where(r => r.pass != "true").Select(r => r.id)));
            Require(!string.IsNullOrEmpty(manifest.parameters.curvedPaths) && manifest.parameters.curvedPaths.StartsWith("unsupported"),
                "The curved-path gap is not recorded");
            Require(!string.IsNullOrEmpty(manifest.parameters.junctionPaths) && manifest.parameters.junctionPaths.StartsWith("unsupported"),
                "The junction-path gap is not recorded");
            Require(manifest.parameters.paths != null && manifest.parameters.paths.Any(path => path.kind == "straight" && path.w > 0) &&
                    manifest.parameters.paths.Any(path => path.kind == "quarter-turn" && path.rot == 1),
                "The manifest does not record the straight and quarter-turned paths");

            Directory.CreateDirectory(Folder);
            var imported = new List<Imported>();
            var summary = new List<string>();
            foreach (var expected in ExpectedRows)
            {
                var asset = manifest.assets.Single(entry => entry.id == expected.id);
                CheckAsset(asset, expected);
                var result = ImportAsset(asset, expected, evidence);
                imported.Add(result);
                summary.Add($"{asset.id}={asset.triangles}t/{asset.meshes}m/{asset.materials.Length}mat");
            }

            if (!File.Exists(Scene)) BuildReviewScene(imported);
            VerifyReviewScene(imported);

            Debug.Log($"WAYSIDE_IMPORT_OK {imported.Count} assets {string.Join(" ", summary)} " +
                      $"rowA={LayOut(imported, RowA, 0f).Last().position.x:F1}m rowB={LayOut(imported, RowB, RowDepthB).Last().position.x:F1}m " +
                      $"rowC={LayOut(imported, RowC, RowDepthC).Last().position.x:F1}m cameraY={CameraPosition.y:F1} fov={CameraFieldOfView:F0}");
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

        private static void CheckAsset(Asset asset, Expected expected)
        {
            string label = $"{asset.id}: ";
            Require(asset.row == expected.id, $"{label}row {asset.row}");
            Require(asset.prefab == expected.prefab, $"{label}prefab {asset.prefab}");
            Require(asset.file == expected.prefab + ".glb", $"{label}file {asset.file}");
            Require(asset.family == "wayside", $"{label}family {asset.family}");
            Require(asset.source == expected.source, $"{label}source {asset.source} != {expected.source}");
            Require(asset.validation != null && asset.validation.errors == 0 && asset.validation.warnings == 0,
                $"{label}validation {asset.validation?.errors}/{asset.validation?.warnings}");
            Require(asset.min != null && asset.min.Length == 3 && asset.max != null && asset.max.Length == 3,
                $"{label}missing bounds");
            Require(asset.placementOffset != null && asset.placementOffset.Length == 3, $"{label}missing placement offset");
            Require(asset.meshes >= expected.minMeshes, $"{label}expected at least {expected.minMeshes} meshes, got {asset.meshes}");
            Require(asset.triangles >= expected.minTriangles, $"{label}expected at least {expected.minTriangles} triangles, got {asset.triangles}");
            foreach (var material in expected.materials)
                Require(asset.materials.Contains(material), $"{label}missing material {material}");
            foreach (var glass in expected.glass)
                Require(asset.glassMaterials.Contains(glass), $"{label}{glass} is not recorded as glass");
            foreach (var anchor in expected.anchors)
                Require(asset.anchors != null && asset.anchors.Any(entry => entry.name == anchor), $"{label}missing anchor {anchor}");
            foreach (var parameter in expected.parameters)
                Require(asset.parameters != null && asset.parameters.Any(entry => entry.key == parameter), $"{label}missing parameter {parameter}");
            if (expected.openings > 0)
            {
                Require(asset.openings != null && asset.openings.Length == expected.openings,
                    $"{label}expected {expected.openings} openings, got {asset.openings?.Length ?? 0}");
                Require(asset.doorLeaves != null && asset.doorLeaves.Length == expected.openings * 2,
                    $"{label}expected {expected.openings * 2} glass leaves, got {asset.doorLeaves?.Length ?? 0}");
            }
            if (expected.id == "track-kit")
            {
                Require(asset.parameters.Any(entry => entry.key == "curved" && entry.value.StartsWith("unsupported")),
                    $"{label}curved-path gap not recorded");
                Require(asset.parameters.Any(entry => entry.key == "junction" && entry.value.StartsWith("unsupported")),
                    $"{label}junction-path gap not recorded");
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

            // Build the wrapper in a clean scene: the basis parent rotates 180
            // degrees about Y so the gameplay channels read (x, z, y).
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var root = new GameObject(expected.prefab);
            var orientation = new GameObject("Unity basis").transform;
            orientation.SetParent(root.transform, false);
            PrefabUtility.InstantiatePrefab(imported, orientation);
            orientation.localRotation = Quaternion.Euler(0, 180, 0);
            root.transform.rotation = Quaternion.identity;

            foreach (var anchor in asset.anchors)
            {
                var transform = FindAnchor(root, anchor.name);
                Near(transform.position, Basis(anchor.position), $"{label} anchor {anchor.name}");
            }

            var renderers = root.GetComponentsInChildren<MeshRenderer>();
            Require(renderers.Length > 0, $"{label}: imported model has no mesh renderers");
            var filters = root.GetComponentsInChildren<MeshFilter>();
            Require(filters.Length == asset.meshes, $"{label}: expected {asset.meshes} mesh nodes, got {filters.Length}");
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
            Near(bounds.min, Basis(asset.min), $"{label} minimum bounds");
            Near(bounds.max, Basis(asset.max), $"{label} maximum bounds");

            int triangles = filters.Sum(filter => filter.sharedMesh.triangles.Length / 3);
            Require(triangles == asset.triangles, $"{label}: expected {asset.triangles} triangles, got {triangles}");

            var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Where(m => m != null).Distinct().ToArray();
            var materials = importedMaterials.Select(material => material.name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materials.SequenceEqual(asset.materials),
                $"{label}: unexpected materials {string.Join(", ", materials)} (manifest {string.Join(", ", asset.materials)})");

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
            foreach (var glass in asset.glassMaterials)
            {
                var material = importedMaterials.Single(entry => entry.name == glass);
                Require(material.renderQueue >= (int)RenderQueue.Transparent, $"{label}: {glass} is not transparent");
            }

            var textures = importedMaterials
                .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                .Where(texture => texture != null).Distinct().ToArray();
            Require(textures.Length == asset.textures, $"{label}: expected {asset.textures} textures, got {textures.Length}");

            var partNames = renderers.Select(renderer => renderer.gameObject.name).ToArray();
            foreach (var part in expected.parts)
                Require(partNames.Any(name => name == part || name.StartsWith(part)), $"{label}: missing named part {part}");

            // The screen openings prove the door cadence survived import: pair the
            // sliding glass leaves and check their centres against the manifest.
            if (asset.openings != null && asset.openings.Length > 0)
            {
                var leaves = root.GetComponentsInChildren<Transform>().Where(child => child.name.StartsWith("psd-door-glass"))
                    .Select(child => child.position.x).OrderBy(x => x).ToArray();
                Require(leaves.Length == asset.openings.Length * 2,
                    $"{label}: expected {asset.openings.Length * 2} door leaves, got {leaves.Length}");
                for (int i = 0; i < asset.openings.Length; i++)
                {
                    float centre = (leaves[i * 2] + leaves[i * 2 + 1]) / 2f;
                    Require(Mathf.Abs(centre - asset.openings[i]) < 0.001f,
                        $"{label}: opening {i} centre {centre:F4} != {asset.openings[i]:F4}");
                }
            }

            // Rotate the wrapper and re-check an anchor to prove the sockets follow
            // the gameplay turn rather than being frozen in world space.
            var axisX = FindAnchor(root, "AxisX");
            root.transform.rotation = Quaternion.Euler(0, 90, 0);
            Near(axisX.position, Vector3.back, $"{label} AxisX at 90 degrees");
            root.transform.rotation = Quaternion.identity;

            string prefabPath = $"{Folder}/{asset.prefab}.prefab";
            Require(PrefabUtility.SaveAsPrefabAsset(root, prefabPath) != null, $"{label}: could not save wrapper prefab");
            UnityEngine.Object.DestroyImmediate(root);

            return new Imported { expected = expected, asset = asset, prefabPath = prefabPath };
        }

        private struct Placement
        {
            public Imported imported;
            public Vector3 position;
            public float yaw;
        }

        /// <summary>Slot each asset by its own left edge, one row per group.</summary>
        private static List<Placement> LayOut(List<Imported> imported, string[] order, float z)
        {
            var placements = new List<Placement>();
            float cursor = 0f;
            foreach (var id in order)
            {
                var entry = imported.Single(item => item.expected.id == id);
                float width = entry.asset.max[0] - entry.asset.min[0];
                placements.Add(new Placement
                {
                    imported = entry,
                    position = new Vector3(cursor - entry.asset.min[0], 0f, z),
                    // The tunnel reads as a bore only when its portal faces the camera.
                    yaw = id == "track-tunnel" ? 90f : 0f,
                });
                cursor += Mathf.Max(RowSpacing, width + RowSpacing);
            }
            return placements;
        }

        private static List<Placement> AllPlacements(List<Imported> imported)
        {
            var placements = LayOut(imported, RowA, 0f);
            placements.AddRange(LayOut(imported, RowB, RowDepthB));
            placements.AddRange(LayOut(imported, RowC, RowDepthC));
            return placements;
        }

        private static List<Placement> ScenePlacements(List<Imported> imported)
        {
            var placements = AllPlacements(imported);
            float centre = placements.Max(placement => placement.position.x) / 2f;
            return placements;
        }

        /// <summary>
        /// One review scene: the platform-edge run first, then the track pieces, the
        /// tunnel and the bridge on row A, with their layer-specific and bridge
        /// sub-assembly assets on rows B and C, framed by a camera far enough for
        /// all three rows. Only called when the scene is missing.
        /// </summary>
        private static void BuildReviewScene(List<Imported> imported)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var placements = ScenePlacements(imported);
            GameObject tunnelInstance = null;
            foreach (var placement in placements)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(placement.imported.prefabPath);
                Require(prefab != null, $"Missing prefab for {placement.imported.expected.id}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.name = placement.imported.expected.prefab;
                instance.transform.position = placement.position;
                instance.transform.rotation = Quaternion.Euler(0f, placement.yaw, 0f);
                if (placement.imported.expected.id == "track-tunnel") tunnelInstance = instance;
            }

            var centre = placements.Max(placement => placement.position.x) / 2f;
            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = new Vector3(centre, CameraPosition.y, CameraPosition.z);
            camera.transform.LookAt(new Vector3(centre, CameraTarget.y, CameraTarget.z));
            camera.fieldOfView = CameraFieldOfView;
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = 600f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Slate;
            camera.depth = 0f;

            // The main run camera sits above the corridor, so a horizontal tunnel
            // reads as its roof. A small detail camera looks straight into the
            // near portal from bore height, inset in the empty top-right corner, so the Web review
            // sees the shell's open bore rather than only its crown.
            Require(tunnelInstance != null, "The review scene has no tunnel instance");
            var tunnelBounds = tunnelInstance.GetComponentsInChildren<MeshRenderer>()[0].bounds;
            foreach (var renderer in tunnelInstance.GetComponentsInChildren<MeshRenderer>()) tunnelBounds.Encapsulate(renderer.bounds);
            bool nearDoor = CameraPosition.z < tunnelBounds.min.z;
            float detailZ = nearDoor ? tunnelBounds.min.z - 4f : tunnelBounds.max.z + 4f;
            var detail = new GameObject("Tunnel detail camera").AddComponent<Camera>();
            detail.transform.position = new Vector3(tunnelBounds.center.x, tunnelBounds.center.y, detailZ);
            detail.transform.LookAt(new Vector3(tunnelBounds.center.x, tunnelBounds.center.y, tunnelBounds.center.z));
            detail.fieldOfView = 42f;
            detail.nearClipPlane = 0.05f;
            detail.farClipPlane = 60f;
            detail.clearFlags = CameraClearFlags.Depth;
            detail.depth = 1f;
            detail.rect = new Rect(0.72f, 0.72f, 0.26f, 0.26f);

            var key = new GameObject("Key light").AddComponent<Light>();
            key.type = LightType.Directional;
            key.intensity = 2.5f;
            key.transform.rotation = Quaternion.Euler(35f, -35f, 0f);
            var fill = new GameObject("Fill light").AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.intensity = 1.1f;
            fill.transform.rotation = Quaternion.Euler(16f, 148f, 0f);

            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.45f;

            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene),
                "Could not save the wayside review scene");
        }

        /// <summary>
        /// Reopen the saved scene and check what it actually contains: every wrapper
        /// prefab at its layout position, the slate camera far enough for the run and
        /// the directional key light the Web check depends on.
        /// </summary>
        private static void VerifyReviewScene(List<Imported> imported)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();
            var placements = ScenePlacements(imported);
            foreach (var placement in placements)
            {
                var expected = placement.imported.expected;
                var instance = roots.SingleOrDefault(root => root.name == expected.prefab);
                Require(instance != null, $"Review scene is missing the {expected.prefab} instance");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == placement.imported.prefabPath,
                    $"{expected.prefab} is not an instance of {placement.imported.prefabPath}");
                Near(instance.transform.position, placement.position, $"{expected.prefab} scene placement");
                Require(Quaternion.Angle(instance.transform.rotation, Quaternion.Euler(0f, placement.yaw, 0f)) < 0.01f,
                    $"{expected.prefab} scene rotation changed");
                Require(instance.GetComponentsInChildren<MeshRenderer>().Length > 0,
                    $"{expected.prefab} instance has no renderers");
            }

            var centre = placements.Max(placement => placement.position.x) / 2f;
            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null && value.name == "Review camera");
            Require(camera != null, "Review scene has no review camera");
            Require(Mathf.Abs(camera.fieldOfView - CameraFieldOfView) < 0.001f, "Review camera field of view changed");
            Require(camera.clearFlags == CameraClearFlags.SolidColor, "Review camera does not clear to a solid colour");
            Require(Vector4.Distance((Vector4)camera.backgroundColor, (Vector4)Slate) < 0.002f, "Review camera background changed");
            Near(camera.transform.position, new Vector3(centre, CameraPosition.y, CameraPosition.z), "Review camera position");
            Require(camera.transform.position.z < -80f, $"Review camera must sit far enough back for the rows (z={camera.transform.position.z:F1})");
            Require(camera.farClipPlane >= 500f, $"Review camera far plane is too short ({camera.farClipPlane:F0})");
            var detail = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null && value.name == "Tunnel detail camera");
            Require(detail != null, "Review scene is missing the tunnel detail camera");
            Require(detail.depth > camera.depth, "The tunnel detail camera must render after the run camera");
            Require(detail.rect.width > 0.2f && detail.rect.height > 0.2f, "The tunnel detail inset is too small");
            Require(detail.clearFlags == CameraClearFlags.Depth, "The tunnel detail camera must clear depth only");
            int lights = roots.Sum(root => root.GetComponents<Light>().Count(light => light.type == LightType.Directional));
            Require(lights >= 2, "Review scene is missing its key and fill lights");
        }

        private static Vector3 Basis(float[] value) => new Vector3(value[0], value[2], value[1]);

        private static Transform FindAnchor(GameObject root, string name) =>
            root.GetComponentsInChildren<Transform>().Single(child => child.name == name);

        private static void Near(Vector3 actual, Vector3 expected, string field) =>
            Require(Vector3.Distance(actual, expected) < 0.001f, $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException(reason);
        }
    }
}




