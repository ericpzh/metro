using Metro.App;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    public sealed class StationDesktopCursorsTests {
        [TearDown]
        public void TearDown() {
            StationDesktopCursors.DisposeCache();
        }

        [Test]
        public void NormalizeNameMapsSupportedAndAliasesAndRejectsUnknown() {
            Assert.AreEqual("default", StationDesktopCursors.NormalizeName(null));
            Assert.AreEqual("default", StationDesktopCursors.NormalizeName(""));
            Assert.AreEqual("default", StationDesktopCursors.NormalizeName("auto"));
            Assert.AreEqual("default", StationDesktopCursors.NormalizeName("url(foo.png)"));
            Assert.AreEqual("none", StationDesktopCursors.NormalizeName("NONE"));
            Assert.AreEqual("crosshair", StationDesktopCursors.NormalizeName(" crosshair "));
            Assert.AreEqual("pointer", StationDesktopCursors.NormalizeName("pointer"));
            Assert.AreEqual("grab", StationDesktopCursors.NormalizeName("grab"));
            Assert.AreEqual("grabbing", StationDesktopCursors.NormalizeName("grabbing"));
            Assert.AreEqual("move", StationDesktopCursors.NormalizeName("all-scroll"));
            Assert.AreEqual("ew-resize", StationDesktopCursors.NormalizeName("col-resize"));
            Assert.AreEqual("ns-resize", StationDesktopCursors.NormalizeName("row-resize"));
            Assert.AreEqual("not-allowed", StationDesktopCursors.NormalizeName("not-allowed"));
        }

        [Test]
        public void AllCustomCursorSpecsHaveValidDimensionsAndHotspots() {
            string[] names = {
                "crosshair", "pointer", "grab", "grabbing", "move",
                "text", "ew-resize", "ns-resize", "not-allowed",
            };
            foreach (var name in names) {
                Assert.IsTrue(StationDesktopCursors.TryGetSpec(name, out var rows, out var hotspot), name + " spec missing");
                Assert.IsNotNull(rows, name + " rows null");
                Assert.AreEqual(StationDesktopCursors.Size, rows.Length, name + " row count");
                Assert.GreaterOrEqual(hotspot.x, 0f, name + " hotspot.x >= 0");
                Assert.Less(hotspot.x, StationDesktopCursors.Size, name + " hotspot.x < size");
                Assert.GreaterOrEqual(hotspot.y, 0f, name + " hotspot.y >= 0");
                Assert.Less(hotspot.y, StationDesktopCursors.Size, name + " hotspot.y < size");
                int visiblePixels = 0;
                for (int y = 0; y < rows.Length; y++) {
                    Assert.AreEqual(StationDesktopCursors.Size, rows[y].Length, $"{name} row {y} length");
                    for (int x = 0; x < rows[y].Length; x++) {
                        if (rows[y][x] != '.') visiblePixels++;
                    }
                }
                Assert.Greater(visiblePixels, 20, name + " has visible sprite pixels");
            }

            Assert.IsFalse(StationDesktopCursors.TryGet("default", out _, out _));
            Assert.IsFalse(StationDesktopCursors.TryGet("none", out _, out _));
        }

        [Test]
        public void TryGetBuildsAndCachesRgba32CursorTexturesAndScalesWithUiScale() {
            Assert.AreEqual(24, StationDesktopCursors.ResolvePixelSize(0.75f));
            Assert.AreEqual(32, StationDesktopCursors.ResolvePixelSize(1f));
            Assert.AreEqual(40, StationDesktopCursors.ResolvePixelSize(1.25f));
            Assert.AreEqual(48, StationDesktopCursors.ResolvePixelSize(1.5f));
            Assert.AreEqual(32, StationDesktopCursors.ResolvePixelSize(float.NaN));

            Assert.IsTrue(StationDesktopCursors.TryGet("crosshair", out var tex1, out var hot1));
            Assert.IsNotNull(tex1);
            Assert.AreEqual(StationDesktopCursors.Size, tex1.width);
            Assert.AreEqual(StationDesktopCursors.Size, tex1.height);
            Assert.AreEqual(TextureFormat.RGBA32, tex1.format);
            Assert.AreEqual(new Vector2(15f, 15f), hot1);

            Assert.IsTrue(StationDesktopCursors.TryGet("crosshair", 1f, out var tex2, out _));
            Assert.AreSame(tex1, tex2, "cursor texture should be cached");

            Assert.IsTrue(StationDesktopCursors.TryGet("crosshair", 1.5f, out var texScaled, out var hotScaled));
            Assert.IsNotNull(texScaled);
            Assert.AreEqual(48, texScaled.width);
            Assert.AreEqual(48, texScaled.height);
            Assert.AreEqual(new Vector2(22f, 22f), hotScaled);
        }
    }
}
