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
    /// Import the formations family exported by export-formations.mjs.
    ///
    /// The exporter writes reusable car parts — leading cab, trailing cab and
    /// intermediate per stock, a plain roof cap, a roof well, the gangway and
    /// one shared pantograph — plus a summary manifest containing the 50-cell
    /// editor matrix (5 stock classes × 2 powers × 2/3/4/6/8 cars).
    ///
    /// This review:
    ///   * verifies every part GLB (digest, bounds, triangles, materials,
    ///     door clips and sampled leaves, the roof-well centre height, the
    ///     pantograph contact height);
    ///   * rebuilds every one of the 50 cells from the part prefabs and checks
    ///     car spacing, overall length, the body/gangway gap, every door centre
    ///     and width, both door banks, the pantograph index/elbow/mount, and
    ///     the four basis anchors at four facings;
    ///   * proves travel-direction reversal swaps the leading/trailing cabs
    ///     while every mount stays put;
    ///   * saves one formation prefab per rendered evidence configuration
    ///     (ten short two-car consists, A 8-car overhead, Zoo's exact L 6-car
    ///     third rail) and a review scene with those consists, platform edges,
    ///     door-centre markers and lamps;
    ///   * logs FORMATIONS_IMPORT_OK.
    ///
    /// The Zoo record is resolved from the save by the exporter; this review
    /// re-checks the resolved values (L, six cars, third rail, scale 0.98,
    /// travel sign +1, colour #c70541).
    /// </summary>
    public static class ReviewFormations
    {
        private const string Folder = "Assets/FormationsProof";
        private const string Scene = Folder + "/Formations.unity";
        private const int CellCount = 50;
        private const float DoorTolerance = 0.051f;
        private static readonly Color Slate = new Color(0.22f, 0.30f, 0.38f);
        private static readonly Vector3 CameraPosition = new Vector3(0f, 90f, 140f);
        private static readonly Vector3 CameraTarget = new Vector3(0f, 0f, -1f);
        private const float CameraSize = 33f;
        private const float FormationPitch = 9f;
        private const float FormationColumnX = 30f;
        private const float LongTrackZ = -24f;
        private const float ZooTrackZ = -38f;

        [Serializable]
        private class Manifest
        {
            public int schemaVersion;
            public string family;
            public Parameters parameters;
            public Asset[] assets;
            public Cell[] cells;
            public FormationSpec[] formations;
            public FamilyValidation validation;
        }

        [Serializable]
        private class Parameters
        {
            public int models, cells;
            public MatrixSummary matrix;
            public Zoo zoo;
            public string partArchitecture, livery, doors, doorRounding, basis, roof, rendered;
            public int[] carCounts;
            public string[] powers, stocks;
        }

        [Serializable]
        private class MatrixSummary { public int total, passed, failed; }

        [Serializable]
        private class Zoo
        {
            public string file, lineId, name, stock, power, direction, colour, psd;
            public int cars, travelSign;
            public float modelScale;
        }

        [Serializable]
        private class FamilyValidation { public int errors, warnings; }

        [Serializable]
        private class Asset
        {
            public int schemaVersion, canonicalCars, triangles, meshes, textures;
            public string id, file, kind, stock, doorPrefix, lamp, source, provenance, units, sha256;
            public float[] min, max, size;
            public string[] materials, alphaMaterials, glassMaterials, clips;
            public Door[] doors;
            public Doorway[] doorways;
            public Gap gap;
            public float bodyHalf, centreTopZ, mountZ, contactZ, gapLength;
            public int elbow;
            public bool well;
            public FamilyValidation validation;
        }

        [Serializable]
        private class Door
        {
            public string name;
            public int side, doorway;
            public float travel, openSign, plugTravel;
            public Sample[] samples;
        }

        [Serializable]
        private class Sample { public float[] position; }

        [Serializable]
        private class Doorway { public float centre, width; public bool single; }

        [Serializable]
        private class Gap { public float localX, halfLength; }

        [Serializable]
        private class Cell
        {
            public string id, stock, power, status;
            public int cars, dirSign;
            public float carLength, bodyHalf, gap, length, overall, doorMaxDelta;
            public float[] carCentres, doorCentres, doorWidths;
            public CarPlan[] plan;
            public PanExpect[] pantographs;
            public Anchors anchors;
            public Reversal dirSignReversal;
            public string[] failures;
        }

        [Serializable]
        private class CarPlan
        {
            public int index;
            public float centre, gapX, panX;
            public string role, part, module;
            public int rotation, panDirection;
        }

        [Serializable]
        private class PanExpect { public int car; public float x; public int direction; }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        [Serializable]
        private class Reversal
        {
            public string status, forwardMinusX, reverseMinusX;
            public bool mounts;
        }

        [Serializable]
        private class FormationSpec
        {
            public string id, prefab, stock, power, colour, doorsOpen;
            public int cars, dirSign;
            public float modelScale;
            public bool zoo;
        }

        private class PartInfo
        {
            public Asset asset;
            public string modelPath;
            public GameObject model;
            public Dictionary<string, AnimationClip> clips;
            public Bounds bounds;
        }

        private class Built
        {
            public GameObject root, basis, consist;
            /// <summary>The plan actually built (forward, or the reversed Zoo plan).</summary>
            public Cell cell;
            public Dictionary<int, GameObject> cars = new Dictionary<int, GameObject>();
            public Dictionary<int, GameObject> models = new Dictionary<int, GameObject>();
            public Dictionary<int, GameObject> modules = new Dictionary<int, GameObject>();
            public Dictionary<int, GameObject> pans = new Dictionary<int, GameObject>();
            public List<GameObject> gangways = new List<GameObject>();
        }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            Require(!string.IsNullOrEmpty(evidence), "METRO_BENCH_PROOF is not set");
            string manifestPath = Path.Combine(evidence, "export", "manifest.json");
            Require(File.Exists(manifestPath), $"Missing {manifestPath}");
            var manifest = JsonUtility.FromJson<Manifest>(File.ReadAllText(manifestPath));
            Require(manifest?.assets != null && manifest.cells != null && manifest.formations != null,
                "Unreadable formations export manifest");
            Require(manifest.family == "formations", $"Expected the formations family, got {manifest.family}");
            Require(manifest.assets.Length == 31, $"Expected 31 shared parts, got {manifest.assets.Length}");
            Require(manifest.cells.Length == CellCount, $"Expected {CellCount} editor cells, got {manifest.cells.Length}");
            Require(manifest.formations.Length == 12, $"Expected 12 evidence formations, got {manifest.formations.Length}");
            Require(manifest.cells.Select(cell => cell.id).Distinct().Count() == CellCount, "The cell matrix repeats an id");
            CheckParameters(manifest.parameters);

            Directory.CreateDirectory(Folder);
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var parts = new Dictionary<string, PartInfo>();
            foreach (var asset in manifest.assets)
            {
                Require(!parts.ContainsKey(asset.id), $"Duplicate part id {asset.id}");
                parts.Add(asset.id, VerifyPart(asset, evidence));
            }

            CheckZoo(manifest.parameters.zoo, manifest.formations);

            // The 50-cell matrix: rebuild every editor configuration from the
            // shared part prefabs and check it against the exported oracle.
            var failures = new List<string>();
            int passes = 0;
            foreach (var cell in manifest.cells)
            {
                try
                {
                    VerifyCell(cell, parts);
                    VerifyReversal(cell, parts);
                    passes++;
                    Debug.Log($"FORMATIONS_CELL {cell.id} PASS cars={cell.cars} power={cell.power} " +
                              $"doors={cell.doorCentres.Length} pans={cell.pantographs.Length} " +
                              $"doorRoundMax={cell.doorMaxDelta:F3}");
                }
                catch (Exception exception)
                {
                    failures.Add($"{cell.id}: {exception.Message}");
                    Debug.LogError($"FORMATIONS_CELL {cell.id} FAIL {exception.Message}");
                }
            }
            Debug.Log($"FORMATIONS_MATRIX {passes}/{CellCount} PASS {failures.Count} FAIL");
            Require(failures.Count == 0, $"Formation matrix failed: {string.Join(" | ", failures.Take(4))}");

            // One physical reverse-direction build for the Zoo consist proves
            // the leading/trailing presentation swaps without moving a mount.
            VerifyReverseBuild(manifest.cells.Single(cell => cell.id == "L-third-rail-6"), parts);

            // The rendered evidence configurations: one formation prefab each.
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            var built = new List<Built>();
            foreach (var spec in manifest.formations)
            {
                var cell = manifest.cells.Single(entry => entry.id == spec.id);
                string prefabPath = $"{Folder}/{spec.prefab}.prefab";
                if (File.Exists(prefabPath))
                {
                    // Unity mints fresh fileIDs for nested prefab instances on
                    // every SaveAsPrefabAsset. Keep the first-import prefab and
                    // verify it on the repeat pass; the scene is likewise saved
                    // once. This keeps the proof runner's second import stable.
                    var cached = VerifyCachedFormation(spec, cell, prefabPath);
                    Debug.Log($"FORMATIONS_FORMATION {spec.prefab} {spec.stock}-{spec.power}-{spec.cars} " +
                              $"scale={spec.modelScale:F2} {cached.triangles}t " +
                              $"bounds=({cached.bounds.size.x:F1},{cached.bounds.size.y:F1},{cached.bounds.size.z:F1}) " +
                              $"pans={cell.pantographs.Length} cached prefab={prefabPath}");
                    continue;
                }
                var formation = BuildFormation(cell, parts, spec.modelScale, spec.dirSign, true, spec.prefab);
                CheckLamps(formation, spec.dirSign);
                var renderers = formation.root.GetComponentsInChildren<MeshRenderer>();
                Require(renderers.Length > 0, $"{spec.prefab}: no renderers");
                var bounds = renderers[0].bounds;
                foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
                int triangles = formation.root.GetComponentsInChildren<MeshFilter>()
                    .Sum(filter => filter.sharedMesh.triangles.Length / 3);
                Require(PrefabUtility.SaveAsPrefabAsset(formation.root, prefabPath) != null,
                    $"{spec.prefab}: could not save the formation prefab");
                Debug.Log($"FORMATIONS_FORMATION {spec.prefab} {spec.stock}-{spec.power}-{spec.cars} " +
                          $"scale={spec.modelScale:F2} {triangles}t " +
                          $"bounds=({bounds.size.x:F1},{bounds.size.y:F1},{bounds.size.z:F1}) " +
                          $"pans={formation.pans.Count} prefab={prefabPath}");
                UnityEngine.Object.DestroyImmediate(formation.root);
                built.Add(formation);
            }

            // Save the review scene only when missing; verify it every run.
            if (!File.Exists(Scene))
            {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
                BuildReviewScene(manifest, parts);
            }
            VerifyReviewScene(manifest, parts);
            int prefabs = manifest.formations.Length;
            Debug.Log($"FORMATIONS_IMPORT_OK {parts.Count} parts {passes}/{CellCount} cells {prefabs} formations " +
                      $"zoo={manifest.parameters.zoo.stock}-{manifest.parameters.zoo.cars}-{manifest.parameters.zoo.power} " +
                      $"scale={manifest.parameters.zoo.modelScale:F2} tracks={prefabs} camera=ortho{CameraSize:F0}");
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

        /* ------------------------------------------------------------ checks */

        private static void CheckParameters(Parameters parameters)
        {
            Require(parameters != null, "The manifest is missing its parameters");
            Require(parameters.models == 31, $"Expected 31 parts, got {parameters.models}");
            Require(parameters.cells == CellCount, $"Expected {CellCount} cells, got {parameters.cells}");
            Require(parameters.matrix != null && parameters.matrix.total == CellCount &&
                    parameters.matrix.passed == CellCount && parameters.matrix.failed == 0,
                "The exported cell matrix is not 50/50");
            Require(parameters.carCounts != null && parameters.carCounts.SequenceEqual(new[] { 2, 3, 4, 6, 8 }),
                "The formation menu changed");
            Require(parameters.powers != null && parameters.powers.Length == 2 &&
                    parameters.powers.Contains("third-rail") && parameters.powers.Contains("catenary"),
                "The power menu changed");
            Require(parameters.stocks != null && parameters.stocks.Length == 5,
                "The stock list changed");
            Require(!string.IsNullOrEmpty(parameters.doors) && parameters.doors.Contains("OpenPlus") &&
                    parameters.doors.Contains("OpenMinus"), "The manifest does not record both door clips");
            Require(!string.IsNullOrEmpty(parameters.basis) && parameters.basis.Contains("180"),
                "The manifest does not record the Unity basis correction");
            Require(!string.IsNullOrEmpty(parameters.roof) && parameters.roof.Contains("3.57") &&
                    parameters.roof.Contains("2.85"), "The manifest does not record the roof layout");
            Require(!string.IsNullOrEmpty(parameters.doorRounding), "The manifest does not record the door rounding rule");
        }

        private static void CheckZoo(Zoo zoo, FormationSpec[] formations)
        {
            Require(zoo != null, "The manifest is missing the Zoo line record");
            Require(zoo.stock == "L", $"Zoo stock {zoo.stock} != L");
            Require(zoo.cars == 6, $"Zoo cars {zoo.cars} != 6");
            Require(zoo.power == "third-rail", $"Zoo power {zoo.power} != third-rail");
            Require(Mathf.Abs(zoo.modelScale - 0.98f) < 0.001f, $"Zoo model scale {zoo.modelScale} != 0.98");
            Require(zoo.travelSign == 1, $"Zoo travel sign {zoo.travelSign} != 1");
            Require(zoo.colour == "#c70541", $"Zoo colour {zoo.colour} != #c70541");
            Require(!string.IsNullOrEmpty(zoo.file) && zoo.file.Contains("ZooSave.json"), "Zoo source is not the save");
            var exact = formations.SingleOrDefault(spec => spec.zoo);
            Require(exact != null, "No evidence formation is marked as the Zoo consist");
            Require(exact.stock == "L" && exact.cars == 6 && exact.power == "third-rail" &&
                    Mathf.Abs(exact.modelScale - 0.98f) < 0.001f,
                "The Zoo evidence formation does not match the line record");
        }

        private static PartInfo VerifyPart(Asset asset, string evidence)
        {
            string label = asset.id;
            string glbPath = Path.Combine(evidence, "export", asset.file);
            Require(File.Exists(glbPath), $"{label}: missing {glbPath}");
            byte[] bytes = File.ReadAllBytes(glbPath);
            string digest = BitConverter.ToString(SHA256.Create().ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
            Require(digest == asset.sha256, $"{label}: GLB digest differs from the validated manifest");
            string modelPath = $"{Folder}/{asset.file}";
            bool write = !File.Exists(modelPath) || !bytes.SequenceEqual(File.ReadAllBytes(modelPath));
            if (write) File.WriteAllBytes(modelPath, bytes);
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
            if (write || model == null)
            {
                // Import only when the bytes changed (or the asset is new).
                // A forced reimport on the repeat pass rewrites model metadata
                // and would break the proof runner's stable-import fingerprint.
                AssetDatabase.ImportAsset(modelPath, ImportAssetOptions.ForceSynchronousImport);
                model = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
            }
            Require(model != null, $"{label}: glTFast did not import the part");
            var assets = AssetDatabase.LoadAllAssetsAtPath(modelPath);
            var clips = assets.OfType<AnimationClip>().ToDictionary(clip => clip.name);
            Require(clips.Count == (asset.clips?.Length ?? 0),
                $"{label}: expected {asset.clips?.Length ?? 0} clips, got {string.Join(",", clips.Keys)}");
            foreach (var clip in clips.Values)
                Require(Mathf.Abs(clip.length - 1f) < 0.001f, $"{label}: {clip.name} duration changed to {clip.length}");

            // glTFast converts the glTF handedness by mirroring X. The game's
            // Unity basis (180 degrees about Y) composes with that and with the
            // exported -90 degree X wrap to put the part in the gameplay frame:
            // Unity world = (source x, source z, source y). Verify the part under
            // that same basis, exactly as a formation instance sees it.
            var basis = new GameObject("Unity basis");
            basis.transform.localRotation = Quaternion.Euler(0f, 180f, 0f);
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(model, basis.transform);
            var renderers = instance.GetComponentsInChildren<MeshRenderer>();
            Require(renderers.Length > 0, $"{label}: part has no renderers");
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
            // Renderer.bounds transforms local AABBs, which can be conservative
            // for curved parts — the same 0.12 m readback tolerance as rolling.
            Near(bounds.min, Basis(asset.min), $"{label} minimum bounds", 0.12f);
            Near(bounds.max, Basis(asset.max), $"{label} maximum bounds", 0.12f);
            int triangles = instance.GetComponentsInChildren<MeshFilter>()
                .Sum(filter => filter.sharedMesh.triangles.Length / 3);
            Require(triangles == asset.triangles, $"{label}: expected {asset.triangles} triangles, got {triangles}");
            var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
            var materialNames = importedMaterials.Select(material => material.name)
                .OrderBy(name => name, StringComparer.Ordinal).ToArray();
            var expectedNames = asset.materials.OrderBy(name => name, StringComparer.Ordinal).ToArray();
            Require(materialNames.SequenceEqual(expectedNames),
                $"{label}: unexpected materials {string.Join(", ", materialNames)}");
            if (asset.materials.Contains("glass"))
            {
                var glass = importedMaterials.Single(material => material.name == "glass");
                Require(glass.renderQueue >= (int)RenderQueue.Transparent, $"{label}: glass lost its transparent queue");
            }
            if (asset.materials.Contains("lineLivery"))
                Require(importedMaterials.Single(material => material.name == "lineLivery").renderQueue <
                        (int)RenderQueue.Transparent, $"{label}: livery must stay opaque");
            foreach (var material in importedMaterials)
                if (asset.alphaMaterials.Contains(material.name))
                    Require(material.renderQueue >= (int)RenderQueue.Transparent,
                        $"{label}: {material.name} lost its transparent queue");
            var textures = importedMaterials.SelectMany(material =>
                    material.GetTexturePropertyNames().Select(material.GetTexture))
                .Where(texture => texture != null).Distinct().ToArray();
            Require(textures.Length == asset.textures,
                $"{label}: expected {asset.textures} embedded textures, got {textures.Length}");

            // Door articulation is two clips on independent leaves; every pose
            // is the TypeScript setDoorsSides sample.
            if (asset.doors != null && asset.doors.Length > 0)
            {
                var leaves = instance.GetComponentsInChildren<Transform>()
                    .Where(node => node.name.StartsWith(asset.doorPrefix, StringComparison.Ordinal))
                    .ToDictionary(node => node.name);
                Require(leaves.Count == asset.doors.Length,
                    $"{label}: expected {asset.doors.Length} leaves, got {leaves.Count}");
                Require(asset.doors.Count(door => door.side == 1) == asset.doors.Count(door => door.side == -1),
                    $"{label}: door banks differ");
                void Check(int sample)
                {
                    foreach (var door in asset.doors)
                        Near(leaves[door.name].position, Basis(door.samples[sample].position),
                            $"{label} {door.name}, sample {sample}", 0.002f);
                }
                Check(0);
                foreach (var (name, sample) in new[] { ("OpenPlus", 1), ("OpenMinus", 3) })
                {
                    var clip = clips[name];
                    clip.SampleAnimation(instance, 0.18f);
                    Check(sample);
                    clip.SampleAnimation(instance, 1f);
                    Check(sample + 1);
                    clip.SampleAnimation(instance, 0f);
                    Check(0);
                }
            }

            // The roof option: a downward probe on the centre line must land on
            // the well floor (2.85) or the plain crown (3.15/3.25).
            if (asset.kind == "roof-plain" || asset.kind == "roof-well")
            {
                foreach (var filter in instance.GetComponentsInChildren<MeshFilter>())
                {
                    var collider = filter.gameObject.AddComponent<MeshCollider>();
                    collider.sharedMesh = filter.sharedMesh;
                }
                Physics.SyncTransforms();
                Require(Physics.Raycast(new Vector3(0f, 10f, 0f), Vector3.down, out var hit, 30f),
                    $"{label}: no roof surface on the centre line");
                Near(hit.point.y, asset.centreTopZ, $"{label} centre-line roof height", 0.01f);
                Require(asset.well == (asset.kind == "roof-well"), $"{label}: well flag/kind mismatch");
            }
            // The collector's carbon contact and its mount transforms.
            if (asset.kind == "pantograph")
            {
                var contact = renderers.Where(renderer => renderer.name.StartsWith("pantograph-contact-strip", StringComparison.Ordinal)).ToArray();
                Require(contact.Length == 2, $"{label}: expected two contact strips, got {contact.Length}");
                float contactTop = contact.Max(renderer => renderer.bounds.max.y);
                Near(contactTop, asset.contactZ, $"{label} contact height", 0.01f);
                var transforms = instance.GetComponentsInChildren<Transform>();
                Require(transforms.Any(node => node.name == "pantograph-base-axle"), $"{label}: no base axle");
                Require(transforms.Any(node => node.name == "pantograph-elbow-pivot"), $"{label}: no elbow pivot");
                Near(asset.mountZ, 2.85f, $"{label} mount height", 0.001f);
            }

            var sourceBounds = new Bounds();
            sourceBounds.SetMinMax(
                new Vector3(asset.min[0], asset.min[1], asset.min[2]),
                new Vector3(asset.max[0], asset.max[1], asset.max[2]));
            var info = new PartInfo
            {
                asset = asset,
                modelPath = modelPath,
                model = model,
                clips = clips,
                bounds = sourceBounds,
            };
            UnityEngine.Object.DestroyImmediate(basis);
            Debug.Log($"FORMATIONS_PART {asset.id} {asset.kind} {digest.Substring(0, 12)} {asset.triangles}t " +
                      $"bounds=({bounds.size.x:F2},{bounds.size.y:F2},{bounds.size.z:F2}) " +
                      $"materials={asset.materials.Length} textures={textures.Length} leaves={asset.doors?.Length ?? 0}");
            return info;
        }

        /* ------------------------------------------------------ cell matrix */

        private static void VerifyCell(Cell cell, Dictionary<string, PartInfo> parts)
        {
            Require(cell.status == "PASS", $"{cell.id}: exporter marked the cell {cell.status}");
            Require(cell.power == "third-rail" || cell.power == "catenary", $"{cell.id}: power {cell.power}");
            Require(Mathf.Abs(cell.length - cell.carLength * cell.cars) < 0.001f,
                $"{cell.id}: length {cell.length} != {cell.carLength} × {cell.cars}");
            Require(Mathf.Abs(cell.bodyHalf * 2f + cell.gap - cell.carLength) < 0.001f,
                $"{cell.id}: body length + gangway gap != stock length");
            Require(cell.plan.Length == cell.cars, $"{cell.id}: {cell.plan.Length} cars in plan, expected {cell.cars}");
            Require(cell.doorCentres.Length == cell.doorWidths.Length, $"{cell.id}: door arrays differ");

            var build = BuildFormation(cell, parts, 1f, 1, false, "Cell " + cell.id);
            try
            {
                // Car placement.
                foreach (var plan in cell.plan)
                {
                    Require(build.cars.ContainsKey(plan.index), $"{cell.id}: no car {plan.index}");
                    var car = build.cars[plan.index];
                    Near(car.transform.localPosition, new Vector3(-plan.centre, 0f, 0f),
                        $"{cell.id} car {plan.index} position");
                    Require(Quaternion.Angle(car.transform.localRotation, Quaternion.Euler(0f, plan.rotation, 0f)) < 0.01f,
                        $"{cell.id} car {plan.index} rotation");
                    Near(car.transform.localScale, Vector3.one, $"{cell.id} car {plan.index} scale");
                    var part = parts[plan.part];
                    Require(car.name.StartsWith($"Car{plan.index}-", StringComparison.Ordinal),
                        $"{cell.id}: car {plan.index} name {car.name}");
                    Require(part.asset.stock == cell.stock, $"{cell.id}: car {plan.index} wrong stock");
                    // Power-specific roof option: a well on a powered cell car,
                    // a plain cap elsewhere.
                    Require(build.modules.ContainsKey(plan.index), $"{cell.id}: car {plan.index} has no roof module");
                    string moduleId = $"Train{cell.stock}Roof{(plan.module == "well" ? "Well" : "Plain")}";
                    var module = build.modules[plan.index];
                    Near(module.transform.localPosition, new Vector3(-plan.gapX, 0f, 0f),
                        $"{cell.id} car {plan.index} roof module position");
                    float crown = plan.module == "well" ? 2.85f : (cell.stock == "D" ? 3.25f : 3.15f);
                    Near(parts[moduleId].asset.centreTopZ, crown,
                        $"{cell.id} car {plan.index} roof option height", 0.01f);
                }

                // Overall length and the body/gangway gap, from the verified
                // part bounds and the plan transforms.
                float min = float.PositiveInfinity, max = float.NegativeInfinity;
                foreach (var plan in cell.plan)
                {
                    var bounds = parts[plan.part].bounds;
                    float localMin = plan.rotation == 180 ? -bounds.max.x : bounds.min.x;
                    float localMax = plan.rotation == 180 ? -bounds.min.x : bounds.max.x;
                    min = Mathf.Min(min, plan.centre + localMin);
                    max = Mathf.Max(max, plan.centre + localMax);
                    Require(Mathf.Abs(localMin + cell.bodyHalf) < 0.02f || Mathf.Abs(localMax - cell.bodyHalf) < 0.02f,
                        $"{cell.id}: car {plan.index} has no body face at the car envelope");
                }
                Near(max - min, cell.overall, $"{cell.id} overall length", 0.02f);
                for (int i = 1; i < cell.plan.Length; i++)
                {
                    Near(cell.plan[i].centre - cell.plan[i - 1].centre, cell.carLength,
                        $"{cell.id} car {i} spacing");
                    float jointLeft = cell.plan[i].centre - cell.bodyHalf;
                    float jointRight = cell.plan[i - 1].centre + cell.bodyHalf;
                    Near(jointLeft - jointRight, cell.gap, $"{cell.id} gangway gap at joint {i}", 0.001f);
                }

                // Door centres and widths against the exported oracle, then the
                // selected bank's motion with the other bank shut.
                foreach (var plan in cell.plan)
                {
                    var part = parts[plan.part];
                    var expected = Enumerable.Range(0, cell.doorCentres.Length)
                        .Where(index => Mathf.Abs(cell.doorCentres[index] - plan.centre) < cell.carLength / 2f)
                        .Select(index => new { x = cell.doorCentres[index], width = cell.doorWidths[index] })
                        .OrderBy(door => door.x).ToArray();
                    var actual = part.asset.doorways
                        .Select(door => new
                        {
                            x = plan.centre + (plan.rotation == 180 ? -door.centre : door.centre),
                            width = door.width,
                        })
                        .OrderBy(door => door.x).ToArray();
                    Require(actual.Length == expected.Length,
                        $"{cell.id} car {plan.index}: {actual.Length} doorways, expected {expected.Length}");
                    for (int i = 0; i < actual.Length; i++)
                    {
                        Require(Mathf.Abs(actual[i].x - expected[i].x) <= DoorTolerance,
                            $"{cell.id} car {plan.index} doorway {i}: {actual[i].x:F3} != {expected[i].x:F3}");
                        Require(Mathf.Abs(actual[i].width - expected[i].width) < 0.001f,
                            $"{cell.id} car {plan.index} doorway {i}: width {actual[i].width} != {expected[i].width}");
                    }
                    CheckDoorBank(build.cars[plan.index], build.models[plan.index], part, "OpenPlus", 1);
                    CheckDoorBank(build.cars[plan.index], build.models[plan.index], part, "OpenMinus", -1);
                }

                // Pantographs: index, mount, elbow direction, well and contact.
                var panTransforms = build.consist.GetComponentsInChildren<Transform>()
                    .Where(node => node.name.StartsWith("Pan", StringComparison.Ordinal)).ToArray();
                Require(panTransforms.Length == cell.pantographs.Length,
                    $"{cell.id}: {panTransforms.Length} pantographs, expected {cell.pantographs.Length}");
                foreach (var expected in cell.pantographs)
                {
                    Require(build.pans.ContainsKey(expected.car), $"{cell.id}: no pantograph on car {expected.car}");
                    var pan = build.pans[expected.car];
                    Near(pan.transform.localPosition, new Vector3(-expected.x, 0f, 0f),
                        $"{cell.id} car {expected.car} pantograph mount");
                    var transforms = pan.GetComponentsInChildren<Transform>();
                    var axle = transforms.Single(node => node.name == "pantograph-base-axle");
                    var elbow = transforms.Single(node => node.name == "pantograph-elbow-pivot");
                    // Final world is the source frame; the elbow sign reads
                    // directly against the TypeScript layout.
                    int direction = (int)Mathf.Sign(elbow.position.x - axle.position.x);
                    Require(direction == expected.direction,
                        $"{cell.id} car {expected.car}: elbow {direction} != {expected.direction}");
                    var strip = transforms.First(node => node.name == "pantograph-contact-strip");
                    float contactTop = strip.GetComponent<Renderer>().bounds.max.y;
                    Near(contactTop, parts["TrainPantograph"].asset.contactZ,
                        $"{cell.id} car {expected.car} contact height", 0.01f);
                    Require(build.modules.ContainsKey(expected.car), $"{cell.id}: no roof module on car {expected.car}");
                    var module = build.modules[expected.car];
                    Near(module.transform.localPosition, new Vector3(-cell.plan[expected.car].gapX, 0f, 0f),
                        $"{cell.id} car {expected.car} well position");
                    var modulePart = parts[cell.plan[expected.car].module == "well"
                        ? $"Train{cell.stock}RoofWell" : $"Train{cell.stock}RoofPlain"];
                    Near(modulePart.asset.centreTopZ, 2.85f, $"{cell.id} car {expected.car} well floor", 0.01f);
                }
                if (cell.power == "third-rail")
                {
                    Require(panTransforms.Length == 0, $"{cell.id}: third-rail formation carries a pantograph");
                    foreach (var plan in cell.plan)
                        Require(plan.module == "plain", $"{cell.id}: third-rail car {plan.index} is not plain-capped");
                }

                // Four basis anchors.
                CheckAnchors(build, cell.anchors);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(build.root);
            }
        }

        private static void CheckDoorBank(GameObject wrapper, GameObject model, PartInfo part,
            string clipName, int side)
        {
            var clip = part.clips[clipName];
            var leaves = model.GetComponentsInChildren<Transform>()
                .Where(node => node.name.StartsWith(part.asset.doorPrefix, StringComparison.Ordinal))
                .ToDictionary(node => node.name);
            foreach (var door in part.asset.doors)
            {
                // Sample 2 is the +y bank open; sample 4 is the -y bank open.
                // The other bank stays at sample 0 in both clips.
                int sample = door.side == side ? (side == 1 ? 2 : 4) : 0;
                clip.SampleAnimation(model, 1f);
                // The car wrapper sits on the model's glTFast conversion, so its
                // inverse transform is the mirror M(v)=(-x,z,-y); map the source
                // sample through the same mirror.
                Near(wrapper.transform.InverseTransformPoint(leaves[door.name].position),
                    MirrorBasis(door.samples[sample].position),
                    $"{part.asset.id} {door.name} {clipName} open", 0.002f);
                clip.SampleAnimation(model, 0f);
            }
        }

        private static void VerifyReversal(Cell cell, Dictionary<string, PartInfo> parts)
        {
            if (cell.cars < 2) return;
            var reverse = ReversePlan(cell, parts);
            Near(reverse.plan[0].centre, cell.plan[0].centre, $"{cell.id} reverse car 0");
            Near(reverse.plan[cell.cars - 1].centre, cell.plan[cell.cars - 1].centre, $"{cell.id} reverse last car");
            Require(reverse.plan[0].role != cell.plan[0].role, $"{cell.id}: the leading cab did not swap");
            for (int i = 0; i < cell.plan.Length; i++)
            {
                var forward = cell.plan[i];
                var backward = reverse.plan[i];
                Near(backward.gapX, forward.gapX, $"{cell.id} car {i} mount moved on reversal");
                Require(Mathf.Abs(backward.panX - forward.panX) < 0.001f, $"{cell.id} car {i} pantograph moved on reversal");
                Require(backward.panDirection == forward.panDirection, $"{cell.id} car {i} elbow changed on reversal");
            }
        }

        private static Cell ReversePlan(Cell cell, Dictionary<string, PartInfo> parts)
        {
            var reverse = new Cell
            {
                id = cell.id + "-reverse", stock = cell.stock, power = cell.power, cars = cell.cars, status = "PASS",
                carLength = cell.carLength, bodyHalf = cell.bodyHalf, gap = cell.gap, length = cell.length,
                overall = cell.overall, carCentres = cell.carCentres, doorCentres = cell.doorCentres,
                doorWidths = cell.doorWidths, pantographs = cell.pantographs, anchors = cell.anchors,
                doorMaxDelta = cell.doorMaxDelta,
                plan = cell.plan.Select(plan => new CarPlan
                {
                    index = plan.index, centre = plan.centre, role = plan.role, part = plan.part,
                    rotation = plan.rotation, gapX = plan.gapX, module = plan.module,
                    panDirection = plan.panDirection, panX = plan.panX,
                }).ToArray(),
            };
            for (int i = 0; i < reverse.plan.Length; i++)
            {
                var plan = reverse.plan[i];
                if (i != 0 && i != reverse.plan.Length - 1) continue;
                var part = parts[plan.part].asset;
                var other = part.lamp == "head" ? $"Train{cell.stock}CabTrail" : $"Train{cell.stock}CabLead";
                var swapped = parts[other].asset;
                plan.part = swapped.id;
                plan.role = swapped.lamp == "head" ? "lead" : "trail";
                plan.rotation = 180;
                plan.gapX = plan.centre + (plan.rotation == 180 ? -swapped.gap.localX : swapped.gap.localX);
            }
            return reverse;
        }

        private static void VerifyReverseBuild(Cell cell, Dictionary<string, PartInfo> parts)
        {
            var forward = BuildFormation(cell, parts, 1f, 1, false, "Zoo forward");
            var reverse = BuildFormation(cell, parts, 1f, -1, false, "Zoo reverse");
            try
            {
                foreach (var plan in cell.plan)
                {
                    var a = forward.cars[plan.index];
                    var b = reverse.cars[plan.index];
                    Near(a.transform.localPosition, b.transform.localPosition,
                        $"Zoo car {plan.index}: mount moved on travel reversal");
                    Near(forward.modules[plan.index].transform.localPosition,
                        reverse.modules[plan.index].transform.localPosition,
                        $"Zoo car {plan.index}: roof module moved on travel reversal");
                    if (plan.panDirection != 0)
                        Near(forward.pans[plan.index].transform.localPosition,
                            reverse.pans[plan.index].transform.localPosition,
                            $"Zoo car {plan.index}: pantograph moved on travel reversal");
                }
                Require(reverse.cell.plan[0].role == "lead" && forward.cell.plan[0].role == "trail",
                    "Zoo reversal did not swap the leading cab");
                Require(cell.pantographs.Length == 0, "Zoo L third-rail consist must have no pantograph");
                CheckLamps(forward, 1);
                CheckLamps(reverse, -1);
                Debug.Log("FORMATIONS_REVERSAL PASS zoo L-6 mountPositions=stable leadingCab=swapped lamps=head@-x/tail@+x");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(forward.root);
                UnityEngine.Object.DestroyImmediate(reverse.root);
            }
        }

        private static void CheckAnchors(Built build, Anchors anchors)
        {
            var names = new[] { "AxisX", "Front", "Up", "Approach" };
            var values = new[] { anchors.AxisX, anchors.Front, anchors.Up, anchors.Approach };
            for (int i = 0; i < names.Length; i++)
            {
                var anchor = build.root.GetComponentsInChildren<Transform>()
                    .Single(node => node.name == names[i]);
                var local = Basis(values[i]);
                build.root.transform.rotation = Quaternion.identity;
                Near(anchor.position, local, $"{build.cell.id} {names[i]}");
                for (int facing = 1; facing < 4; facing++)
                {
                    var rotation = Quaternion.Euler(0f, facing * 90f, 0f);
                    build.root.transform.rotation = rotation;
                    Near(anchor.position, rotation * local,
                        $"{build.cell.id} {names[i]} facing {facing}");
                }
                build.root.transform.rotation = Quaternion.identity;
            }
        }

        /* -------------------------------------------------------- formation */

        private static Built BuildFormation(Cell cell, Dictionary<string, PartInfo> parts,
            float scale, int dirSign, bool openNearBank, string name)
        {
            var plan = dirSign >= 0 ? cell : ReversePlan(cell, parts);
            var root = new GameObject(name);
            var basis = new GameObject("Unity basis");
            basis.transform.SetParent(root.transform, false);
            basis.transform.localRotation = Quaternion.Euler(0f, 180f, 0f);
            var consist = new GameObject("Consist");
            consist.transform.SetParent(basis.transform, false);
            consist.transform.localScale = Vector3.one * scale;
            var build = new Built { root = root, basis = basis, consist = consist, cell = plan };
            foreach (var car in plan.plan)
            {
                var part = parts[car.part];
                // The imported model keeps its own conversion/root rotation; the
                // plan's car position and 180-degree role rotation live on a
                // wrapper so neither overwrites the other.
                // glTFast mirrors X when it converts the glTF handedness; the
                // Consist frame is therefore source-mirrored, and the final
                // world (Consist under the 180-degree Unity basis) lands back on
                // source x. All assembly positions are negated in this frame.
                var carRoot = new GameObject($"Car{car.index}-{car.part}");
                carRoot.transform.SetParent(consist.transform, false);
                carRoot.transform.localPosition = new Vector3(-car.centre, 0f, 0f);
                carRoot.transform.localRotation = Quaternion.Euler(0f, car.rotation, 0f);
                build.cars[car.index] = carRoot;
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(part.model, carRoot.transform);
                build.models[car.index] = instance;

                string moduleId = $"Train{cell.stock}Roof{(car.module == "well" ? "Well" : "Plain")}";
                var moduleRoot = new GameObject($"Roof{car.index}-{car.module}");
                moduleRoot.transform.SetParent(consist.transform, false);
                moduleRoot.transform.localPosition = new Vector3(-car.gapX, 0f, 0f);
                moduleRoot.transform.localRotation = Quaternion.identity;
                build.modules[car.index] = moduleRoot;
                PrefabUtility.InstantiatePrefab(parts[moduleId].model, moduleRoot.transform);

                if (car.panDirection != 0)
                {
                    var panRoot = new GameObject($"Pan{car.index}");
                    panRoot.transform.SetParent(consist.transform, false);
                    panRoot.transform.localPosition = new Vector3(-car.panX, 0f, 0f);
                    panRoot.transform.localRotation = Quaternion.Euler(0f, car.panDirection < 0 ? 180f : 0f, 0f);
                    build.pans[car.index] = panRoot;
                    PrefabUtility.InstantiatePrefab(parts["TrainPantograph"].model, panRoot.transform);
                }

                if (openNearBank && (part.asset.kind == "cab" || part.asset.kind == "mid"))
                {
                    // The camera and platform are on world +z, which is the
                    // source +y bank. A car part rotated 180 about Y swaps its
                    // local banks, so the near clip flips with the rotation.
                    string clipName = car.rotation == 180 ? "OpenMinus" : "OpenPlus";
                    part.clips[clipName].SampleAnimation(instance, 1f);
                    foreach (var leaf in instance.GetComponentsInChildren<Transform>()
                                 .Where(node => node.name.StartsWith(part.asset.doorPrefix, StringComparison.Ordinal)))
                        PrefabUtility.RecordPrefabInstancePropertyModifications(leaf);
                }
            }
            for (int i = 1; i < plan.plan.Length; i++)
            {
                float joint = (plan.plan[i - 1].centre + plan.plan[i].centre) / 2f;
                var gangwayRoot = new GameObject($"Gangway{i}");
                gangwayRoot.transform.SetParent(consist.transform, false);
                gangwayRoot.transform.localPosition = new Vector3(-joint, 0f, 0f);
                gangwayRoot.transform.localRotation = Quaternion.identity;
                PrefabUtility.InstantiatePrefab(parts[$"Train{cell.stock}Gangway"].model, gangwayRoot.transform);
                build.gangways.Add(gangwayRoot);
            }
            // The platform-edge reference points are the game's own door
            // centres, on the near bank (source -y maps to world +z through the
            // Unity basis). The platform markers reuse this list.
            for (int i = 0; i < plan.doorCentres.Length; i++)
            {
                var doorCentre = new GameObject($"DoorCentre-{i}");
                doorCentre.transform.SetParent(consist.transform, false);
                // Consist is source-mirrored; the Unity basis flips x and z back,
                // so this lands on final world (source x, up, +near bank).
                doorCentre.transform.localPosition = new Vector3(
                    -plan.doorCentres[i], 0f, -StockWidth(plan.stock) / 2f);
            }
            // The four basis anchors live on the formation root in the gameplay
            // frame (source x, source z up, source y lateral), exactly as the
            // other recipes hang them.
            AddAnchor(root.transform, "AxisX", cell.anchors.AxisX);
            AddAnchor(root.transform, "Front", cell.anchors.Front);
            AddAnchor(root.transform, "Up", cell.anchors.Up);
            AddAnchor(root.transform, "Approach", cell.anchors.Approach);
            return build;
        }

        private static void AddAnchor(Transform root, string name, float[] position)
        {
            var anchor = new GameObject(name);
            anchor.transform.SetParent(root, false);
            anchor.transform.localPosition = Basis(position);
        }

        private static void CheckLamps(Built build, int dirSign)
        {
            // The leading cab burns white at the travel end; the trailing cab
            // burns red. A reversal swaps which end wears which part and never
            // moves a mount.
            int last = build.cell.cars - 1;
            int leading = dirSign >= 0 ? last : 0;
            int trailing = dirSign >= 0 ? 0 : last;
            Require(build.cell.plan[leading].role == "lead", $"{build.root.name}: leading cab is not the head part");
            Require(build.cell.plan[trailing].role == "trail", $"{build.root.name}: trailing cab is not the tail part");
            foreach (var plan in build.cell.plan)
            {
                if (plan.role != "lead" && plan.role != "trail") continue;
                var part = build.cars[plan.index].GetComponentsInChildren<MeshRenderer>()
                    .SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
                bool head = part.Any(material => material.name == "headlight");
                bool tail = part.Any(material => material.name == "taillight");
                if (plan.role == "lead") Require(head && !tail, $"{build.root.name}: leading cab lost its head lamps");
                else Require(tail && !head, $"{build.root.name}: trailing cab lost its tail lamps");
            }
        }

        /* ------------------------------------------------------------- scene */

        /// <summary>
        /// Verify a formation prefab kept from an earlier import. The nested
        /// instance fileIDs are not stable across saves, so the second proof
        /// pass must not overwrite it; this catches a stale or partial prefab.
        /// </summary>
        private static (int triangles, Bounds bounds) VerifyCachedFormation(
            FormationSpec spec, Cell cell, string prefabPath)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            Require(prefab != null, $"{spec.prefab}: cached prefab did not load");
            var basis = prefab.transform.Find("Unity basis");
            Require(basis != null, $"{spec.prefab}: cached prefab has no Unity basis");
            var consist = basis.GetChild(0);
            var transforms = consist.GetComponentsInChildren<Transform>();
            int cars = transforms.Count(node => node.name.StartsWith("Car", StringComparison.Ordinal));
            Require(cars == spec.cars, $"{spec.prefab}: cached prefab has {cars} cars, expected {spec.cars}");
            int modules = transforms.Count(node => node.name.StartsWith("Roof", StringComparison.Ordinal));
            Require(modules == spec.cars, $"{spec.prefab}: cached prefab has {modules} roof modules, expected {spec.cars}");
            int pans = transforms.Count(node => node.name.StartsWith("Pan", StringComparison.Ordinal));
            Require(pans == cell.pantographs.Length,
                $"{spec.prefab}: cached prefab has {pans} pantographs, expected {cell.pantographs.Length}");
            var rootTransforms = prefab.GetComponentsInChildren<Transform>();
            foreach (var anchor in new[] { "AxisX", "Front", "Up", "Approach" })
                Require(rootTransforms.Any(node => node.name == anchor),
                    $"{spec.prefab}: cached prefab lost {anchor}");
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            instance.transform.position = Vector3.zero;
            instance.transform.rotation = Quaternion.identity;
            var renderers = instance.GetComponentsInChildren<MeshRenderer>();
            Require(renderers.Length > 0, $"{spec.prefab}: cached prefab has no renderers");
            var bounds = renderers[0].bounds;
            foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
            int triangles = instance.GetComponentsInChildren<MeshFilter>()
                .Sum(filter => filter.sharedMesh.triangles.Length / 3);
            UnityEngine.Object.DestroyImmediate(instance);
            return (triangles, bounds);
        }

        /// <summary>
        /// Ten short consists in a 2 × 5 grid, both columns either side of the
        /// central gap that frames the long A 8-car and Zoo L 6-car consists.
        /// </summary>
        private static Vector3 ShortPosition(int index) => new Vector3(
            index % 2 == 0 ? -FormationColumnX : FormationColumnX,
            0f,
            (index / 2) * FormationPitch);

        private static float LongZ(FormationSpec spec) => spec.zoo ? ZooTrackZ : LongTrackZ;

        private static void BuildReviewScene(Manifest manifest, Dictionary<string, PartInfo> parts)
        {
            var shortSpecs = manifest.formations.Where(spec => !spec.zoo && spec.cars < 8).ToArray();
            for (int i = 0; i < shortSpecs.Length; i++)
            {
                var spec = shortSpecs[i];
                var cell = manifest.cells.Single(entry => entry.id == spec.id);
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>($"{Folder}/{spec.prefab}.prefab");
                Require(prefab != null, $"Missing prefab for {spec.prefab}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                var position = ShortPosition(i);
                instance.transform.position = position;
                instance.transform.rotation = Quaternion.identity;
                AddPlatformEdge(spec, cell, position.z, position.x, parts);
            }
            foreach (var spec in manifest.formations.Where(spec => spec.zoo || spec.cars >= 8))
            {
                var cell = manifest.cells.Single(entry => entry.id == spec.id);
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>($"{Folder}/{spec.prefab}.prefab");
                Require(prefab != null, $"Missing prefab for {spec.prefab}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                float z = LongZ(spec);
                instance.transform.position = new Vector3(0f, 0f, z);
                instance.transform.rotation = Quaternion.identity;
                AddPlatformEdge(spec, cell, z, 0f, parts);
            }

            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = CameraSize;
            camera.transform.position = CameraPosition;
            camera.transform.LookAt(CameraTarget);
            camera.nearClipPlane = 0.5f;
            camera.farClipPlane = 1000f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Slate;

            var key = new GameObject("Key light").AddComponent<Light>();
            key.type = LightType.Directional;
            key.intensity = 2.6f;
            key.transform.rotation = Quaternion.Euler(40f, -35f, 0f);
            var fill = new GameObject("Fill light").AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.intensity = 1.15f;
            fill.transform.rotation = Quaternion.Euler(18f, 148f, 0f);
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.55f;
            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene),
                "Could not save the formations review scene");
        }

        private static void AddPlatformEdge(FormationSpec spec, Cell cell, float rowZ, float formationX,
            Dictionary<string, PartInfo> parts)
        {
            float width = StockWidth(spec.stock);
            float scale = spec.modelScale;
            float edgeZ = rowZ + width / 2f * scale + 0.16f;
            float length = cell.length * scale + 8f;
            // The lip and the door markers wear the car's own body aluminium, so
            // the platform-edge reference is readable in the Web frame without
            // adding a material asset that promotion would not carry.
            var bodyMaterial = parts[$"Train{spec.stock}RoofPlain"].model
                .GetComponentsInChildren<MeshRenderer>().First().sharedMaterial;
            var edge = new GameObject($"PlatformEdge-{spec.prefab}");
            edge.transform.position = new Vector3(formationX, 0f, 0f);
            var slab = GameObject.CreatePrimitive(PrimitiveType.Cube);
            slab.name = "PlatformSlab";
            slab.transform.SetParent(edge.transform, false);
            slab.transform.localScale = new Vector3(length, 0.12f, 1.25f);
            slab.transform.localPosition = new Vector3(0f, 0.06f, edgeZ + 0.625f);
            var lip = GameObject.CreatePrimitive(PrimitiveType.Cube);
            lip.name = "PlatformEdgeLip";
            lip.transform.SetParent(edge.transform, false);
            lip.transform.localScale = new Vector3(length, 0.18f, 0.08f);
            lip.transform.localPosition = new Vector3(0f, 0.09f, edgeZ);
            lip.GetComponent<MeshRenderer>().sharedMaterial = bodyMaterial;
            for (int i = 0; i < cell.doorCentres.Length; i++)
            {
                var marker = GameObject.CreatePrimitive(PrimitiveType.Cube);
                marker.name = $"DoorMarker-{i}";
                marker.transform.SetParent(edge.transform, false);
                marker.transform.localScale = new Vector3(0.14f, 0.03f, 0.36f);
                marker.transform.localPosition = new Vector3(cell.doorCentres[i] * scale, 0.14f, edgeZ);
                marker.GetComponent<MeshRenderer>().sharedMaterial = bodyMaterial;
            }
        }

        private static float StockWidth(string stock)
        {
            switch (stock)
            {
                case "A": return 3.0f;
                case "B": return 2.8f;
                case "C": return 2.6f;
                case "L": return 2.8f;
                case "D": return 3.3f;
                default: throw new InvalidOperationException($"Unknown stock {stock}");
            }
        }

        private static void VerifyReviewScene(Manifest manifest, Dictionary<string, PartInfo> parts)
        {
            var scene = EditorSceneManager.OpenScene(Scene, OpenSceneMode.Single);
            Require(scene.IsValid() && scene.path == Scene, "Review scene did not open from " + Scene);
            var roots = scene.GetRootGameObjects();
            int checkedFormations = 0;
            foreach (var spec in manifest.formations)
            {
                var instance = roots.SingleOrDefault(root => root.name == spec.prefab);
                Require(instance != null, $"Review scene is missing {spec.prefab}");
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instance);
                Require(source != null && AssetDatabase.GetAssetPath(source) == $"{Folder}/{spec.prefab}.prefab",
                    $"{spec.prefab} is not an instance of its prefab");
                Require(instance.GetComponentsInChildren<MeshRenderer>().Length > 0, $"{spec.prefab}: no renderers");
                var edge = roots.SelectMany(root => root.GetComponentsInChildren<Transform>())
                    .SingleOrDefault(transform => transform.name == $"PlatformEdge-{spec.prefab}");
                Require(edge != null, $"{spec.prefab}: no platform edge");
                var markers = edge.GetComponentsInChildren<Transform>()
                    .Where(transform => transform.name.StartsWith("DoorMarker-", StringComparison.Ordinal)).ToArray();
                var cell = manifest.cells.Single(entry => entry.id == spec.id);
                Require(markers.Length == cell.doorCentres.Length,
                    $"{spec.prefab}: {markers.Length} door markers, expected {cell.doorCentres.Length}");
                var markerByName = markers.ToDictionary(marker => marker.name);
                // The platform markers sit on the same consist-local door
                // centres as the car doors (the game's doorCentres list is the
                // one platform screens are cut from).
                var consist = instance.transform.Find("Unity basis").GetChild(0);
                var doorCentres = consist.GetComponentsInChildren<Transform>()
                    .Where(node => node.name.StartsWith("DoorCentre-", StringComparison.Ordinal))
                    .ToDictionary(node => node.name);
                Require(doorCentres.Count == cell.doorCentres.Length,
                    $"{spec.prefab}: {doorCentres.Count} door-centre references, expected {cell.doorCentres.Length}");
                for (int i = 0; i < markers.Length; i++)
                {
                    Require(doorCentres.ContainsKey($"DoorCentre-{i}"),
                        $"{spec.prefab}: missing DoorCentre-{i}");
                    Require(markerByName.ContainsKey($"DoorMarker-{i}"),
                        $"{spec.prefab}: missing DoorMarker-{i}");
                    Near(markerByName[$"DoorMarker-{i}"].position.x, doorCentres[$"DoorCentre-{i}"].position.x,
                        $"{spec.prefab}: platform marker {i} x");
                }
                // The prefab bakes the near bank open and the far bank shut.
                foreach (var plan in cell.plan)
                {
                    var part = parts[plan.part];
                    var car = consist.Find($"Car{plan.index}-{plan.part}");
                    Require(car != null, $"{spec.prefab}: missing car {plan.index}");
                    var leaves = car.GetComponentsInChildren<Transform>()
                        .Where(node => node.name.StartsWith(part.asset.doorPrefix, StringComparison.Ordinal))
                        .ToDictionary(node => node.name);
                    // The platform/camera side is source +y; a part rotated 180
                    // about Y presents its local -y bank there.
                    int nearSide = plan.rotation == 180 ? -1 : 1;
                    int openSample = nearSide == 1 ? 2 : 4;
                    foreach (var door in part.asset.doors)
                    {
                        int sample = door.side == nearSide ? openSample : 0;
                        Near(car.InverseTransformPoint(leaves[door.name].position),
                            MirrorBasis(door.samples[sample].position),
                            $"{spec.prefab} {door.name} scene door pose", 0.002f);
                    }
                }
                checkedFormations++;
            }
            var camera = roots.Select(root => root.GetComponent<Camera>()).FirstOrDefault(value => value != null);
            Require(camera != null, "Review scene has no camera");
            Require(camera.orthographic && Mathf.Abs(camera.orthographicSize - CameraSize) < 0.001f,
                "Review camera framing changed");
            Require(camera.clearFlags == CameraClearFlags.SolidColor, "Review camera does not clear to a solid colour");
            Require(Vector4.Distance((Vector4)camera.backgroundColor, (Vector4)Slate) < 0.002f,
                "Review camera background changed");
            int lights = roots.Sum(root => root.GetComponents<Light>().Count(light => light.type == LightType.Directional));
            Require(lights >= 2, "Review scene is missing its two directional lights");
            Debug.Log($"FORMATIONS_SCENE_OK {checkedFormations} formations " +
                      $"{manifest.cells.Single(cell => cell.id == "L-third-rail-6").doorCentres.Length} zoo door markers " +
                      $"camera=ortho{CameraSize:F0}");
        }

        /* ------------------------------------------------------------ helpers */

        private static Vector3 Basis(float[] v) => new Vector3(v[0], v[2], v[1]);

        /// <summary>The glTFast mirror inside a car wrapper: M(v) = (-x, z, -y).</summary>
        private static Vector3 MirrorBasis(float[] v) => new Vector3(-v[0], v[2], -v[1]);

        private static void Near(Vector3 actual, Vector3 expected, string field, float tolerance = 0.001f) =>
            Require(Vector3.Distance(actual, expected) < tolerance,
                $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Near(float actual, float expected, string field, float tolerance = 0.001f) =>
            Require(Mathf.Abs(actual - expected) < tolerance,
                $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException(reason);
        }
    }
}
