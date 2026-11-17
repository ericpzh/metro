using System;
using System.Collections.Generic;
using Metro.App.Views;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 30 §4 — the browser-painted station-name plate.
    ///
    /// Three rules are pinned here, all without a scene, a canvas or a browser:
    ///
    ///  * the cache identity is the artwork's content key **plus** the shared manifest
    ///    version and the plate's measured orientation, so a rename, a manifest bump or a
    ///    mirrored plate is a different texture;
    ///  * a chunked `calligraphy.faceReady` reply is assembled only when every slice
    ///    arrived, and a reply from another session or an older revision is fenced;
    ///  * the cache swaps a browser-painted panel into the material the plate already
    ///    wears, reports a missing face, and paints natively — once, into the same
    ///    material — when no transport could deliver the request (the headless fallback).
    /// </summary>
    public sealed class StationCalligraphyBridgeTests {
        const string Session = "session-calligraphy";

        sealed class FakeProvider : IStationCalligraphyFaceProvider {
            public readonly List<StationCalligraphyFaceBatch> Batches = new List<StationCalligraphyFaceBatch>();
            public bool Publish = true;
            readonly Queue<StationCalligraphyFaceResponse> completed = new Queue<StationCalligraphyFaceResponse>();

            public bool Request(StationCalligraphyFaceBatch batch) {
                Batches.Add(batch);
                return Publish;
            }

            public bool TryTake(out StationCalligraphyFaceResponse response) {
                if (completed.Count == 0) { response = null; return false; }
                response = completed.Dequeue();
                return true;
            }

            public void Complete(StationCalligraphyFaceResponse response) => completed.Enqueue(response);
            public void Cancel(string requestId) { }
            public void Dispose() { }
        }

        readonly List<UnityEngine.Object> owned = new List<UnityEngine.Object>();
        readonly List<GameObject> objects = new List<GameObject>();

        [TearDown]
        public void TearDown() {
            for (int i = 0; i < objects.Count; i++) if (objects[i]) UnityEngine.Object.DestroyImmediate(objects[i]);
            for (int i = 0; i < owned.Count; i++) if (owned[i]) UnityEngine.Object.DestroyImmediate(owned[i]);
            objects.Clear();
            owned.Clear();
        }

        /* ------------------------------------------------------------- harness */

        static StationCalligraphyFaceRequest Request(string text = "动物园", string style = "wei") =>
            new StationCalligraphyFaceRequest {
                ModuleId = "calligraphy-" + style + "-h-365",
                Text = text,
                English = "Zoo",
                Style = style,
                Axis = "h",
                PanelWidth = .5f,
                PanelHeight = .5f,
            };

        /// <summary>
        /// A real PNG of the plate's size, as the browser's canvas would encode it. The
        /// pixels are a deterministic hash pattern rather than one flat colour so the encoded
        /// PNG is large enough to exercise the multi-slice transport (a flat colour compresses
        /// to a single chunk).
        /// </summary>
        byte[] Png(int width, int height) {
            var source = new Texture2D(width, height, TextureFormat.RGBA32, false);
            owned.Add(source);
            var pixels = new Color32[width * height];
            for (int i = 0; i < pixels.Length; i++) {
                uint hash = (uint)i * 2654435761u;
                pixels[i] = new Color32((byte)(hash >> 24), (byte)(hash >> 16), (byte)(hash >> 8), 255);
            }
            source.SetPixels32(pixels);
            source.Apply(false, false);
            return source.EncodeToPNG();
        }

        StationCalligraphyFaceBinding Binding(StationCalligraphyFaceRequest request, Func<Texture2D> nativePaint) {
            var go = new GameObject("calligraphy bridge " + request.ModuleId);
            objects.Add(go);
            var renderer = go.AddComponent<MeshRenderer>();
            var placeholder = StationCalligraphyArtwork.CreateTransparentTexture();
            owned.Add(placeholder);
            var material = StationCalligraphyArtwork.CreateInkMaterial(placeholder);
            if (material != null) owned.Add(material);
            return new StationCalligraphyFaceBinding {
                ModuleId = request.ModuleId,
                Style = request.Style,
                Axis = request.Axis,
                Renderer = renderer,
                Material = material,
                NativePaint = nativePaint,
            };
        }

        /* ----------------------------------------------------------- identity */

        [Test]
        public void TheCacheKeyCarriesContentManifestVersionAndOrientation() {
            var baseline = Request();
            var renamed = Request("测试站");
            var otherHand = Request("动物园", "kai");
            var wider = Request();
            wider.PanelWidth = 1f;
            var mirrored = Request();
            mirrored.MirrorU = true;
            var flipped = Request();
            flipped.FlipV = true;

            StringAssert.Contains("calligraphy|动物园|", baseline.Key, "the artwork's content key is the base");
            StringAssert.Contains("font=" + StationCalligraphyArtwork.FontVersion, baseline.Key,
                "the shared manifest version is part of the identity");
            Assert.AreNotEqual(baseline.Key, renamed.Key, "a rename is a different plate");
            Assert.AreNotEqual(baseline.Key, otherHand.Key, "the hand is part of the key");
            Assert.AreNotEqual(baseline.Key, wider.Key, "the panel is part of the key");
            Assert.AreNotEqual(baseline.Key, mirrored.Key, "a U-mirrored plate needs its own pixels");
            Assert.AreNotEqual(baseline.Key, flipped.Key, "a V-flipped plate needs its own pixels");
            Assert.AreNotEqual(mirrored.Key, flipped.Key);
            Assert.AreEqual(baseline.Key, Request().Key, "the same content is the same texture");
            StringAssert.Contains("u1", mirrored.Key);
            StringAssert.Contains("v1", flipped.Key);
            // `calligraphyPlate`: 512 px per metre, never below 64.
            Assert.AreEqual(256, baseline.PlateWidth);
            Assert.AreEqual(256, baseline.PlateHeight);
        }

        [Test]
        public void TheRequestEnvelopeNamesTheFaceAndTheMeasuredOrientation() {
            string sent = null;
            var provider = new StationCalligraphyWebProvider(json => { sent = json; return true; },
                () => new StationCalligraphyFaceContext { SessionId = Session, Revision = 7 });
            var request = Request();
            request.MirrorU = true;
            request.FlipV = false;
            request.ShowEnglish = true;
            Assert.IsTrue(provider.Request(new StationCalligraphyFaceBatch {
                RequestId = "calligraphy-req-1", Faces = new[] { request },
            }), "the request is published when a transport accepts it");
            Assert.IsNotNull(sent, "a request was sent");
            var envelope = JObject.Parse(sent);
            Assert.AreEqual(2, (int)envelope["schemaVersion"]);
            Assert.AreEqual("calligraphyRequest", (string)envelope["kind"]);
            Assert.AreEqual("calligraphy.requestFace", (string)envelope["type"]);
            Assert.AreEqual(7, (int)envelope["revision"]);
            var face = (JObject)envelope["payload"]["faces"][0];
            Assert.AreEqual(request.Key, (string)face["key"], "the shell echoes the cache identity");
            Assert.AreEqual("动物园", (string)face["text"]);
            Assert.AreEqual("Zoo", (string)face["english"]);
            Assert.AreEqual(true, (bool)face["mirrorU"]);
            Assert.AreEqual(false, (bool)face["flipV"]);
            Assert.AreEqual(true, (bool)face["showEnglish"]);
            Assert.AreEqual(.5f, (float)face["w"]);
            Assert.AreEqual(.5f, (float)face["h"]);
            // A provider with no route reports the failure instead of pretending it sent it.
            var unreachable = new StationCalligraphyWebProvider(_ => false, () => new StationCalligraphyFaceContext());
            Assert.IsFalse(unreachable.Request(new StationCalligraphyFaceBatch {
                RequestId = "calligraphy-req-2", Faces = new[] { request },
            }));
            Assert.AreEqual(1, unreachable.DroppedRequests);
        }

        [Test]
        public void AChunkedReplyIsAssembledOnceEverySliceAndTheCompletionArrive() {
            string sent = null;
            var provider = new StationCalligraphyWebProvider(json => { sent = json; return true; },
                () => new StationCalligraphyFaceContext { SessionId = Session, Revision = 7 });
            var request = Request();
            provider.Request(new StationCalligraphyFaceBatch { RequestId = "calligraphy-req-a", Faces = new[] { request } });
            var png = Png(request.PlateWidth, request.PlateHeight);
            var base64 = Convert.ToBase64String(png);
            const int chunkSize = 16384;
            var count = Math.Max(1, (base64.Length + chunkSize - 1) / chunkSize);
            Assert.Greater(count, 1, "the fixture PNG must take more than one slice for this test");
            // Only a prefix of the slices arrives with the completion: the reply is not usable.
            Assert.IsTrue(provider.Receive(Chunk("calligraphy-req-a", request, base64, count, 0, 7, Session, chunkSize)));
            Assert.IsTrue(provider.Receive(Ready("calligraphy-req-a", request, png.Length, count, 7, Session, "STXinwei", false)));
            Assert.IsTrue(provider.TryTake(out var incomplete));
            Assert.AreEqual(0, incomplete.Painted.Length, "an incomplete assembly is never uploaded");
            // The full set assembles (a duplicate slice is ignored, not double-counted).
            provider.Request(new StationCalligraphyFaceBatch { RequestId = "calligraphy-req-b", Faces = new[] { request } });
            for (int index = 0; index < count; index++) {
                provider.Receive(Chunk("calligraphy-req-b", request, base64, count, index, 7, Session, chunkSize));
                if (index == 0) provider.Receive(Chunk("calligraphy-req-b", request, base64, count, 0, 7, Session, chunkSize));
            }
            Assert.IsTrue(provider.Receive(Ready("calligraphy-req-b", request, png.Length, count, 7, Session, "STXinwei", false)));
            Assert.IsTrue(provider.TryTake(out var reply));
            Assert.AreEqual(1, reply.Painted.Length);
            Assert.AreEqual(request.Key, reply.Painted[0].Key);
            Assert.AreEqual("STXinwei", reply.Painted[0].ResolvedFamily, "the completion names the resolved face");
            Assert.AreEqual(false, reply.Painted[0].MissingFace);
            CollectionAssert.AreEqual(png, reply.Painted[0].Png);
            Assert.AreEqual(StationCalligraphyArtwork.FontVersion, reply.ManifestVersion);
            // The duplicate request id is consumed, not re-applied.
            Assert.IsFalse(provider.TryTake(out _));
        }

        [Test]
        public void AForeignSessionOrAnOlderRevisionIsFenced() {
            var provider = new StationCalligraphyWebProvider(_ => true,
                () => new StationCalligraphyFaceContext { SessionId = Session, Revision = 7 });
            var request = Request();
            var png = Png(request.PlateWidth, request.PlateHeight);
            var base64 = Convert.ToBase64String(png);
            provider.Request(new StationCalligraphyFaceBatch { RequestId = "calligraphy-req-a", Faces = new[] { request } });
            Assert.IsTrue(provider.Receive(Chunk("calligraphy-req-a", request, base64, 1, 0, 7, "another-session", 2048)));
            Assert.IsTrue(provider.Receive(Ready("calligraphy-req-a", request, png.Length, 1, 7, "another-session", "STXinwei", false)));
            Assert.IsFalse(provider.TryTake(out _), "a reply from another session is a picture of another player's station");
            Assert.AreEqual(1, provider.FencedReplies);

            provider.Request(new StationCalligraphyFaceBatch { RequestId = "calligraphy-req-b", Faces = new[] { request } });
            Assert.IsTrue(provider.Receive(Chunk("calligraphy-req-b", request, base64, 1, 0, 3, Session, 2048)));
            Assert.IsTrue(provider.Receive(Ready("calligraphy-req-b", request, png.Length, 1, 3, Session, "STXinwei", false)));
            Assert.IsFalse(provider.TryTake(out _), "a reply painted for an older revision is stale");
            Assert.AreEqual(2, provider.FencedReplies);

            // An unknown request id (a destroyed world's request) is ignored outright.
            Assert.IsTrue(provider.Receive(Ready("calligraphy-req-gone", request, png.Length, 1, 7, Session, "STXinwei", false)));
            Assert.IsFalse(provider.TryTake(out _));
        }

        /* -------------------------------------------------------------- cache */

        [Test]
        public void TheCacheSwapsBrowserPixelsIntoTheSameMaterialAndAppliesThemToLaterBindings() {
            var provider = new FakeProvider();
            var notes = new List<string>();
            var cache = new StationCalligraphyFaceCache(provider, notes.Add, "req-test");
            try {
                var request = Request();
                var binding = Binding(request, () => null);
                cache.Bind(binding, request);
                cache.Pump();
                Assert.AreEqual(1, provider.Batches.Count, "one bounded batch is published");
                Assert.AreEqual(request.Key, provider.Batches[0].Faces[0].Key);
                Assert.AreEqual(1, cache.PendingCount);
                Assert.IsNull(binding.Texture, "a transparent placeholder shows until the reply lands");

                var png = Png(request.PlateWidth, request.PlateHeight);
                provider.Complete(new StationCalligraphyFaceResponse {
                    RequestId = provider.Batches[0].RequestId,
                    Revision = 7,
                    SessionId = Session,
                    ManifestVersion = StationCalligraphyArtwork.FontVersion,
                    ArtReady = true,
                    Painted = new[] {
                        new StationCalligraphyPaintedFace {
                            Key = request.Key,
                            ModuleId = request.ModuleId,
                            Style = request.Style,
                            Axis = request.Axis,
                            Width = request.PlateWidth,
                            Height = request.PlateHeight,
                            ResolvedFamily = "STXinwei",
                            MissingFace = false,
                            Resolution = "style=wei face=STXinwei missing=0",
                            Png = png,
                        },
                    },
                });
                cache.Pump();
                Assert.IsNotNull(binding.Texture, "the browser's pixels reached the bound slot");
                Assert.IsTrue(cache.IsBrowserPainted(request.Key));
                Assert.AreEqual(0, cache.PendingCount);
                Assert.AreEqual(1, cache.TextureCount);
                Assert.AreEqual(1, cache.BrowserPaintedCount);
                Assert.AreEqual(0, cache.NativeFallbackCount);
                Assert.IsTrue(binding.Texture.width == request.PlateWidth && binding.Texture.height == request.PlateHeight);
                if (binding.Material != null && binding.Material.HasProperty("_BaseMap")) {
                    Assert.AreSame(binding.Texture, binding.Material.GetTexture("_BaseMap"),
                        "the painted panel is swapped into the instance material, not a second one");
                }
                Assert.IsTrue(notes.Exists(line => line.StartsWith("calligraphy-face:") && line.Contains("STXinwei")),
                    "the resolved face is in the ledger: " + string.Join("; ", notes));

                // A second plate with the same content applies at once and shares the texture.
                var second = Binding(request, () => null);
                cache.Bind(second, request);
                Assert.AreEqual(1, provider.Batches.Count, "a cached key is never re-requested");
                Assert.AreSame(binding.Texture, second.Texture);
            } finally {
                cache.Dispose();
            }
        }

        [Test]
        public void ARequestNoTransportCanCarryPaintsNativelyOnceIntoTheSameMaterial() {
            var provider = new FakeProvider { Publish = false };
            var notes = new List<string>();
            var cache = new StationCalligraphyFaceCache(provider, notes.Add, "req-test");
            Texture2D native = null;
            try {
                var request = Request();
                var binding = Binding(request, () => {
                    if (native == null) {
                        native = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                        owned.Add(native);
                    }
                    return native;
                });
                cache.Bind(binding, request);
                cache.Pump();
                Assert.AreEqual(1, provider.Batches.Count, "the request was attempted");
                Assert.AreEqual(1, cache.NativeFallbackCount, "a dropped batch is painted natively");
                Assert.AreEqual(0, cache.BrowserPaintedCount);
                Assert.IsFalse(cache.IsBrowserPainted(request.Key));
                Assert.AreSame(native, binding.Texture);
                Assert.IsTrue(notes.Exists(line => line.StartsWith("calligraphy-paint:") && line.Contains("bridge-unavailable")),
                    "the fallback is in the ledger: " + string.Join("; ", notes));
                // A later bind of the same content reuses the fallback pixels, never repaints.
                var second = Binding(request, () => null);
                cache.Bind(second, request);
                Assert.AreSame(native, second.Texture);
                Assert.AreEqual(1, cache.NativeFallbackCount);
            } finally {
                cache.Dispose();
            }
        }

        [Test]
        public void AMissingFaceAndABadSizeAreReportedAndStalePixelsAreNeverApplied() {
            var provider = new FakeProvider();
            var notes = new List<string>();
            var cache = new StationCalligraphyFaceCache(provider, notes.Add, "req-test");
            try {
                var request = Request();
                var binding = Binding(request, () => null);
                cache.Bind(binding, request);
                cache.Pump();
                // A face with no approved family: painted (fallback glyphs), reported missing.
                var png = Png(request.PlateWidth, request.PlateHeight);
                provider.Complete(new StationCalligraphyFaceResponse {
                    RequestId = provider.Batches[0].RequestId,
                    ManifestVersion = StationCalligraphyArtwork.FontVersion,
                    ArtReady = true,
                    Painted = new[] {
                        new StationCalligraphyPaintedFace {
                            Key = request.Key, ModuleId = request.ModuleId, Style = request.Style, Axis = request.Axis,
                            Width = request.PlateWidth, Height = request.PlateHeight,
                            ResolvedFamily = "", MissingFace = true,
                            Resolution = "style=wei face=fallback:serif missing=1", Png = png,
                        },
                    },
                });
                cache.Pump();
                Assert.AreEqual(1, cache.MissingFaceCount);
                Assert.IsTrue(notes.Exists(line => line.StartsWith("calligraphy-face-missing:")), string.Join("; ", notes));
                Assert.IsNotNull(binding.Texture, "a missing face still paints the last-resort fallback");

                // A reply for a key no plate wants is stale: it must not create an entry.
                var stale = new StationCalligraphyFaceResponse {
                    RequestId = "calligraphy-req-gone",
                    ManifestVersion = StationCalligraphyArtwork.FontVersion,
                    Painted = new[] {
                        new StationCalligraphyPaintedFace {
                            Key = "not-wanted", Width = 256, Height = 256, Png = png,
                        },
                    },
                };
                provider.Complete(stale);
                cache.Pump();
                Assert.AreEqual(1, cache.TextureCount, "a stale reply is discarded");
            } finally {
                cache.Dispose();
            }
        }

        [Test]
        public void DisposeFreesEveryTextureTheScopeNeeds() {
            var provider = new FakeProvider();
            var cache = new StationCalligraphyFaceCache(provider, null, "req-test");
            var request = Request();
            var binding = Binding(request, () => null);
            cache.Bind(binding, request);
            cache.Pump();
            var png = Png(request.PlateWidth, request.PlateHeight);
            provider.Complete(new StationCalligraphyFaceResponse {
                RequestId = provider.Batches[0].RequestId,
                ManifestVersion = StationCalligraphyArtwork.FontVersion,
                Painted = new[] {
                    new StationCalligraphyPaintedFace {
                        Key = request.Key, Width = request.PlateWidth, Height = request.PlateHeight, Png = png,
                        ResolvedFamily = "STXinwei",
                    },
                },
            });
            cache.Pump();
            var texture = binding.Texture;
            Assert.IsNotNull(texture);
            cache.Dispose();
            Assert.IsTrue(texture == null, "the disposed cache destroyed its texture");
            Assert.AreEqual(0, cache.TextureCount);
        }

        /* ------------------------------------------------------------- helpers */

        static string Chunk(string requestId, StationCalligraphyFaceRequest request, string base64, int count,
            int index, int revision, string sessionId, int chunkSize) {
            var data = base64.Substring(index * chunkSize, Math.Min(chunkSize, base64.Length - index * chunkSize));
            var payload = new JObject {
                ["requestId"] = requestId,
                ["revision"] = revision,
                ["sessionId"] = sessionId,
                ["key"] = request.Key,
                ["moduleId"] = request.ModuleId,
                ["style"] = request.Style,
                ["axis"] = request.Axis,
                ["width"] = request.PlateWidth,
                ["height"] = request.PlateHeight,
                ["index"] = index,
                ["count"] = count,
                ["data"] = data,
            };
            return new JObject {
                ["schemaVersion"] = 2, ["kind"] = "calligraphyReply", ["type"] = "calligraphy.faceChunk",
                ["id"] = requestId, ["payload"] = payload,
            }.ToString(Newtonsoft.Json.Formatting.None);
        }

        static string Ready(string requestId, StationCalligraphyFaceRequest request, int bytes, int chunks,
            int revision, string sessionId, string resolvedFamily, bool missing) {
            var painted = new JArray();
            painted.Add(new JObject {
                ["key"] = request.Key,
                ["moduleId"] = request.ModuleId,
                ["style"] = request.Style,
                ["axis"] = request.Axis,
                ["width"] = request.PlateWidth,
                ["height"] = request.PlateHeight,
                ["resolvedFamily"] = resolvedFamily,
                ["missingFace"] = missing,
                ["resolution"] = "style=wei face=" + (missing ? "fallback:serif" : resolvedFamily) + " missing=" + (missing ? "1" : "0"),
                ["bytes"] = bytes,
                ["chunks"] = chunks,
            });
            var payload = new JObject {
                ["requestId"] = requestId,
                ["revision"] = revision,
                ["sessionId"] = sessionId,
                ["manifestVersion"] = StationCalligraphyArtwork.FontVersion,
                ["artReady"] = true,
                ["painted"] = painted,
                ["pending"] = new JArray(),
            };
            return new JObject {
                ["schemaVersion"] = 2, ["kind"] = "calligraphyReply", ["type"] = "calligraphy.faceReady",
                ["id"] = requestId, ["payload"] = payload,
            }.ToString(Newtonsoft.Json.Formatting.None);
        }
    }
}
