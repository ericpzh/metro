using System.Collections.Generic;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.Tests {
    /// <summary>
    /// RCA 15 §3: the hand-built boxes in <c>BoothModuleViews</c> and <c>VerticalModuleViews</c>
    /// numbered their eight vertices (x = bit 0, y = bit 1, z = bit 2) but indexed them with a
    /// perimeter-order table, so every "quad" was a bowtie whose two triangles had opposite
    /// signed areas. <c>RecalculateNormals</c> then averaged the eight shared corners, which
    /// also smoothed sheet-metal faces that must stay crisp.
    ///
    /// These pins assert the properties the defect broke, in Unity space:
    /// * each face is covered exactly twice (surface area equals the analytic area),
    /// * every triangle faces away from the box centre (no inverted triangle),
    /// * the closed surface encloses the right **positive** volume, which a single inverted
    ///   triangle would make negative or wrong,
    /// * each face keeps its own normal (flat shading), so a corner is never averaged.
    /// </summary>
    public sealed class MeshWindingTests {
        const float Tolerance = 1e-4f;

        /* ------------------------------------------------------------ helpers */

        /// <summary>Sum of the six face areas of an axis-aligned box.</summary>
        static float BoxArea(Vector3 size) => 2f * (size.x * size.y + size.y * size.z + size.z * size.x);

        static float TriangleArea(Vector3 a, Vector3 b, Vector3 c) =>
            Vector3.Cross(b - a, c - a).magnitude * .5f;

        /// <summary>
        /// The enclosed volume by the divergence theorem: positive when every triangle winds
        /// away from the centre, and exactly the box volume for a correctly wound box.
        /// </summary>
        static float SignedVolume(Mesh mesh) {
            var vertices = mesh.vertices;
            var triangles = mesh.triangles;
            float total = 0f;
            for (int i = 0; i + 2 < triangles.Length; i += 3) {
                var a = vertices[triangles[i]];
                var b = vertices[triangles[i + 1]];
                var c = vertices[triangles[i + 2]];
                total += Vector3.Dot(a, Vector3.Cross(b, c)) / 6f;
            }
            return total;
        }

        static void AssertOutward(Vector3[] vertices, int[] triangles, Vector3 centre, string what) {
            for (int i = 0; i + 2 < triangles.Length; i += 3) {
                var a = vertices[triangles[i]];
                var b = vertices[triangles[i + 1]];
                var c = vertices[triangles[i + 2]];
                var normal = Vector3.Cross(b - a, c - a);
                Assert.Greater(normal.magnitude, Tolerance, what + ": triangle " + (i / 3) + " is degenerate");
                var centroid = (a + b + c) / 3f;
                Assert.Greater(Vector3.Dot(normal, centroid - centre), 0f,
                    what + ": triangle " + (i / 3) + " faces the box centre");
            }
        }

        static void AssertFlatShading(Mesh mesh, string what) {
            var normals = mesh.normals;
            var triangles = mesh.triangles;
            Assert.AreEqual(mesh.vertexCount, normals.Length, what + ": every vertex carries a normal");
            for (int i = 0; i + 2 < triangles.Length; i += 3) {
                var na = normals[triangles[i]];
                var nb = normals[triangles[i + 1]];
                var nc = normals[triangles[i + 2]];
                Assert.Greater(Vector3.Dot(na, nb), .999f, what + ": triangle " + (i / 3) + " shares a normal");
                Assert.Greater(Vector3.Dot(na, nc), .999f, what + ": triangle " + (i / 3) + " shares a normal");
                var geometric = Vector3.Cross(mesh.vertices[triangles[i + 1]] - mesh.vertices[triangles[i]],
                    mesh.vertices[triangles[i + 2]] - mesh.vertices[triangles[i]]).normalized;
                Assert.Greater(Vector3.Dot(na.normalized, geometric), .999f,
                    what + ": triangle " + (i / 3) + " is lit by a smoothed normal");
            }
        }

        /* --------------------------------------------------------- the helper */

        [Test]
        public void AnAxisAlignedBoxCoversEachFaceExactlyOnce() {
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            var size = new Vector3(2f, 3f, 4f);
            BoxFaces.AppendAxisAligned(vertices, triangles, Vector3.zero, size);

            Assert.AreEqual(24, vertices.Count, "four vertices per face, six faces");
            Assert.AreEqual(36, triangles.Count, "two triangles per face, six faces");
            float area = 0f;
            for (int i = 0; i < triangles.Count; i += 3)
                area += TriangleArea(vertices[triangles[i]], vertices[triangles[i + 1]], vertices[triangles[i + 2]]);
            Assert.AreEqual(BoxArea(size), area, 1e-3f, "two triangles cover every face exactly");

            var mesh = new Mesh();
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            Assert.AreEqual(2f * 3f * 4f, SignedVolume(mesh), 1e-3f, "the box encloses its own volume");
            Object.DestroyImmediate(mesh);
            AssertOutward(vertices.ToArray(), triangles.ToArray(), Vector3.zero, "axis-aligned box");
        }

        [Test]
        public void AMirroredEdgeBasisStillFacesOutward() {
            // The document→Unity mapping swaps y and z, which mirrors the basis (det = -1), and
            // the vertical builder rotates in document axes before that swap. The old table
            // assumed a single handedness; deriving the winding from the corners must not.
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            var size = new Vector3(1.5f, .4f, 2.25f);
            var rotation = Quaternion.Euler(0f, 37f, 0f);
            // Doc(x, y, z) = (x, z, y): the same mapping `VerticalModuleViews.Doc` applies.
            System.Func<Vector3, Vector3> doc = v => new Vector3(v.x, v.z, v.y);
            BoxFaces.Append(vertices, triangles, doc(new Vector3(3f, 1f, -2f)),
                doc(rotation * new Vector3(size.x, 0f, 0f)),
                doc(rotation * new Vector3(0f, size.y, 0f)),
                doc(rotation * new Vector3(0f, 0f, size.z)));

            var mesh = new Mesh();
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            Assert.AreEqual(size.x * size.y * size.z, SignedVolume(mesh), 1e-4f,
                "the mirrored box still encloses a positive volume");
            Object.DestroyImmediate(mesh);
            AssertOutward(vertices.ToArray(), triangles.ToArray(), doc(new Vector3(3f, 1f, -2f)), "mirrored box");
        }

        /* ---------------------------------------------------------- the booth */

        [Test]
        public void TheBoothCubeIsPerFaceAndOutward() {
            var cube = BoothModuleViews.Cube();
            Assert.IsNotNull(cube);
            Assert.AreEqual(24, cube.vertexCount, "four vertices per face, six faces");
            Assert.AreEqual(36, cube.triangles.Length, "two triangles per face, six faces");
            Assert.AreEqual(1f, SignedVolume(cube), 1e-4f, "the unit cube encloses one cubic metre");
            AssertOutward(cube.vertices, cube.triangles, Vector3.zero, "booth cube");
            AssertFlatShading(cube, "booth cube");
            var normals = cube.normals;
            var unique = new HashSet<string>();
            for (int i = 0; i < normals.Length; i += 4) {
                var normal = normals[i];
                Assert.AreEqual(1f, Mathf.Abs(normal.x) + Mathf.Abs(normal.y) + Mathf.Abs(normal.z), 1e-3f,
                    "a face normal is a unit axis");
                Assert.IsTrue(unique.Add(Mathf.RoundToInt(normal.x) + "," + Mathf.RoundToInt(normal.y) + "," +
                    Mathf.RoundToInt(normal.z)), "each face keeps a distinct axis normal");
            }
            Assert.AreEqual(6, unique.Count, "six faces, six normals");
        }

        [TestCase("ticket", false)]
        [TestCase("info", false)]
        [TestCase("info", true)]
        public void ABuiltBoothHasFlatOutwardFaces(string kind, bool withCeiling) {
            var root = new GameObject("winding probe");
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");
            Assert.IsNotNull(shader, "the station shader is missing");
            var materials = new StationMaterials(shader);
            try {
                var cells = new JArray();
                if (withCeiling) {
                    for (int cx = 0; cx < 3; cx++)
                        for (int cy = 0; cy < 3; cy++)
                            cells.Add(new JObject { ["x"] = cx, ["y"] = cy, ["z"] = 5, ["fill"] = "solid" });
                }
                var index = StationDocumentReader.Read(new JObject {
                    ["format"] = StationDocumentReader.SaveFormat,
                    ["formatVersion"] = StationDocumentReader.SupportedVersion,
                    ["gameVersion"] = "0.2.0",
                    ["savedAt"] = StationDocumentReader.FixedSavedAt,
                    ["name"] = "booth-winding",
                    ["nameEn"] = "Booth Winding",
                    ["city"] = "guangzhou",
                    ["seed"] = 1,
                    ["levelBase"] = 0,
                    ["storeyHeight"] = 5,
                    ["static"] = new JObject {
                        ["cells"] = cells,
                        ["modules"] = new JArray(),
                        ["lines"] = new JArray(),
                    },
                }.ToString(), StationSource.None).Index;
                var module = ModuleFactsReader.Read(new JObject {
                    ["id"] = "booth-winding-" + kind, ["type"] = "booth",
                    ["x"] = 0, ["y"] = 0, ["z"] = 0, ["w"] = 3, ["h"] = 3, ["rot"] = 0,
                    ["cfg"] = new JObject { ["kind"] = kind, ["stocked"] = true, ["front"] = 0 },
                });
                Assert.IsTrue(BoothModuleViews.TryBuild(module, root.transform, materials, out var view, out var note, 0f, index),
                    "the booth builds");
                Assert.AreEqual("", note, "booth " + kind + " requires no geometry caveat");
                int parts = 0;
                foreach (var filter in view.GetComponentsInChildren<MeshFilter>(true)) {
                    var mesh = filter.sharedMesh;
                    if (!mesh) continue;
                    parts++;
                    AssertFlatShading(mesh, "booth " + kind + " part " + filter.name);
                    // The parts are closed boxes and extruded prisms; each mesh batch encloses positive volume.
                    Assert.Greater(SignedVolume(mesh), 0f, "booth " + kind + " part " + filter.name + " winds outward");
                }
                Assert.Greater(parts, 0, "the booth draws geometry");
            } finally {
                for (int i = 0; i < StationMaterials.Colours.Length; i++)
                    if (materials[i] != null) Object.DestroyImmediate(materials[i]);
                Object.DestroyImmediate(root);
            }
        }
    }
}
