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
    /// Import the six 显示 (display) GLBs exported by export-display.mjs, wrap each in a
    /// prefab, verify bounds/materials/textures/queues/anchors, check the articulated
    /// clock hands, the shared 电视 pair housing and the printed departure board, and save
    /// one review scene with all six in a row.
    /// </summary>
    public static class ReviewDisplay
    {
        private const string Folder = "Assets/DisplayProof";
        private const string Scene = Folder + "/Display.unity";

        /// <summary>The review row: six pieces at 3.2 m spacing, hung ones left of the standing ones.</summary>
        private static readonly float[] RowX = { -8.0f, -4.8f, -1.6f, 1.6f, 4.8f, 8.0f };

        /// <summary>The ceiling a hung piece reaches in an empty station (`hangCeilingLocal`).</summary>
        private const float Ceiling = 4f;

        [Serializable]
        private class Manifest
        {
            public Asset[] assets;
            public Parameters parameters;
        }

        [Serializable]
        private class Parameters
        {
            public int models;
            public float ceilingHeightMetres;
            public float clockPoseSeconds;
            public ClockPose clockPose;
            public Pair pair;
            public Board departureBoard;
        }

        [Serializable]
        private class ClockPose
        {
            public float hourDegrees, minuteDegrees;
            public int faces, hands;
        }

        /// <summary>The back-to-back 电视 pair rule: two panels, one shared housing.</summary>
        [Serializable]
        private class Pair
        {
            public int modules;
            public int[] rotations;
            public float housingHalfDepthMetres;
            public float housingDepthMetres;
            public float soloHousingDepthMetres;
            public float slotDepthMetres;
            public float paneHalfDepthMetres;
            public float cellDepthMetres;
        }

        [Serializable]
        private class Board
        {
            public string material, texture;
            public int width, height;
            public bool sample;
        }

        [Serializable]
        private class Asset
        {
            public string id, paletteId, variant, file, prefab, sha256, facade;
            public float[] min, max, size, placementOffset;
            public string[] moduleIds;
            public int[] moduleRotations;
            public int triangles, meshes, textures;
            public string[] materials, alphaMaterials, glassMaterials, textureNames;
            public bool screen, pairMember, ceilingHung;
            public int hands;
            public Anchors anchors;
            public Housing housing;
            public Board departureBoard;
            public HandPose pose;
            public Pair pair;
        }

        [Serializable]
        private class Housing
        {
            public int posts;
            public float depthMetres;
            public float[] postSize;
        }

        [Serializable]
        private class HandPose
        {
            public float seconds, hourDegrees, minuteDegrees;
            public int hands;
            public string[] nodes;
        }

        [Serializable]
        private class Anchors { public float[] AxisX, Front, Up, Approach; }

        public static void Import()
        {
            string evidence = Environment.GetEnvironmentVariable("METRO_BENCH_PROOF");
            var manifest = JsonUtility.FromJson<Manifest>(
                File.ReadAllText(Path.Combine(evidence, "export", "manifest.json")));
            Require(manifest?.assets != null && manifest.assets.Length == 6, "Expected six display models in the manifest");
            Require(manifest.parameters.models == 6, "The manifest parameters do not describe six models");
            Require(manifest.parameters.ceilingHeightMetres == Ceiling, "Unexpected ceiling-height fallback");
            Require(manifest.parameters.clockPoseSeconds == 36540f, "Unexpected clock pose (expected 10:09)");
            Require(manifest.parameters.clockPose.hands == 4, "The clock pose should cover four hands (two faces)");
            Require(manifest.parameters.clockPose.faces == 2, "The analogue clock should have two faces");
            Require(Mathf.Abs(manifest.parameters.pair.housingDepthMetres - 0.2f) < 0.005f,
                "The pair housing should be two 0.10 m panels back to back");
            Require(Mathf.Abs(manifest.parameters.pair.slotDepthMetres - 0.1f) < 0.0001f, "Unexpected pair slot depth");
            Require(manifest.parameters.pair.modules == 2, "The pair should be two modules");
            Require(manifest.parameters.departureBoard.sample, "The departure board must be recorded as a sample board");
            Require(manifest.parameters.departureBoard.width == 960 && manifest.parameters.departureBoard.height == 540,
                "Unexpected departure-board size");

            Directory.CreateDirectory(Folder);
            var summary = new List<string>();
            var measured = new Dictionary<string, float>();
            foreach (var asset in manifest.assets)
            {
                string model = $"{Folder}/{asset.file}";
                byte[] bytes = File.ReadAllBytes(Path.Combine(evidence, "export", asset.file));
                string digest = BitConverter.ToString(SHA256.Create().ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
                Require(digest == asset.sha256, $"{asset.paletteId}: GLB digest differs from the validated manifest");
                if (!File.Exists(model) || !bytes.SequenceEqual(File.ReadAllBytes(model)))
                    File.WriteAllBytes(model, bytes);

                AssetDatabase.ImportAsset(model, ImportAssetOptions.ForceSynchronousImport);
                var imported = AssetDatabase.LoadAssetAtPath<GameObject>(model);
                Require(imported != null, $"{asset.paletteId}: glTFast did not produce a model");

                // Build the wrapper prefab in a clean scene: basis parent rotated
                // 180 degrees about Y, as in ReviewBin/ReviewBench/ReviewCctv.
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
                var root = new GameObject(Path.GetFileNameWithoutExtension(asset.prefab));
                var orientation = new GameObject("Unity basis").transform;
                orientation.SetParent(root.transform, false);
                PrefabUtility.InstantiatePrefab(imported, orientation);
                orientation.localRotation = Quaternion.Euler(0, 180, 0);

                CheckAnchor(root, "AxisX", Basis(asset.anchors.AxisX));
                CheckAnchor(root, "Front", Basis(asset.anchors.Front));
                CheckAnchor(root, "Up", Basis(asset.anchors.Up));
                CheckAnchor(root, "Approach", Basis(asset.anchors.Approach));

                var renderers = root.GetComponentsInChildren<MeshRenderer>();
                Require(renderers.Length > 0, $"{asset.paletteId}: imported model has no mesh renderers");
                var bounds = renderers[0].bounds;
                foreach (var renderer in renderers)
                    bounds.Encapsulate(renderer.bounds);
                Near(bounds.min, Basis(asset.min), $"{asset.paletteId} minimum bounds");
                Near(bounds.max, Basis(asset.max), $"{asset.paletteId} maximum bounds");
                // The hung pieces reach the storey ceiling; the standing ones the floor.
                Near(asset.ceilingHung ? bounds.max.y : bounds.min.y,
                    asset.ceilingHung ? Ceiling : 0f, $"{asset.paletteId} mount height");
                Require(Mathf.Abs(bounds.size.x - asset.size[0]) < 0.002f, $"{asset.paletteId}: width changed on import");

                int triangles = root.GetComponentsInChildren<MeshFilter>().Sum(filter => filter.sharedMesh.triangles.Length / 3);
                Require(triangles == asset.triangles,
                    $"{asset.paletteId}: expected {asset.triangles} triangles, got {triangles}");
                Require(root.GetComponentsInChildren<MeshFilter>().Length == asset.meshes,
                    $"{asset.paletteId}: expected {asset.meshes} meshes");

                var importedMaterials = renderers.SelectMany(renderer => renderer.sharedMaterials).Distinct().ToArray();
                var materials = importedMaterials.Select(material => material.name)
                    .OrderBy(name => name, StringComparer.Ordinal).ToArray();
                Require(materials.SequenceEqual(asset.materials),
                    $"{asset.paletteId}: unexpected materials {string.Join(", ", materials)}");

                // Alpha and glass queues: the vending machine's drink glass and its
                // transparent red fascia sort in the transparent queue, everything else
                // stays opaque.
                foreach (var material in importedMaterials)
                {
                    bool transparent = Array.IndexOf(asset.alphaMaterials, material.name) >= 0;
                    if (transparent)
                        Require(material.renderQueue >= (int)RenderQueue.Transparent,
                            $"{asset.paletteId}: {material.name} lost its transparent queue ({material.renderQueue})");
                    else
                        Require(material.renderQueue < (int)RenderQueue.Transparent,
                            $"{asset.paletteId}: {material.name} should be opaque ({material.renderQueue})");
                }
                foreach (var glassName in asset.glassMaterials)
                    Require(Array.IndexOf(asset.alphaMaterials, glassName) >= 0,
                        $"{asset.paletteId}: {glassName} is glass but not transparent");

                var textures = importedMaterials
                    .SelectMany(material => material.GetTexturePropertyNames().Select(material.GetTexture))
                    .Where(texture => texture != null).Distinct().ToArray();
                Require(textures.Length == asset.textures,
                    $"{asset.paletteId}: expected {asset.textures} textures, got {textures.Length}");

                var front = FindAnchor(root, "Front");
                var approach = FindAnchor(root, "Approach");
                for (int i = 0; i < 4; i++)
                {
                    var rotation = Quaternion.Euler(0, i * 90, 0);
                    root.transform.rotation = rotation;
                    Near(front.position, rotation * Vector3.forward, $"{asset.paletteId} front at facing {i}");
                    Near(approach.position, rotation * Vector3.back, $"{asset.paletteId} approach at facing {i}");
                }
                root.transform.rotation = Quaternion.identity;

                if (asset.hands > 0) CheckClockHands(root, asset);
                if (asset.screen) measured[asset.variant] = CheckTelevision(renderers, asset);
                if (asset.screen) CheckDepartureBoard(importedMaterials, asset);

                // The manifest names the prefab without its extension (the catalogue row
                // appends it); the asset path needs one.
                string prefabPath = $"{Folder}/{asset.prefab}.prefab";
                Require(PrefabUtility.SaveAsPrefabAsset(root, prefabPath) != null,
                    $"{asset.paletteId}: could not save wrapper prefab");
                UnityEngine.Object.DestroyImmediate(root);

                summary.Add($"{asset.variant}={triangles}t/{asset.materials.Length}m/{asset.textures}x");
            }

            // The pair is exactly two thin televisions back to back, and the housing it
            // shares is twice one lone 电视's body — a merged pair, not two bodies.
            float soloDepth = measured["single"];
            float pairDepth = measured["pair"];
            Require(Mathf.Abs(pairDepth - 2f * soloDepth) < 0.003f,
                $"the pair housing {pairDepth:F3} m is not two lone 电视 bodies ({soloDepth:F3} m each)");
            Require(pairDepth < 0.5f, $"the pair housing {pairDepth:F3} m is a box, not two thin panels");
            Require(Mathf.Abs(pairDepth - manifest.parameters.pair.housingDepthMetres) < 0.003f,
                "the pair housing depth differs from the exported manifest");
            Require(Mathf.Abs(soloDepth - manifest.parameters.pair.soloHousingDepthMetres) < 0.003f,
                "the lone 电视 housing depth differs from the exported manifest");

            // Unity assigns fresh scene fileIDs on every SaveScene call, so a
            // regenerated scene would never be byte-identical between two imports.
            // The scene is a pure view over the wrapper prefabs, which are rebuilt
            // deterministically above and referenced by GUID, so keep the first
            // generated scene and only create it when it is missing.
            if (!File.Exists(Scene))
                BuildReviewScene(manifest.assets);

            Debug.Log($"DISPLAY_IMPORT_OK {manifest.assets.Length} models {string.Join(" ", summary)} " +
                $"pairHousing={pairDepth:F3} soloHousing={soloDepth:F3} row={RowX[0]}..{RowX[RowX.Length - 1]}");
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

        /// <summary>
        /// The analogue clock's articulated hands: two pivots per face, named by the
        /// exporter, each carrying one arm. The pose is the builder's own 10:09, so the
        /// pivots must be turned by the manifest's angles (a quaternion angle folds
        /// 304.5 degrees to 55.5) and the hour and minute hands must differ.
        /// </summary>
        private static void CheckClockHands(GameObject root, Asset asset)
        {
            Require(asset.pose.nodes != null && asset.pose.nodes.Length == 4, "the clock should carry four named hands");
            var faces = new[] { FindNode(root, "clockFaceFront"), FindNode(root, "clockFaceBack") };
            Require(faces.All(face => face != null), "the clock lost a dial");
            float hour = 0f, minute = 0f;
            foreach (var name in asset.pose.nodes)
            {
                var hand = FindNode(root, name);
                Require(hand != null, $"the clock lost its {name} pivot");
                Require(hand.childCount == 1, $"{name} should carry exactly one arm (has {hand.childCount})");
                Require(hand.GetChild(0).GetComponent<MeshFilter>() != null, $"{name}'s arm is not a mesh");
                Require(faces.Any(face => hand.IsChildOf(face)), $"{name} is not on a dial");
                float angle = Quaternion.Angle(Quaternion.identity, hand.localRotation);
                Require(angle > 1f, $"{name} is unturned: the fixed 10:09 pose was not exported");
                bool isHour = name.StartsWith("clockHourHand");
                float expected = Folded(isHour ? asset.pose.hourDegrees : asset.pose.minuteDegrees);
                Require(Mathf.Abs(angle - expected) < 0.75f,
                    $"{name} is turned {angle:F3} degrees, expected {expected:F3}");
                if (isHour) hour = Mathf.Max(hour, angle);
                else minute = Mathf.Max(minute, angle);
            }
            Require(Mathf.Abs(hour - minute) > 0.5f,
                $"the hour and minute hands read the same angle ({hour:F3}) — the 10:09 pose is not exported");
        }

        /// <summary>
        /// The 电视 housing. Its bezel posts span the body, so their depth is the body, and
        /// each face carries one board and one content window. Returns the measured body
        /// depth so the pair can be compared with a lone screen.
        /// </summary>
        private static float CheckTelevision(MeshRenderer[] renderers, Asset asset)
        {
            Require(asset.hands == 0, $"{asset.paletteId}: a screen should carry no clock hands");
            // World axes after the wrapper: source (x, y, z) reads (x, z, y).
            var posts = renderers.Where(renderer =>
                Near(renderer.bounds.size.x, 0.07f) &&
                Near(renderer.bounds.size.y, 0.8f) &&
                renderer.sharedMaterial.name == "darkSteel").ToArray();
            Require(asset.housing.posts == 2, $"{asset.paletteId}: the manifest lost the shared housing ({asset.housing.posts})");
            Require(posts.Length == 2, $"{asset.paletteId}: expected two shared bezel posts, drew {posts.Length}");
            float depth = posts[0].bounds.size.z;
            Require(Mathf.Abs(depth - asset.housing.depthMetres) < 0.003f,
                $"{asset.paletteId}: housing depth {depth:F3} m, expected {asset.housing.depthMetres:F3} m");

            // One suspension for the object: two rods, never two pairs.
            var rods = renderers.Where(renderer =>
                Near(renderer.bounds.size.x, 0.05f) &&
                Near(renderer.bounds.size.z, 0.05f) &&
                renderer.bounds.size.y > 0.2f).ToArray();
            Require(rods.Length == 2, $"{asset.paletteId}: expected one suspension (two rods), drew {rods.Length}");

            // A board and a content window per lit face.
            var boards = renderers.Where(renderer =>
                renderer.sharedMaterial.name.StartsWith("tvDepartureBoard")).ToArray();
            var windows = renderers.Where(renderer =>
                renderer.sharedMaterial.name.StartsWith("tvContentWindow")).ToArray();
            int faces = asset.pairMember ? 2 : 1;
            Require(boards.Length == faces, $"{asset.paletteId}: expected {faces} departure boards, found {boards.Length}");
            Require(windows.Length == faces, $"{asset.paletteId}: expected {faces} content windows, found {windows.Length}");

            // Both lit panes stand proud of the housing, not buried in it.
            float bodyHalf = asset.housing.depthMetres / 2f;
            foreach (var pane in boards.Concat(windows))
                Require(Mathf.Abs(pane.bounds.center.z) >= bodyHalf - 0.001f,
                    $"{asset.paletteId}: a lit pane sits inside the housing");

            if (asset.pairMember)
            {
                Require(asset.moduleIds != null && asset.moduleIds.Length == 2, "the pair should be two modules");
                Require(asset.moduleRotations != null && asset.moduleRotations.Length == 2 &&
                    asset.moduleRotations[0] == 0 && asset.moduleRotations[1] == 2,
                    "the pair should be the rot 0 and rot 2 members");
                // One housing with a face each side: the two boards print opposite ways.
                float a = boards[0].bounds.center.z, b = boards[1].bounds.center.z;
                Require(Mathf.Sign(a) != Mathf.Sign(b),
                    "the pair's two board faces are on the same side of the cell");
                Require(Mathf.Abs(Mathf.Abs(a) - Mathf.Abs(b)) < 0.002f,
                    $"the pair's two faces are not mirrored ({a:F4} / {b:F4})");
                Require(Mathf.Abs(Mathf.Abs(a) - asset.pair.paneHalfDepthMetres) < 0.002f,
                    $"{asset.paletteId}: a board sits at {Mathf.Abs(a):F4} m, expected {asset.pair.paneHalfDepthMetres:F4} m");
                // The pair is a slim housing, not two full cell-deep boxes.
                Require(asset.pair.housingDepthMetres < asset.pair.cellDepthMetres / 2f,
                    "the pair housing is not slim");
                Require(asset.pair.paneHalfDepthMetres > asset.pair.housingHalfDepthMetres,
                    "the pair's lit faces should stand proud of the housing");
            }
            return depth;
        }

        /// <summary>The lit departure board the 电视 prints, and the artwork window beside it.</summary>
        private static void CheckDepartureBoard(Material[] materials, Asset asset)
        {
            var boards = materials.Where(material => material.name.StartsWith(asset.departureBoard.material)).ToArray();
            Require(boards.Length > 0, $"{asset.paletteId}: the departure-board material is missing");
            foreach (var board in boards)
            {
                var texture = board.mainTexture;
                Require(texture != null, $"{asset.paletteId}: {board.name} lost its printed board");
                Require(texture.width == asset.departureBoard.width && texture.height == asset.departureBoard.height,
                    $"{asset.paletteId}: {board.name} is {texture.width}x{texture.height}, expected " +
                    $"{asset.departureBoard.width}x{asset.departureBoard.height}");
            }
            var windows = materials.Where(material => material.name.StartsWith("tvContentWindow")).ToArray();
            Require(windows.Length > 0, $"{asset.paletteId}: the content window is missing");
            Require(windows.All(window => window.mainTexture != null),
                $"{asset.paletteId}: a content window has no artwork");
        }

        /// <summary>
        /// One review scene: all six wrapper prefabs in a row at 3.2 m spacing, framed
        /// by a 2 m camera with a far plane that holds the whole row. Only called when
        /// the scene does not exist (see the note in Import).
        /// </summary>
        private static void BuildReviewScene(Asset[] assets)
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene);
            for (int i = 0; i < assets.Length; i++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>($"{Folder}/{assets[i].prefab}.prefab");
                Require(prefab != null, $"Missing prefab for {assets[i].paletteId}");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                instance.transform.position = new Vector3(RowX[i], 0, 0);
                instance.transform.rotation = Quaternion.identity;
            }

            // The row is 16 m of 3.2 m spacing with 1.56 m screens on the ends, so the
            // camera needs a frame wider than 17 m; the far plane clears the row.
            var camera = new GameObject("Review camera").AddComponent<Camera>();
            camera.transform.position = new Vector3(0, 2f, -17f);
            camera.transform.LookAt(new Vector3(0, 2.2f, 0));
            camera.fieldOfView = 40;
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = 120;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.22f, 0.30f, 0.38f);

            var light = new GameObject("Key light").AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 2.4f;
            light.transform.rotation = Quaternion.Euler(35, -35, 0);
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = Color.white * 0.4f;

            Require(EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), Scene),
                "Could not save the display review scene");
        }

        /// <summary>A quaternion angle folds an over-half-turn rotation back into 0–180 degrees.</summary>
        private static float Folded(float degrees) => degrees > 180f ? 360f - degrees : degrees;

        private static bool Near(float actual, float expected, float tolerance = 0.001f) =>
            Mathf.Abs(actual - expected) < tolerance;

        private static void Near(float actual, float expected, string field) =>
            Require(Near(actual, expected, 0.001f), $"{field}: expected {expected:F4}, got {actual:F4}");

        private static Vector3 Basis(float[] v) => new Vector3(v[0], v[2], v[1]);

        private static Transform FindAnchor(GameObject root, string name) =>
            root.GetComponentsInChildren<Transform>().Single(child => child.name == name);

        /// <summary>
        /// A named node, tolerating glTFast's `_0` suffix on a uniquified sibling name.
        /// </summary>
        private static Transform FindNode(GameObject root, string name) =>
            root.GetComponentsInChildren<Transform>().FirstOrDefault(child =>
                child.name == name || child.name.StartsWith(name + "_", StringComparison.Ordinal));

        private static void CheckAnchor(GameObject root, string name, Vector3 expected) =>
            Near(FindAnchor(root, name).position, expected, name);

        private static void Near(Vector3 actual, Vector3 expected, string field) =>
            Require(Vector3.Distance(actual, expected) < 0.002f, $"{field}: expected {expected:F4}, got {actual:F4}");

        private static void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException(reason);
        }
    }
}
