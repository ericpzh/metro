using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace Metro.EditModeTests {
    /// <summary>
    /// The saved paved tiles (`sidewalk` / `lawn`) are what makes a walkway a walkway, and Tanwei
    /// stores them as **modules** — there is no cell under them at all. The tile exclusion may drop
    /// one only for a dug void, an exit head-house's plate, or a ramp corridor that actually crosses
    /// the street plane. A run's **grade landing is not an opening**: it is the authored pavement
    /// the player steps onto the run from. Hiding it deleted a one-cell strip of saved `sidewalk` in
    /// front of every at-grade stair, so a block stair's terrace showed a bare grey band (the
    /// virtual ground's concrete) where the JSON has a filled, paved area.
    /// </summary>
    public sealed class StationSurfaceHiddenTests {
        static StationDocument Document(JArray modules, JArray cells = null) => StationDocumentReader.Read(new JObject {
            ["format"] = StationDocumentReader.SaveFormat,
            ["formatVersion"] = StationDocumentReader.SupportedVersion,
            ["savedAt"] = StationDocumentReader.FixedSavedAt,
            ["name"] = "surface hidden probe",
            ["city"] = "guangzhou",
            ["seed"] = 7,
            ["levelBase"] = 0,
            ["storeyHeight"] = 5,
            ["static"] = new JObject {
                ["cells"] = cells ?? new JArray(),
                ["modules"] = modules,
                ["lines"] = new JArray(),
            },
        }.ToString(Newtonsoft.Json.Formatting.None), new StationSource("surface hidden", "")).Document;

        static JObject Stair(string id, int x, int y, int z, int toX, int toY, int toZ, bool block) => new JObject {
            ["id"] = id, ["type"] = "stair", ["x"] = x, ["y"] = y, ["z"] = z, ["w"] = 1, ["rot"] = 0,
            ["from"] = new JObject { ["x"] = x, ["y"] = y, ["z"] = z },
            ["to"] = new JObject { ["x"] = toX, ["y"] = toY, ["z"] = toZ },
            ["cfg"] = new JObject { ["width"] = 1, ["block"] = block, ["blockHeight"] = 1 },
        };

        static JObject Tile(string id, string type, int x, int y, int z) => new JObject {
            ["id"] = id, ["type"] = type, ["x"] = x, ["y"] = y, ["z"] = z, ["w"] = 1, ["rot"] = 0,
            ["cfg"] = new JObject(),
        };

        static JObject Cell(int x, int y, int z, string fill) => new JObject {
            ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = fill,
        };

        static StationSurfaceModuleRenderer.SurfaceHidden Hidden(StationDocument document) {
            var facts = new ModuleFacts[document.Modules.Count];
            for (int i = 0; i < facts.Length; i++) facts[i] = document.Modules[i].Facts;
            return new StationSurfaceModuleRenderer.SurfaceHidden(document, facts);
        }

        static ModuleFacts Module(StationDocument document, string id) {
            for (int i = 0; i < document.Modules.Count; i++) {
                if (string.Equals(document.Modules[i].Id, id, System.StringComparison.Ordinal)) return document.Modules[i].Facts;
            }
            Assert.Fail("module not found: " + id);
            return null;
        }

        [Test]
        public void ABlockStairKeepsTheSavedSidewalkAtItsLanding() {
            // The terrace stands on the pavement: (2,3) is the block, (2,2) is the sidewalk tile in
            // front of it — the cell the run "lands" on.
            var document = Document(new JArray {
                Stair("stair-block-1", 2, 3, 0, 2, 4, 1, block: true),
                Tile("sidewalk-1", "sidewalk", 2, 2, 0),
            });
            var hidden = Hidden(document);
            Assert.IsFalse(hidden.IsHidden(Module(document, "sidewalk-1"), out var reason),
                "the saved sidewalk in front of a block stair must draw (reason: " + reason + ")");
        }

        [Test]
        public void AStairClimbingFromTheStreetKeepsTheSavedSidewalkAtItsFoot() {
            var document = Document(new JArray {
                Stair("stair-straight-1", 6, 3, 0, 12, 3, 6, block: false),
                Tile("sidewalk-1", "sidewalk", 6, 3, 0),
            });
            var hidden = Hidden(document);
            Assert.IsFalse(hidden.IsHidden(Module(document, "sidewalk-1"), out var reason),
                "the pavement at a stair's foot is the landing, not an opening (reason: " + reason + ")");
        }

        [Test]
        public void ADugVoidStillHidesItsTile() {
            var document = Document(
                new JArray { Tile("sidewalk-1", "sidewalk", 5, 2, 0) },
                new JArray { Cell(5, 2, 0, "void") });
            var hidden = Hidden(document);
            Assert.IsTrue(hidden.IsHidden(Module(document, "sidewalk-1"), out var reason),
                "a tile over a dug void must not draw");
            Assert.AreEqual("void", reason);
        }
    }
}
