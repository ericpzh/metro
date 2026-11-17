using System;
using System.Collections.Generic;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 27 §6: the bore's own structure (`build/model/TunnelShell.ts`). Boring a 隧道 clears
    /// the rock above its bed and walls the cut with an owned shell, and lifting the bore strips
    /// exactly that shell  the tag is the bore's own, distinct from derived auto-walls.
    /// </summary>
    public sealed class StationTunnelShellTests {
        StationGameHost host;
        GameObject hostObject;

        [SetUp]
        public void SetUp() {
            StationEditSession.Reset();
            StationToolSelection.Reset();
            hostObject = new GameObject(StationGameHost.ObjectName);
            host = hostObject.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            var awake = typeof(StationGameHost).GetMethod("Awake",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            awake.Invoke(host, null);
            var opened = host.OpenDocument(Save(), "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
        }

        [TearDown]
        public void TearDown() {
            StationEditHost.ResetForTests();
            if (hostObject != null) UnityEngine.Object.DestroyImmediate(hostObject);
            hostObject = null;
            host = null;
            StationEditSession.Reset();
            StationToolSelection.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        /// <summary>
        /// A 12 × 12 slab at 0 with a 3 m rock layer over a six-cell strip at y = 5, and one rail
        /// ending at (6, 5) so a bore can be hung off it.
        /// </summary>
        static string Save() {
            var cells = new JArray();
            for (int x = 0; x < 12; x++) {
                for (int y = 0; y < 12; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            for (int x = 0; x < 12; x++) {
                for (int y = 5; y < 6; y++) {
                    for (int z = 1; z <= 3; z++) {
                        cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = "solid" });
                    }
                }
            }
            var modules = new JArray {
                new JObject {
                    ["id"] = "track-source", ["type"] = "track", ["x"] = 2, ["y"] = 5, ["z"] = 0,
                    ["rot"] = 0, ["w"] = 4, ["d"] = 1, ["cfg"] = new JObject { ["line"] = "1", ["power"] = "third-rail" },
                },
            };
            return new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Tunnel fixture", ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 1234567,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = modules, ["lines"] = new JArray() },
            }.ToString(Newtonsoft.Json.Formatting.None);
        }

        StationModuleRecord Source() {
            foreach (var module in host.Index.Document.Modules) if (module.Id == "track-source") return module;
            return null;
        }

        bool HasTag(int x, int y, int z, string tag) {
            foreach (var cell in host.Index.Document.Cells) {
                if (cell.X != x || cell.Y != y || cell.Z != z) continue;
                foreach (var cellTag in cell.Tags) if (cellTag == tag) return true;
            }
            return false;
        }

        [Test]
        public void BoringClearsTheRockAndWallsTheCutInOneRevision() {
            StationToolSelection.TrySelect("tunnel", out _, out _);
            StationToolSelection.ApplySettings(new JObject { ["tunnelLength"] = 8 });
            int revision = host.CurrentRevision;
            Assert.IsTrue(StationTunnelTool.Begin(host, StationCellFixture.Hit(5, 5, 0, true),
                StationPointerEvent.Synthetic(100, 100, 800, 600, button: 0, timeMs: 0), 0, out var code, out var reason),
                code ?? reason);
            Assert.AreEqual(revision + 1, host.CurrentRevision, "the track and its shell are one gesture");
            // The rock over the bore is gone; the cut is walled and roofed with the owned tag.
            string trackId = null;
            foreach (var module in host.Index.Document.Modules) if (module.Type == "track" && module.Id != "track-source") trackId = module.Id;
            Assert.IsNotNull(trackId, "a bore was added");
            string tag = StationTunnelShell.Tag(trackId);
            bool anyShell = false, anyRockAbove = false;
            foreach (var cell in host.Index.Document.Cells) {
                foreach (var cellTag in cell.Tags) if (cellTag == tag) anyShell = true;
                if (cell.Z > 0 && cell.Z <= 3 && cell.X >= 6 && cell.Y == 5) anyRockAbove = true;
            }
            Assert.IsTrue(anyShell, "the bore is walled with its own shell tag");
            Assert.IsFalse(anyRockAbove, "the rock over the bore is cleared");
        }

        [Test]
        public void BoringThenLiftingTheBoreRestoresTheCells() {
            StationToolSelection.TrySelect("tunnel", out _, out _);
            StationToolSelection.ApplySettings(new JObject { ["tunnelLength"] = 8 });
            Assert.IsTrue(StationTunnelTool.Begin(host, StationCellFixture.Hit(5, 5, 0, true),
                StationPointerEvent.Synthetic(100, 100, 800, 600, button: 0, timeMs: 0), 0, out var code, out var reason),
                code ?? reason);
            int afterBore = host.Index.Document.Cells.Count;
            // The secondary press on the bored rail lifts it and strips its shell.
            Assert.IsTrue(StationTunnelTool.Begin(host, StationCellFixture.Hit(8, 5, 0, true),
                StationPointerEvent.Synthetic(100, 100, 800, 600, button: 2, timeMs: 100), 2, out code, out reason),
                code ?? reason);
            bool anyShell = false;
            foreach (var cell in host.Index.Document.Cells)
                foreach (var cellTag in cell.Tags)
                    if (cellTag.StartsWith(StationTunnelShell.TagRoot + ":", StringComparison.Ordinal)) anyShell = true;
            Assert.IsFalse(anyShell, "the shell is stripped with its bore");
            Assert.Less(host.Index.Document.Cells.Count, afterBore, "and the cut cells are gone");
        }
    }
}
