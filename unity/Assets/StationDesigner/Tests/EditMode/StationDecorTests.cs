using System;
using System.Collections.Generic;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 27 §5: the surface decor families the 装饰 palette arms directly  the street tree,
    /// the bus shelter, the air-conditioning unit, the equipment cabinet and the rail signal.
    /// Each is a plain placement with the reference's own creation rule and block test.
    /// </summary>
    public sealed class StationDecorTests {
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
            var opened = host.OpenDocument(StationCellFixture.Save, "file");
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

        static StationPlacementRequest Request(string type, int x, int y, int z) =>
            new StationPlacementRequest {
                ToolType = type,
                Rotation = 0,
                Hit = StationCellFixture.Hit(x, y, z, true).Cell,
            };

        [Test]
        public void ThePreviewPublishesItsFootprintMeasure() {
            // The pointer's size label is `cells.measure` on the bridge: the footprint badge in
            // metres (1 cell = 1 m). The presenter is what draws it; this pins the payload.
            var preview = new StationCellPreview { Kind = "add", Length = 3, Width = 4 };
            var json = preview.ToJson();
            Assert.IsNotNull(json);
            Assert.AreEqual(3, (int)json["measure"]["length"], "length in metres");
            Assert.AreEqual(4, (int)json["measure"]["width"], "width in metres");
        }

        [Test]
        public void AStreetTreePlacesOnTheSurface() {
            var plan = StationModulePlacement.Resolve(host.Index, Request("tree", 4, 4, 0));
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.AreEqual("tree", plan.Candidate.Type);
        }

        [Test]
        public void ABusShelterIsFourOrEightCellsLongAndTwoDeep() {
            var longShelter = StationModulePlacement.Resolve(host.Index, Request("busstop-long", 5, 5, 0));
            Assert.IsTrue(longShelter.Ok, longShelter.Reason);
            Assert.AreEqual("busstop", longShelter.Candidate.Type);
            Assert.AreEqual(8, longShelter.Candidate.Width);
            Assert.AreEqual(2, longShelter.Candidate.Depth);
            Assert.AreEqual("long", longShelter.Candidate.Text("variant"));
            Assert.AreEqual(2, longShelter.Candidate.X, "an eight-cell run is centred on the aim");
            var shortShelter = StationModulePlacement.Resolve(host.Index, Request("busstop-short", 5, 5, 0));
            Assert.IsTrue(shortShelter.Ok, shortShelter.Reason);
            Assert.AreEqual(4, shortShelter.Candidate.Width);
            Assert.AreEqual("short", shortShelter.Candidate.Text("variant"));
        }

        [Test]
        public void SurfaceDecorNeverGrowsBelowTheStreet() {
            var plan = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                ToolType = "tree",
                Rotation = 0,
                Hit = new StationPlacementHit(4, 4, -1, 4, 4, 0, true, new StationPoint(4.5, 4.5, 0), 0),
            });
            Assert.IsFalse(plan.Ok);
            Assert.AreEqual("outdoor-below-ground", plan.Reason);
        }

        [Test]
        public void AHangerCarriesItsMountAndItsRun() {
            // A roof hanger hangs from the slab above its **origin** cell, which for a four-cell
            // run centred on the aim is the run's first cell  so the slab spans the run.
            var world = StationCellEditWorld.Build(host.Index);
            var slabs = new List<StationCellKey>();
            for (int x = 3; x <= 6; x++) slabs.Add(new StationCellKey(x, 4, 5));
            var slab = StationCellPlanner.PlanAddCells(world, slabs);
            Assert.IsTrue(StationEditSession.TryApplyCells(host, slab, "place", null, out _, out var slabCode), slabCode);
            var roof = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                ToolType = "hanger-roof", Rotation = 0, Width = 4,
                Hit = StationCellFixture.Hit(4, 4, 0, true).Cell,
            });
            // With the slab over the run, the hanger's own support rule is satisfied too.
            Assert.IsTrue(roof.Ok, roof.Reason);
            Assert.IsNotNull(roof.Candidate);
            Assert.AreEqual("hanger", roof.Candidate.Type);
            Assert.AreEqual("roof", roof.Candidate.Text("mount"), "the roof hanger hangs from the slab");
            Assert.AreEqual(4, roof.Candidate.Width, "four cells unless the tool asks for more");
            Assert.AreEqual(3, roof.Candidate.X, "and the run is centred on the aim");
            var post = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                ToolType = "hanger-post", Rotation = 0, Width = 8,
                Hit = StationCellFixture.Hit(4, 4, 0, true).Cell,
            });
            // The post hanger needs its own post under the bar; the candidate is what this
            // proves  its mount and its run  whether or not a support stands there yet.
            Assert.IsNotNull(post.Candidate);
            Assert.AreEqual("post", post.Candidate.Text("mount"));
            Assert.AreEqual(8, post.Candidate.Width, "the tool can ask for the widest span");
        }

        [Test]
        public void ADoubleSidedScreenIsTheSameTvRecord() {
            var plan = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                ToolType = "tv-double", Rotation = 0,
                Hit = StationCellFixture.Hit(4, 4, 0, true).Cell,
            });
            Assert.IsNotNull(plan.Candidate);
            Assert.AreEqual("tv", plan.Candidate.Type, "the palette names the faces; the record is a tv");
        }

        [Test]
        public void AShelfRunFillsTheCellsItsVariantNames() {
            var books = StationModulePlacement.Resolve(host.Index, Request("shelf-books", 4, 4, 0));
            Assert.IsTrue(books.Ok, books.Reason);
            Assert.AreEqual("shelf", books.Candidate.Type);
            Assert.AreEqual(2, books.Candidate.Width, "bookshelves fill two cells");
            Assert.AreEqual("books", books.Candidate.Text("variant"));
            var tall = StationModulePlacement.Resolve(host.Index, Request("shelf-dark-tall", 4, 4, 0));
            Assert.AreEqual(1, tall.Candidate.Width, "and a tall dark shelf one");
        }

        [Test]
        public void ACheckoutTakesTheToolsRunLengthClampedToTheCatalogue() {
            var plan = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                ToolType = "checkout-wood", Rotation = 0, Width = 3,
                Hit = StationCellFixture.Hit(4, 4, 0, true).Cell,
            });
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.AreEqual("checkout", plan.Candidate.Type);
            Assert.AreEqual(3, plan.Candidate.Width, "a three-metre counter fills three cells");
            Assert.AreEqual("wood", plan.Candidate.Text("variant"));
            var tooLong = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                ToolType = "checkout", Rotation = 0, Width = 99,
                Hit = StationCellFixture.Hit(4, 4, 0, true).Cell,
            });
            Assert.AreEqual(4, tooLong.Candidate.Width, "and the run is clamped to the longest counter");
        }

        [Test]
        public void AnAirConditionerRefusesABlockInItsOwnCourse() {
            var plan = StationModulePlacement.Resolve(host.Index, Request("ac-unit", 4, 4, 0));
            Assert.IsTrue(plan.Ok, plan.Reason);
            // A block poured into the course the unit occupies refuses the placement.
            var world = StationCellEditWorld.Build(host.Index);
            var block = StationCellPlanner.PlanAddCells(world, new[] { new StationCellKey(4, 4, 1) });
            Assert.IsTrue(StationEditSession.TryApplyCells(host, block, "place", null, out _, out var code), code);
            var blocked = StationModulePlacement.Resolve(host.Index, Request("ac-unit", 4, 4, 0));
            Assert.IsFalse(blocked.Ok);
            Assert.AreEqual("occupied", blocked.Reason);
        }
    }
}
