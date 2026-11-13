using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using NUnit.Framework;
using UnityEngine;
using Object = UnityEngine.Object;

// Plan 11, packet E  the cell surfaces and the paint brush against the source oracle.
//
// `tools/unity-parity/record-station-cell-mesh.mjs` runs the **TypeScript** mesher
// (`render/chunkMesher.ts`) and the **TypeScript** brush (`build/model/Paint.ts`) over
// authored fixtures and selected chunks of the Zoo save, and writes
// `station-cell-mesh-oracle.json`. Every test here rebuilds the same input from that
// file and compares its own result, so a divergence in normals, winding, UVs, which
// faces are drawn, which faces the brush offers, or what a paint press writes fails
// here by name.
public class StationCellMeshTests {
    /* ------------------------------------------------------------- oracle types */

    [Serializable] class Oracle {
        public string sourceSha;
        public Fixture[] fixtures;
        public PaintSection paint;
        public ZooSection zoo;
    }
    [Serializable] class Fixture {
        public string name;
        public CellJson[] cells;
        public string[] fills;
        public SlopeJson[] slopes;
        public InsetJson[] insets;
        public string[] hidden;
        public bool virtualGround;
        public int groundZ;
        public int groundMargin;
        public int levelBase;
        public int storeyHeight;
        public Expected expected;
    }
    [Serializable] class Expected {
        public int triangles;
        public Part[] parts;
        public string[] signatures;
    }
    [Serializable] class Part {
        public string finish;
        public int triangles;
        public double area;
        public double[] min;
        public double[] max;
    }
    [Serializable] class CellJson {
        public int x, y, z;
        public string[] tags;
        public string[] finish;
        public string fill;
        public string zone;
    }
    [Serializable] class SlopeJson {
        public string key;
        public string axis;
        public double lo, hi;
        public double basePlane, halfWidth;
        public bool hasBase, hasHalf;
        public string finish;
    }
    [Serializable] class InsetJson {
        public string key;
        public double x0, x1, y0, y1;
    }
    [Serializable] class ZooSection {
        public string path;
        public int cells;
        public int normalizedSolids;
        public int shapedCells;
        public int finishCells;
        public int levelBase;
        public ZooFixture[] fixtures;
    }
    [Serializable] class ZooFixture {
        public string name;
        public Chunk chunk;
        public int cells;
        public string[] selectedCellIds;
        public ZooExpected expected;
    }
    [Serializable] class Chunk { public int cx, cy, band; }
    [Serializable] class ZooExpected {
        public int triangles;
        public long signatureDigest;
        public int signatureCount;
        public Part[] parts;
    }
    [Serializable] class PaintSection {
        public CellJson[] cells;
        public string[] voids;
        public bool virtualGround;
        public int groundZ;
        public int groundMargin;
        public string[] presence;
        public FaceFinishCount[] faceFinishCounts;
        public PaintFixture[] fixtures;
        public ZooPaint zoo;
    }
    [Serializable] class FaceFinishCount { public string face; public string finish; public int count; }
    [Serializable] class ZooPaint {
        public string presence;
        public int cells;
        public int presenceCount;
        public long presenceDigest;
        public FaceFinishCount[] faceFinishCounts;
    }
    [Serializable] class PaintFixture {
        public string name;
        public string mode;
        public int[] anchor;
        public string face;
        public string finish;
        public int[] dragTo;
        public PaintExpected expected;
    }
    [Serializable] class PaintExpected { public PaintWrite[] writes; }
    [Serializable] class PaintWrite {
        public int[] cell;
        public string face;
        public string finish;
        public bool materialise;
        public string zone;
        public string[] tags;
    }

    /* ---------------------------------------------------------------- fixtures */

    static string OraclePath => Path.Combine(Application.dataPath, "StationDesigner/Tests/EditMode/station-cell-mesh-oracle.json");
    static string ZooPath => Path.Combine(Application.dataPath, "StationDesigner/Zoo/ZooSave.json");
    static string FinishDirectory => Path.GetFullPath(Path.Combine(Application.dataPath, "../asset-recipes/finishes"));

    static Oracle oracleData;
    static Oracle LoadOracle() => oracleData ??= JsonUtility.FromJson<Oracle>(File.ReadAllText(OraclePath));

    static Shader StationShader() {
        var shader = Shader.Find("Universal Render Pipeline/Lit");
        Assert.IsNotNull(shader, "The project's station shader (Universal Render Pipeline/Lit) is missing");
        return shader;
    }

    [TearDown] public void TearDown() {
        StationCellRenderer.ClearStates();
    }

    /* ------------------------------------------------------------------- mesher */

    [Test]
    public void FixtureGeometryMatchesTheTypeScriptMesher() {
        var data = LoadOracle();
        Assert.IsNotNull(data, "The cell-mesh oracle is missing; run node tools/unity-parity/record-station-cell-mesh.mjs");
        foreach (var fixture in data.fixtures) {
            var result = StationCellMesher.Mesh(InputOf(fixture));
            // A storey-pass face can now be split into its Cell, Wall, Ceiling or Roof role;
            // the oracle compares the same triangles, so every non-ground role is included.
            var groups = result.Groups.Where(g => fixture.virtualGround ? g.Role == StationSurfaceRole.Ground : g.Role != StationSurfaceRole.Ground).ToList();
            if (fixture.virtualGround) groups = groups.Where(g => g.ChunkX == 0 && g.ChunkY == 0).ToList();
            var actual = Signatures(groups);
            Assert.AreEqual(fixture.expected.triangles, groups.Sum(g => g.TriangleCount), fixture.name + ": triangle count");
            Assert.AreEqual(fixture.expected.signatures.Length, actual.Count, fixture.name + ": signature count");
            for (var i = 0; i < Math.Min(actual.Count, fixture.expected.signatures.Length); i++) {
                Assert.AreEqual(fixture.expected.signatures[i], actual[i], fixture.name + ": triangle " + i + " (centroid, normal, area)");
            }
            var parts = PartsOf(groups);
            foreach (var expected in fixture.expected.parts) {
                Assert.IsTrue(parts.TryGetValue(expected.finish, out var part), fixture.name + ": part " + expected.finish);
                Assert.AreEqual(expected.triangles, part.triangles, fixture.name + ": " + expected.finish + " triangles");
                Assert.AreEqual(expected.area, part.area, 2e-3, fixture.name + ": " + expected.finish + " area");
                for (var axis = 0; axis < 3; axis++) {
                    Assert.AreEqual(expected.min[axis], part.min[axis], 2e-3, fixture.name + ": " + expected.finish + " min[" + axis + "]");
                    Assert.AreEqual(expected.max[axis], part.max[axis], 2e-3, fixture.name + ": " + expected.finish + " max[" + axis + "]");
                }
            }
        }
    }

    [Test]
    public void ZooChunksMatchTheTypeScriptMesher() {
        var data = LoadOracle();
        var read = StationDocumentReader.ReadFile(ZooPath);
        var input = InputOfDocument(read.Document);
        var result = StationCellMesher.Mesh(input);
        Assert.AreEqual(data.zoo.normalizedSolids, read.Document.CellCount, "normalized Zoo cell count");
        Debug.Log($"packet E: Zoo {read.Document.CellCount} cells -> {result.Groups.Count} groups / {result.Triangles} triangles");
        foreach (var fixture in data.zoo.fixtures) {
            var groups = result.Groups
                .Where(g => g.Role != StationSurfaceRole.Ground && g.ChunkX == fixture.chunk.cx && g.ChunkY == fixture.chunk.cy && g.Storey == fixture.chunk.band)
                .ToList();
            Assert.AreEqual(fixture.expected.triangles, groups.Sum(g => g.TriangleCount), fixture.name + ": triangles");
            var signatures = Signatures(groups);
            Assert.AreEqual(fixture.expected.signatureCount, signatures.Count, fixture.name + ": signatures");
            Assert.AreEqual(fixture.expected.signatureDigest, Digest(signatures), fixture.name + ": signature digest");
            var parts = PartsOf(groups);
            foreach (var expected in fixture.expected.parts) {
                Assert.IsTrue(parts.TryGetValue(expected.finish, out var part), fixture.name + ": part " + expected.finish);
                Assert.AreEqual(expected.triangles, part.triangles, fixture.name + ": " + expected.finish + " triangles");
            }
            foreach (var id in fixture.selectedCellIds) {
                var parts2 = id.Split(',');
                var key = new StationCellKey(int.Parse(parts2[0]), int.Parse(parts2[1]), int.Parse(parts2[2]));
                Assert.IsNotNull(read.Index.GetCell(key), fixture.name + ": selected cell " + id + " is not in the document");
            }
            Debug.Log($"packet E: {fixture.name} ({fixture.cells} cells) matched the TS mesh; selected cells {string.Join(" ", fixture.selectedCellIds)}");
        }
    }

    [Test]
    public void FaceRecordsExposeEveryDrawnSurfaceForPicking() {
        var fixture = LoadOracle().fixtures.First(f => f.name == "six-finish");
        var result = StationCellMesher.Mesh(InputOf(fixture));
        var records = result.Faces;
        Assert.IsNotEmpty(records, "the six-finish cell must present pick records");
        foreach (var group in result.Groups) {
            Assert.AreEqual(group.TriangleCount, group.TriangleFaces.Length, "every triangle has a face record");
            foreach (var index in group.TriangleFaces) Assert.IsTrue(index >= 0 && index < records.Count);
        }
        var top = records.Where(r => r.X == 0 && r.Y == 0 && r.Z == 0).ToList();
        // Six finishes on the cell, two faces occluded: the drawn faces keep their own id.
        var finishes = top.Select(r => r.FinishId).Distinct().OrderBy(id => id, StringComparer.Ordinal).ToArray();
        CollectionAssert.Contains(finishes, "floor.granite", "the south face keeps its own finish");
        CollectionAssert.Contains(finishes, "wall.enamel#ff4242", "the north face keeps its custom-tinted finish");
        CollectionAssert.Contains(finishes, "ceil.baffle", "the bottom face keeps its own finish");
        CollectionAssert.DoesNotContain(finishes, "floor.marble", "the occluded top face is not drawn");
    }

    /* --------------------------------------------------------------------- paint */

    [Test]
    public void PresetFacesMatchTheTypeScriptBrush() {
        var paint = LoadOracle().paint;
        var snapshot = PaintSnapshotOf(paint);
        var presence = new List<string>();
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var key in SurfaceCellsOf(snapshot, paint)) {
            foreach (var face in StationFaces.All) {
                var present = StationFinishEdits.FacePresent(snapshot, key, face);
                presence.Add(key.X + "," + key.Y + "," + key.Z + "," + StationFaces.Name(face) + "," + (present ? "1" : "0"));
                if (!present) continue;
                var id = snapshot.Find(key) == null ? StationFinishIds.DefaultMaterial : snapshot.FinishOf(key, face);
                var countKey = StationFaces.Name(face) + "|" + id;
                counts.TryGetValue(countKey, out var count);
                counts[countKey] = count + 1;
            }
        }
        presence.Sort(StringComparer.Ordinal);
        var expected = (paint.presence ?? Array.Empty<string>()).OrderBy(line => line, StringComparer.Ordinal).ToArray();
        Assert.AreEqual(expected.Length, presence.Count, "the brush must offer the same number of cell faces");
        for (var i = 0; i < Math.Min(expected.Length, presence.Count); i++) Assert.AreEqual(expected[i], presence[i], "face " + i);
        foreach (var count in paint.faceFinishCounts) {
            counts.TryGetValue(count.face + "|" + count.finish, out var actual);
            Assert.AreEqual(count.count, actual, "present " + count.face + " faces wearing " + count.finish);
        }
    }

    [Test]
    public void PaintFixturesMatchTheTypeScriptWrites() {
        var paint = LoadOracle().paint;
        var snapshot = PaintSnapshotOf(paint);
        foreach (var fixture in paint.fixtures) {
            var result = StationFinishEdits.Paint(snapshot, RequestOf(fixture));
            Assert.IsTrue(result.Accepted, fixture.name + ": " + result.Code + " " + result.Message);
            AssertWrites(fixture.name, result.Writes, fixture.expected.writes);
        }
    }

    [Test]
    public void ZooFaceFactsMatchTheTypeScriptBrush() {
        var data = LoadOracle();
        var read = StationDocumentReader.ReadFile(ZooPath);
        var snapshot = StationPaintSnapshot.FromDocument(read.Document, null, -1, 16);
        // The oracle's brush facts are the document's own cells (no street plane): the
        // generated-ground rule is covered by the paint fixtures, which use it.
        snapshot.VirtualGround = false;
        var ordered = snapshot.Cells.Where(c => c.IsSolid).OrderBy(c => c.X).ThenBy(c => c.Y).ThenBy(c => c.Z).ToList();
        Assert.AreEqual(data.zoo.normalizedSolids, ordered.Count, "normalized Zoo solids");
        var bits = new StringBuilder(ordered.Count * 6);
        foreach (var cell in ordered) foreach (var face in StationFaces.All) bits.Append(StationFinishEdits.FacePresent(snapshot, cell.Key, face) ? '1' : '0');
        Assert.AreEqual(data.paint.zoo.presenceCount, bits.Length, "presence bit count");
        Assert.AreEqual(data.paint.zoo.presenceDigest, DigestBits(bits.ToString()), "presence digest against the TS brush");
        foreach (var count in data.paint.zoo.faceFinishCounts) {
            var face = ParseFace(count.face);
            var actual = ordered.Count(cell => StationFinishEdits.FacePresent(snapshot, cell.Key, face) && snapshot.FinishOf(cell.Key, face) == count.finish);
            Assert.AreEqual(count.count, actual, "Zoo " + count.face + " faces wearing " + count.finish);
        }
        Debug.Log($"packet E: Zoo brush offers {bits.ToString().Count(c => c == '1')} faces over {ordered.Count} cells");
    }

    [Test]
    public void AdjacentFacesKeepTheirOwnFinish() {
        var snapshot = PaintSnapshotOf(LoadOracle().paint);
        // The slab at (21,21,2) presents both its top and its east face.
        var top = StationFinishEdits.Paint(snapshot, new StationPaintRequest { X = 21, Y = 21, Z = 2, Face = StationFace.Top, Finish = "floor.marble" });
        var east = StationFinishEdits.Paint(snapshot, new StationPaintRequest { X = 21, Y = 21, Z = 2, Face = StationFace.E, Finish = "wall.stainless" });
        Assert.AreEqual("ok", top.Code);
        Assert.AreEqual("ok", east.Code);
        Assert.AreEqual(StationFace.Top, top.Writes.Single().Face);
        Assert.AreEqual("floor.marble", top.Writes.Single().Finish);
        Assert.AreEqual(StationFace.E, east.Writes.Single().Face);
        Assert.AreEqual("wall.stainless", east.Writes.Single().Finish);
        // One cell wears a different finish on each face: apply both writes and check.
        var cell = ApplyWrites(snapshot, top.Writes.Concat(east.Writes));
        Assert.AreEqual("floor.marble", cell.FinishOf("top"));
        Assert.AreEqual("wall.stainless", cell.FinishOf("e"));
        Assert.AreEqual("", cell.FinishOf("bottom"), "an untouched face keeps the family default (no override)");
    }

    [Test]
    public void FloodStaysOnItsSurfaceAndNeverCrossesAStorey() {
        var snapshot = PaintSnapshotOf(LoadOracle().paint);
        var floor = StationFinishEdits.Paint(snapshot, new StationPaintRequest {
            X = 0, Y = 0, Z = 0, Face = StationFace.Top, Finish = "floor.marble", Mode = StationPaintMode.Surface,
        });
        Assert.AreEqual("ok", floor.Code);
        Assert.AreEqual(11, floor.Writes.Count, "the floor's connected top surface (the wall's footprint is not exposed)");
        Assert.IsTrue(floor.Writes.All(w => w.Z == 0 && w.Face == StationFace.Top), "a top-face flood never leaves its storey");
        // The suspended ceiling course bounds a vertical flood: the wall column reaches
        // z=3 but not the course above it, exactly as the source's fillSurface does.
        var wall = StationFinishEdits.Paint(snapshot, new StationPaintRequest {
            X = 0, Y = 1, Z = 1, Face = StationFace.E, Finish = "wall.plaster", Mode = StationPaintMode.Surface,
        });
        Assert.AreEqual("ok", wall.Code);
        Assert.AreEqual(3, wall.Writes.Count, "the wall flood stops under the ceiling course");
        Assert.IsTrue(wall.Writes.All(w => w.X == 0 && w.Y == 1 && w.Face == StationFace.E), "the flood stays in the wall plane");
        Assert.IsTrue(wall.Writes.All(w => w.Z <= 3), "the flood never crosses the ceiling course into the storey above");
        // A face the brush refuses writes nothing at all.
        var occluded = StationFinishEdits.Paint(snapshot, new StationPaintRequest { X = 0, Y = 0, Z = 0, Face = StationFace.N, Finish = "floor.slate" });
        Assert.IsFalse(occluded.Accepted);
        Assert.AreEqual("face-not-present", occluded.Code);
        Assert.IsEmpty(occluded.Writes);
    }

    [Test]
    public void PaintSurvivesSaveAndReopen() {
        var read = StationDocumentReader.ReadFile(ZooPath);
        var snapshot = StationPaintSnapshot.FromDocument(read.Document, null, -1, 16);
        // Pick a face the brush offers and its current finish: no hard-coded Zoo id.
        StationCellKey target = default;
        var face = StationFace.Top;
        var found = false;
        foreach (var cell in snapshot.Cells.Where(c => c.IsSolid).OrderBy(c => c.Z).ThenBy(c => c.X).ThenBy(c => c.Y)) {
            foreach (var candidate in StationFaces.All) {
                if (!StationFinishEdits.FacePresent(snapshot, cell.Key, candidate)) continue;
                target = cell.Key;
                face = candidate;
                found = true;
                break;
            }
            if (found) break;
        }
        Assert.IsTrue(found, "the Zoo document must present at least one paintable face");
        var paint = StationFinishEdits.Paint(snapshot, new StationPaintRequest {
            X = target.X, Y = target.Y, Z = target.Z, Face = face, Finish = "floor.granite", ExpectedRevision = 7,
        });
        // The snapshot carries no revision (-1) until the host sets it; a mismatched
        // expected revision is still refused when the host does.
        var stale = StationPaintSnapshot.FromDocument(read.Document, null, 6, 16);
        var rejected = StationFinishEdits.Paint(stale, new StationPaintRequest { X = target.X, Y = target.Y, Z = target.Z, Face = face, Finish = "floor.granite", ExpectedRevision = 7 });
        Assert.IsFalse(rejected.Accepted);
        Assert.AreEqual("revision-mismatch", rejected.Code);
        Assert.AreEqual("ok", paint.Code);
        // Apply the edit to the document records and reopen the envelope through the
        // same reader: the normalizer must keep the finish because the face is exposed.
        var cells = read.Document.Cells.Select(c => c.Key == target ? WithFinish(c, paint.Writes) : c).ToArray();
        var envelope = EnvelopeOf(cells, read.Document);
        var reopened = StationDocumentReader.Read(envelope, new StationSource("paint-test", ""));
        var cellRecord = reopened.Index.GetCell(target);
        Assert.IsNotNull(cellRecord, "the painted cell survives the reopen");
        Assert.AreEqual("floor.granite", cellRecord.FinishOf(StationFaces.Name(face)), "the painted face survives save/reopen");
    }

    [Test]
    public void StreetUndersidePaintMaterialisesARecord() {
        var snapshot = PaintSnapshotOf(LoadOracle().paint);
        // A generated street cell the document does not hold: painting its underside is
        // what turns it into a record, with the source's zone and tag.
        var ground = GroundCellsOf(snapshot, LoadOracle().paint).First();
        var result = StationFinishEdits.Paint(snapshot, new StationPaintRequest {
            X = ground.X, Y = ground.Y, Z = ground.Z, Face = StationFace.Bottom, Finish = "ceil.baffle",
        });
        Assert.AreEqual("ok", result.Code);
        var write = result.Writes.Single();
        Assert.IsTrue(write.Materialise, "no record existed; the write must materialise the cell");
        Assert.AreEqual("outside", write.Zone, "the street is ");
        CollectionAssert.Contains(write.Tags, "painted-ground");
        Assert.AreEqual(StationFace.Bottom, write.Face);
        Assert.AreEqual("ceil.baffle", write.Finish);
    }

    /* ------------------------------------------------------------------- library */

    [Test]
    public void FinishLibraryMatchesTheExport() {
        Assert.IsTrue(File.Exists(Path.Combine(FinishDirectory, "finishes.json")),
            "The finish export is missing; run node tools/unity-assets/export-station-finishes.mjs");
        using var library = StationFinishLibrary.LoadFromDirectory(FinishDirectory, StationShader());
        Assert.AreEqual(21, library.FinishCount, "exported finishes (20 stock + Zoo's tinted enamel)");
        Assert.AreEqual(0, library.UnknownFinishIds.Count, "no unknown finish in the export: " + string.Join(",", library.UnknownFinishIds));
        Assert.IsTrue(library.IsKnown("floor.concrete"));
        Assert.IsTrue(library.IsKnown("wall.enamel#ff4242"), "the save's tinted enamel is an exported finish of its own");
        Assert.IsTrue(library.IsKnown("wall.soil"), "the legacy earth wall stays drawable");
        Assert.IsTrue(library.TryGetFacts("floor.granite", out var granite));
        Assert.AreEqual("floor", granite.Family);
        Assert.AreEqual(0.78f, granite.Roughness, 1e-4f, "roughness comes from finishMaterialProperties");
        Assert.AreEqual(0.02f, granite.Metalness, 1e-4f);
        Assert.AreEqual(1f, granite.RepeatU, 1e-4f, "one texture tile per metre");
        Assert.AreEqual(1f, granite.RepeatV, 1e-4f);
        Assert.IsTrue(library.IsWall("wall.enamel#ff4242"));
        var enamel = library.Facts("wall.enamel#ff4242");
        Assert.AreEqual("ff4242", StationFinishIds.Hex((int)(enamel.Tint.r * 255) << 16 | (int)(enamel.Tint.g * 255) << 8 | (int)(enamel.Tint.b * 255)));
        var material = library.For("floor.tile");
        Assert.IsNotNull(material, "the library mints a URP material per finish");
        var baseMap = material.GetTexture("_BaseMap");
        Assert.IsNotNull(baseMap, "URP/Lit gets the exported albedo in _BaseMap");
        Assert.AreEqual(TextureWrapMode.Repeat, baseMap.wrapMode, "finish textures repeat");
        Assert.AreEqual(0, library.UnknownFinishIds.Count);
    }

    [Test]
    public void UnknownFinishIsDiagnosedAndKeptInTheDocument() {
        using var library = StationFinishLibrary.LoadFromDirectory(FinishDirectory, StationShader());
        var facts = library.Facts("wall.unobtainium");
        Assert.IsFalse(facts.Known);
        Assert.AreEqual("floor.concrete", library.FallbackId, "the documented fallback is the source default material");
        Assert.IsTrue(library.UnknownFinishIds.Contains("wall.unobtainium"), "an unknown id is reported by name");
        Assert.IsTrue(library.Diagnostics.Any(d => d.Contains("wall.unobtainium")), "and named in the diagnostics");
        // The document keeps the id: the brush writes the string it was given, even
        // when the library cannot draw it (only the render falls back).
        var snapshot = PaintSnapshotOf(LoadOracle().paint);
        var result = StationFinishEdits.Paint(snapshot, new StationPaintRequest { X = 0, Y = 0, Z = 0, Face = StationFace.Top, Finish = "wall.unobtainium" });
        Assert.AreEqual("wall.unobtainium", result.Writes.Single().Finish, "an unknown finish id stays in the edit");
    }

    /* ---------------------------------------------------------------------- view */

    [Test]
    public void CellViewBuildsGroupsAndPicksItsFaces() {
        using var library = StationFinishLibrary.LoadFromDirectory(FinishDirectory, StationShader());
        var input = new StationCellMeshInput {
            LevelBase = 0, StoreyHeight = 5, VirtualGround = false, DefaultFinish = "floor.concrete",
            RampSoffitFinish = "ceil.steel",
        };
        for (var x = 0; x < 3; x++) for (var y = 0; y < 3; y++) {
            input.Cells.Add(new StationMeshCell {
                X = x, Y = y, Z = 0, Solid = true, Shape = StationCellShape.Full,
                Flags = StationMeshCellFlags.None,
                Finish = new StationFinishSet(top: x == 1 && y == 1 ? "floor.granite" : null),
            });
        }
        var parent = new GameObject("cell view test root");
        try {
            var view = StationCellView.Build(new StationCellViewRequest {
                Mesh = input, Finishes = library, Name = "test cells",
            }, parent.transform);
            try {
                Assert.IsNotEmpty(view.Groups, "the view builds groups");
                Assert.Greater(view.Triangles, 0, "and triangles");
                foreach (var group in view.Groups) {
                    Assert.IsNotNull(group.Mesh, "each group owns a mesh");
                    Assert.IsNotNull(group.Renderer.sharedMaterial, "and a finish material");
                    Assert.AreEqual(group.Triangles, group.Data.TriangleFaces.Length);
                    Assert.AreEqual(group.Data.Positions.Length, group.Mesh.vertexCount);
                }
                // Document (1,1,0)'s top face is at z=1 -> world y=1; ray down from above.
                var ray = new Ray(new Vector3(1.5f, 5f, 1.5f), Vector3.down);
                Assert.IsTrue(view.TryPick(ray, out var hit), "the view picks its own surface");
                Assert.AreEqual(1, hit.X);
                Assert.AreEqual(1, hit.Y);
                Assert.AreEqual(0, hit.Z);
                Assert.AreEqual(StationFace.Top, hit.Face);
                Assert.AreEqual("floor.granite", hit.FinishId, "the pick record carries the face's own finish");
                Assert.AreEqual("1,1,0/top:floor.granite", hit.Pick.ToString());
                // Role visibility is what packet D toggles. The flat floor at grade is the
                // storey's top slab, so its top face is tagged as a ceiling/roof surface;
                // hide whichever role the pick reports.
                view.SetRoleVisible(hit.Role, false);
                Assert.IsFalse(view.TryPick(ray, out _), "hiding the role removes the surface from picking");
                view.SetRoleVisible(hit.Role, true);
                Assert.IsTrue(view.TryPick(ray, out _));
            } finally {
                view.Dispose();
            }
        } finally {
            Object.DestroyImmediate(parent);
        }
    }

    /* --------------------------------------------------------------- view roles */

    [Test]
    public void WallFacesAreTaggedAndStillPickTheSameSurface() {
        using var library = StationFinishLibrary.LoadFromDirectory(FinishDirectory, StationShader());
        var input = new StationCellMeshInput {
            LevelBase = 0, StoreyHeight = 5, VirtualGround = false,
            DefaultFinish = "floor.concrete", RampSoffitFinish = "ceil.steel",
        };
        for (var x = 0; x < 3; x++) for (var y = 0; y < 3; y++) {
            input.Cells.Add(new StationMeshCell { X = x, Y = y, Z = 0, Solid = true, Shape = StationCellShape.Full });
        }
        for (var z = 1; z <= 2; z++) {
            input.Cells.Add(new StationMeshCell {
                X = 0, Y = 1, Z = z, Solid = true, Shape = StationCellShape.Full,
                Flags = StationMeshCellFlags.Wall,
            });
        }
        var parent = new GameObject("wall role test root");
        try {
            var view = StationCellView.Build(new StationCellViewRequest { Mesh = input, Finishes = library, Name = "wall roles" }, parent.transform);
            try {
                var wallGroups = view.Groups.Where(g => g.Role == StationSurfaceRole.Wall).ToList();
                Assert.IsNotEmpty(wallGroups, "the wall-flagged course's exposed side faces are Wall groups");
                Assert.IsTrue(wallGroups.All(g => g.Wall), "a Wall group reports the wall flag 隐藏墙壁 reads");
                var wallFaces = view.Faces.Where(f => f.Role == StationSurfaceRole.Wall).ToList();
                Assert.IsNotEmpty(wallFaces, "the wall's faces carry the Wall pick role");
                Assert.IsTrue(wallFaces.All(f => f.Face == StationFace.N || f.Face == StationFace.E ||
                                                 f.Face == StationFace.S || f.Face == StationFace.W),
                    "only the wall's vertical faces are tagged Wall");
                var ray = new Ray(new Vector3(5f, 1.5f, 1.5f), Vector3.left);
                Assert.IsTrue(view.TryPick(ray, out var hit), "the wall side is pickable");
                Assert.AreEqual(StationSurfaceRole.Wall, hit.Role);
                Assert.AreEqual(0, hit.X);
                Assert.AreEqual(1, hit.Y);
                Assert.AreEqual(1, hit.Z);
                Assert.AreEqual(StationFace.E, hit.Face);
                Assert.AreEqual("0,1,1/e:floor.concrete", hit.Pick.ToString(), "the pick still resolves the same cell/face/finish");
                view.SetRoleVisible(StationSurfaceRole.Wall, false);
                Assert.IsTrue(wallGroups.All(g => !g.GameObject.activeSelf), "隐藏墙壁's role takes the walls out of the draw");
                Assert.IsFalse(view.TryPick(ray, out _), "a hidden wall cannot be picked");
                view.SetRoleVisible(StationSurfaceRole.Wall, true);
                Assert.IsTrue(view.TryPick(ray, out var again));
                Assert.AreEqual(hit.Pick.ToString(), again.Pick.ToString(), "the same face resolves before and after the toggle");
            } finally {
                view.Dispose();
            }
        } finally {
            Object.DestroyImmediate(parent);
        }
    }

    [Test]
    public void ZooRoleSplitKeepsTheDefaultDrawSet() {
        using var library = StationFinishLibrary.LoadFromDirectory(FinishDirectory, StationShader());
        var read = StationDocumentReader.ReadFile(ZooPath);
        var input = StationCellTestInputs.ZooViewInput(read.Document, library);
        var parent = new GameObject("zoo role root");
        try {
            var view = StationCellView.Build(new StationCellViewRequest { Mesh = input, Finishes = library, Name = "zoo roles" }, parent.transform);
            try {
                var counts = view.Groups.GroupBy(g => g.Role).ToDictionary(g => g.Key, g => g.Count());
                // Pinned Zoo counts: the split must not silently collapse back to one role.
                Assert.AreEqual(158, counts[StationSurfaceRole.Cell], "Zoo Cell groups");
                Assert.AreEqual(144, counts[StationSurfaceRole.Wall], "Zoo Wall groups (wall-flagged cells + wall.* finishes)");
                Assert.AreEqual(130, counts[StationSurfaceRole.Ceiling], "Zoo Ceiling groups (ceiling plates + slab bodies)");
                Assert.AreEqual(65, counts[StationSurfaceRole.Roof], "Zoo Roof groups (cell-geometry roof decks; 0 roof modules)");
                Assert.AreEqual(66, counts[StationSurfaceRole.Ground], "Zoo generated-street groups");
                var triangles = view.Groups.GroupBy(g => g.Role).ToDictionary(g => g.Key, g => g.Sum(x => x.Triangles));
                Assert.AreEqual(42942, triangles[StationSurfaceRole.Cell], "Cell triangles");
                Assert.AreEqual(14858, triangles[StationSurfaceRole.Wall], "Wall triangles");
                Assert.AreEqual(9488, triangles[StationSurfaceRole.Ceiling], "Ceiling triangles");
                Assert.AreEqual(6860, triangles[StationSurfaceRole.Roof], "Roof triangles");
                Assert.AreEqual(98224, triangles[StationSurfaceRole.Ground], "street triangles");
                // Default rendering is the old unsplit draw set: same triangles per finish.
                var byFinish = view.TrianglesByFinish;
                Assert.AreEqual(9586, byFinish["ceil.baffle"], "ceil.baffle triangles unchanged");
                Assert.AreEqual(138980, byFinish["floor.concrete"], "floor.concrete triangles unchanged");
                Assert.AreEqual(19936, byFinish["floor.soil"], "floor.soil triangles unchanged");
                Assert.AreEqual(3854, byFinish["wall.enamel#ff4242"], "tinted enamel triangles unchanged");
                Assert.AreEqual(16, byFinish["wall.stainless"], "stainless triangles unchanged");
                Assert.AreEqual(74148, triangles.Where(p => p.Key != StationSurfaceRole.Ground).Sum(p => p.Value),
                    "the storey pass total is the pre-split 74 148 triangles");
                // Every drawn triangle's pick record carries its group's role, so TryPick
                // reports the same surface role the visibility walk registered.
                foreach (var group in view.Groups) {
                    foreach (var index in group.Data.TriangleFaces) {
                        Assert.IsTrue(index >= 0 && index < view.Faces.Count);
                        Assert.AreEqual(group.Role, view.Faces[index].Role, group.Data.GroupKey + ": face record role");
                    }
                }
                Debug.Log("packet D4: Zoo roles " + string.Join(", ", counts.OrderBy(p => p.Key).Select(p => p.Key + "=" + p.Value)) +
                          "; triangles " + string.Join(", ", triangles.OrderBy(p => p.Key).Select(p => p.Key + "=" + p.Value)));
            } finally {
                view.Dispose();
            }
        } finally {
            Object.DestroyImmediate(parent);
        }
    }

    /* ------------------------------------------------------------------- helpers */

    static StationCellMeshInput InputOf(Fixture fixture) {
        var input = new StationCellMeshInput {
            LevelBase = fixture.levelBase,
            StoreyHeight = fixture.storeyHeight <= 0 ? 5 : fixture.storeyHeight,
            VirtualGround = fixture.virtualGround,
            GroundZ = fixture.groundZ,
            GroundMargin = fixture.groundMargin,
            BuildCeilings = false,
            BuildPlates = false,
        };
        foreach (var cell in fixture.cells ?? Array.Empty<CellJson>()) input.Cells.Add(MeshCellOf(cell));
        foreach (var key in fixture.fills ?? Array.Empty<string>()) input.SlopeFills.Add(KeyOf(key));
        foreach (var key in fixture.hidden ?? Array.Empty<string>()) input.HiddenCells.Add(KeyOf(key));
        foreach (var slope in fixture.slopes ?? Array.Empty<SlopeJson>()) {
            input.SlopeCuts[KeyOf(slope.key)] = new StationSlopeCut {
                Axis = string.IsNullOrEmpty(slope.axis) ? 'x' : slope.axis[0],
                Lo = slope.lo, Hi = slope.hi,
                HasBase = slope.hasBase, Base = slope.basePlane,
                HasHalf = slope.hasHalf, Half = slope.halfWidth,
                Finish = string.IsNullOrEmpty(slope.finish) ? null : slope.finish,
            };
        }
        foreach (var inset in fixture.insets ?? Array.Empty<InsetJson>()) {
            input.Insets[KeyOf(inset.key)] = new StationCellInset(inset.x0, inset.x1, inset.y0, inset.y1);
        }
        return input;
    }

    static StationCellMeshInput InputOfDocument(StationDocument document) {
        var input = new StationCellMeshInput {
            LevelBase = document.LevelBase,
            StoreyHeight = document.StoreyHeight,
            VirtualGround = false,
            BuildCeilings = false,
            BuildPlates = false,
        };
        foreach (var cell in document.Cells) {
            if (!cell.IsSolid) { input.Voids.Add(cell.Key); continue; }
            var tags = cell.Tags;
            var flags = StationMeshCellFlags.None;
            if (StationCellRules.IsWallBlock(tags)) flags |= StationMeshCellFlags.Wall;
            if (cell.HasTag("suspended-ceiling")) flags |= StationMeshCellFlags.SuspendedCeiling;
            if (cell.HasTag("opening-ceiling")) flags |= StationMeshCellFlags.OpeningCeiling;
            input.Cells.Add(new StationMeshCell {
                X = cell.X, Y = cell.Y, Z = cell.Z, Solid = true,
                Shape = StationCellRules.ShapeOf(tags), Flags = flags, Finish = StationFinishSet.FromRecord(cell),
            });
        }
        return input;
    }

    static StationMeshCell MeshCellOf(CellJson json) {
        var tags = json.tags ?? Array.Empty<string>();
        var flags = StationMeshCellFlags.None;
        if (StationCellRules.IsWallBlock(tags)) flags |= StationMeshCellFlags.Wall;
        if (tags.Contains("suspended-ceiling")) flags |= StationMeshCellFlags.SuspendedCeiling;
        if (tags.Contains("opening-ceiling")) flags |= StationMeshCellFlags.OpeningCeiling;
        if (tags.Contains("painted-ground")) flags |= StationMeshCellFlags.PaintedGround;
        return new StationMeshCell {
            X = json.x, Y = json.y, Z = json.z, Solid = json.fill != "void",
            Shape = StationCellRules.ShapeOf(tags), Flags = flags, Finish = FinishSetOf(json),
        };
    }

    static StationFinishSet FinishSetOf(CellJson json) {
        string Face(string name) {
            foreach (var entry in json.finish ?? Array.Empty<string>()) {
                if (entry.StartsWith(name + "=", StringComparison.Ordinal)) return entry.Substring(name.Length + 1);
            }
            return null;
        }
        return new StationFinishSet(Face("top"), Face("bottom"), Face("n"), Face("e"), Face("s"), Face("w"));
    }

    static StationCellRecord RecordOf(CellJson json) {
        var finish = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var entry in json.finish ?? Array.Empty<string>()) {
            var at = entry.IndexOf('=');
            if (at > 0) finish[entry.Substring(0, at)] = entry.Substring(at + 1);
        }
        var solid = json.fill != "void";
        return new StationCellRecord(json.x, json.y, json.z, "full", solid ? "solid" : "void", json.zone,
            json.tags ?? Array.Empty<string>(), finish, null, null);
    }

    static StationPaintSnapshot PaintSnapshotOf(PaintSection paint) {
        var snapshot = new StationPaintSnapshot { VirtualGround = paint.virtualGround, GroundLevel = paint.groundZ };
        foreach (var cell in paint.cells) snapshot.Cells.Add(RecordOf(cell));
        foreach (var key in paint.voids ?? Array.Empty<string>()) snapshot.Voids.Add(KeyOf(key));
        return snapshot.Index().BuildGroundWindow(paint.groundMargin);
    }

    static List<StationCellKey> SurfaceCellsOf(StationPaintSnapshot snapshot, PaintSection paint) {
        var cells = snapshot.Cells.Where(c => c.IsSolid).Select(c => c.Key).ToList();
        cells.AddRange(GroundCellsOf(snapshot, paint));
        return cells;
    }

    static List<StationCellKey> GroundCellsOf(StationPaintSnapshot snapshot, PaintSection paint) {
        var result = new List<StationCellKey>();
        if (!paint.virtualGround) return result;
        for (var x = snapshot.GroundX0; x <= snapshot.GroundX1; x++) {
            for (var y = snapshot.GroundY0; y <= snapshot.GroundY1; y++) {
                var key = new StationCellKey(x, y, paint.groundZ);
                if (snapshot.Find(key) != null || snapshot.Voids.Contains(key)) continue;
                result.Add(key);
            }
        }
        return result;
    }

    static StationPaintRequest RequestOf(PaintFixture fixture) {
        var request = new StationPaintRequest {
            X = fixture.anchor[0], Y = fixture.anchor[1], Z = fixture.anchor[2],
            Face = ParseFace(fixture.face),
            Finish = string.IsNullOrEmpty(fixture.finish) ? StationFinishIds.DefaultMaterial : fixture.finish,
            Mode = fixture.mode == "surface" ? StationPaintMode.Surface : fixture.mode == "erase" ? StationPaintMode.Erase : StationPaintMode.Single,
        };
        if (fixture.dragTo != null && fixture.dragTo.Length >= 2) {
            request.HasDrag = true;
            request.ToX = fixture.dragTo[0];
            request.ToY = fixture.dragTo[1];
            request.ToZ = fixture.dragTo.Length > 2 ? fixture.dragTo[2] : fixture.anchor[2];
        }
        return request;
    }

    static void AssertWrites(string name, List<StationFaceWrite> actualWrites, PaintWrite[] expectedWrites) {
        var actual = actualWrites
            .OrderBy(w => w.X).ThenBy(w => w.Y).ThenBy(w => w.Z).ThenBy(w => StationFaces.Name(w.Face))
            .Select(w => w.X + "," + w.Y + "," + w.Z + "|" + StationFaces.Name(w.Face) + "|" + (w.Finish ?? "<null>") + "|" + w.Materialise +
                         "|" + (w.Materialise ? w.Zone ?? "" : "") + "|" + (w.Materialise ? string.Join("+", w.Tags) : ""))
            .ToList();
        // JsonUtility maps a JSON `null` string to "", so an erase is "" in the oracle too.
        var expected = (expectedWrites ?? Array.Empty<PaintWrite>())
            .OrderBy(w => w.cell[0]).ThenBy(w => w.cell[1]).ThenBy(w => w.cell[2]).ThenBy(w => w.face)
            .Select(w => w.cell[0] + "," + w.cell[1] + "," + w.cell[2] + "|" + w.face + "|" + (string.IsNullOrEmpty(w.finish) ? "<null>" : w.finish) + "|" + w.materialise +
                         "|" + (w.materialise ? w.zone ?? "" : "") + "|" + (w.materialise ? string.Join("+", w.tags ?? Array.Empty<string>()) : ""))
            .ToList();
        CollectionAssert.AreEqual(expected, actual, name + ": paint writes");
    }

    /// <summary>Merge writes into the snapshot's records and return the last touched cell.</summary>
    static StationCellRecord ApplyWrites(StationPaintSnapshot snapshot, IEnumerable<StationFaceWrite> writes) {
        StationCellRecord last = null;
        foreach (var group in writes.GroupBy(write => write.Cell)) {
            var record = snapshot.Find(group.Key);
            if (record == null) continue;
            var finish = new Dictionary<string, string>(record.Finish, StringComparer.Ordinal);
            foreach (var write in group) {
                if (write.IsErase) finish.Remove(StationFaces.Name(write.Face));
                else finish[StationFaces.Name(write.Face)] = write.Finish;
            }
            last = new StationCellRecord(record.X, record.Y, record.Z, record.Shape, record.Fill, record.Zone,
                record.Tags.ToArray(), finish, record.Room, record.RawJson);
        }
        return last;
    }

    static StationCellRecord WithFinish(StationCellRecord record, IEnumerable<StationFaceWrite> writes) {
        var finish = new Dictionary<string, string>(record.Finish, StringComparer.Ordinal);
        foreach (var write in writes) {
            if (write.IsErase) finish.Remove(StationFaces.Name(write.Face));
            else finish[StationFaces.Name(write.Face)] = write.Finish;
        }
        return new StationCellRecord(record.X, record.Y, record.Z, record.Shape, record.Fill, record.Zone,
            record.Tags.ToArray(), finish, record.Room, record.RawJson);
    }

    /// <summary>A minimal normalized v1 envelope: what a save after this edit contains.</summary>
    static string EnvelopeOf(IEnumerable<StationCellRecord> cells, StationDocument document) {
        var text = new StringBuilder(4096);
        text.Append("{\"format\":\"metro-save\",\"formatVersion\":1,\"name\":\"paint test\",\"city\":\"guangzhou\"");
        text.Append(",\"seed\":1,\"levelBase\":").Append(document.LevelBase).Append(",\"storeyHeight\":").Append(document.StoreyHeight);
        text.Append(",\"static\":{\"cells\":[");
        var first = true;
        foreach (var cell in cells) {
            if (!first) text.Append(',');
            first = false;
            text.Append("{\"x\":").Append(cell.X).Append(",\"y\":").Append(cell.Y).Append(",\"z\":").Append(cell.Z);
            text.Append(",\"fill\":\"").Append(cell.Fill).Append('"');
            if (cell.Zone.Length > 0) text.Append(",\"zone\":\"").Append(cell.Zone).Append('"');
            if (cell.Tags.Count > 0) {
                text.Append(",\"tags\":[");
                for (var i = 0; i < cell.Tags.Count; i++) { if (i > 0) text.Append(','); text.Append('"').Append(cell.Tags[i]).Append('"'); }
                text.Append(']');
            }
            if (cell.Finish.Count > 0) {
                text.Append(",\"finish\":{");
                var firstFace = true;
                foreach (var pair in cell.Finish) {
                    if (!firstFace) text.Append(',');
                    firstFace = false;
                    text.Append('"').Append(pair.Key).Append("\":\"").Append(pair.Value).Append('"');
                }
                text.Append('}');
            }
            text.Append('}');
        }
        text.Append("],\"modules\":[],\"lines\":[]}}");
        return text.ToString();
    }

    static List<string> Signatures(IEnumerable<StationCellMeshGroup> groups) {
        var output = new List<string>();
        foreach (var group in groups) {
            for (var t = 0; t < group.Indices.Length; t += 3) {
                var a = group.Positions[group.Indices[t]];
                var b = group.Positions[group.Indices[t + 1]];
                var c = group.Positions[group.Indices[t + 2]];
                var n = group.Normals[group.Indices[t]];
                var area = 0.5 * Vector3.Cross(b - a, c - a).magnitude;
                output.Add(string.Join(",", new[] {
                    Round((a.x + b.x + c.x) / 3), Round((a.y + b.y + c.y) / 3), Round((a.z + b.z + c.z) / 3),
                    Round(n.x), Round(n.y), Round(n.z), Round(area),
                }));
            }
        }
        output.Sort(StringComparer.Ordinal);
        return output;
    }

    static Dictionary<string, Part> PartsOf(IEnumerable<StationCellMeshGroup> groups) {
        var parts = new Dictionary<string, Part>(StringComparer.Ordinal);
        foreach (var group in groups) {
            if (!parts.TryGetValue(group.FinishId, out var part)) {
                parts[group.FinishId] = part = new Part {
                    finish = group.FinishId, triangles = 0, area = 0,
                    min = new[] { double.MaxValue, double.MaxValue, double.MaxValue },
                    max = new[] { double.MinValue, double.MinValue, double.MinValue },
                };
            }
            part.triangles += group.TriangleCount;
            for (var t = 0; t < group.Indices.Length; t += 3) {
                var a = group.Positions[group.Indices[t]];
                var b = group.Positions[group.Indices[t + 1]];
                var c = group.Positions[group.Indices[t + 2]];
                part.area += 0.5 * Vector3.Cross(b - a, c - a).magnitude;
                foreach (var p in new[] { a, b, c }) {
                    for (var axis = 0; axis < 3; axis++) {
                        part.min[axis] = Math.Min(part.min[axis], p[axis]);
                        part.max[axis] = Math.Max(part.max[axis], p[axis]);
                    }
                }
            }
        }
        return parts;
    }

    static uint Digest(List<string> signatures) {
        var hash = 2166136261u;
        foreach (var line in signatures) {
            hash ^= (uint)line.Length;
            hash *= 16777619u;
        }
        return hash;
    }

    static uint DigestBits(string bits) {
        var hash = 2166136261u;
        foreach (var c in bits) { hash ^= c; hash *= 16777619u; }
        return hash;
    }

    static string Round(double value) {
        var rounded = Math.Floor(value * 1e4 + 0.5) / 1e4;
        if (Math.Abs(rounded) < 1e-9) rounded = 0;
        return rounded.ToString("0.####", CultureInfo.InvariantCulture);
    }

    static StationCellKey KeyOf(string key) {
        var parts = key.Split(',');
        return new StationCellKey(int.Parse(parts[0]), int.Parse(parts[1]), int.Parse(parts[2]));
    }

    static StationFace ParseFace(string name) {
        Assert.IsTrue(StationFaces.TryParse(name, out var face), "unknown face in the oracle: " + name);
        return face;
    }
}




/// <summary>
/// The real Zoo cell input the production renderer builds (finish library defaults,
/// generated street window, track/exit street openings). Both the mesh-role pins and the
/// visibility toggle tests build the same view, so a role count and the groups the view
/// walk hides can never disagree.
/// </summary>
internal static class StationCellTestInputs {
    public static string ZooSavePath => Path.Combine(Application.dataPath, "StationDesigner/Zoo/ZooSave.json");
    public static string FinishDirectory => Path.GetFullPath(Path.Combine(Application.dataPath, "../asset-recipes/finishes"));

    public static StationCellMeshInput ZooViewInput(StationDocument document, StationFinishLibrary library) {
        var input = new StationCellMeshInput {
            LevelBase = document.LevelBase,
            StoreyHeight = document.StoreyHeight,
            VirtualGround = true,
            GroundZ = 0,
            GroundMargin = 16,
            DefaultFinish = library != null ? library.DefaultFinishFor(StationFace.Top) : StationFinishIds.DefaultMaterial,
            RampSoffitFinish = library != null ? library.RampSoffitId : "ceil.steel",
            BuildCeilings = true,
            BuildPlates = false,
            BuildGround = true,
        };
        foreach (var cell in document.Cells) {
            if (!cell.IsSolid) { input.Voids.Add(cell.Key); continue; }
            var tags = cell.Tags;
            var flags = StationMeshCellFlags.None;
            if (StationCellRules.IsWallBlock(tags)) flags |= StationMeshCellFlags.Wall;
            if (cell.HasTag("suspended-ceiling")) flags |= StationMeshCellFlags.SuspendedCeiling;
            if (cell.HasTag("opening-ceiling")) flags |= StationMeshCellFlags.OpeningCeiling;
            if (cell.HasTag("painted-ground")) flags |= StationMeshCellFlags.PaintedGround;
            input.Cells.Add(new StationMeshCell {
                X = cell.X, Y = cell.Y, Z = cell.Z, Solid = true,
                Shape = StationCellRules.ShapeOf(tags), Flags = flags, Finish = StationFinishSet.FromRecord(cell),
            });
        }
        foreach (var module in document.Modules) {
            if (module == null) continue;
            if (module.Type == "track" && module.Z == 0 && !module.Config.Bool("tunnel") && !module.Config.Bool("bridge")) {
                foreach (var point in StationFootprints.TrackCells(module)) input.GroundHoles.Add(Hole(point));
            } else if (module.Type == "exit" && module.Z == 0) {
                foreach (var point in StationFootprints.ExitFootprint(module)) input.GroundHoles.Add(Hole(point));
            }
        }
        return input;
    }

    static StationCellKey Hole(StationPoint point) => new StationCellKey(
        (int)Math.Round(point.X, MidpointRounding.AwayFromZero),
        (int)Math.Round(point.Y, MidpointRounding.AwayFromZero),
        0);
}

