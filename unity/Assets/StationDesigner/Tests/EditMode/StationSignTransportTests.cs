using System.Collections.Generic;
using Metro.App;
using Metro.App.Views;
using NUnit.Framework;
using UnityEngine;

namespace Metro.Tests {
    /// <summary>
    /// RCA 14 §4.1 (confirmed transport fault): `StationSignSignage.Send` published
    /// straight through `StationWebBridge.Publish`, which is compiled out of the
    /// desktop/Editor player. The requests never reached
    /// `StationGameHost.ReplyPublished`, so the WebView2 React painter could never see
    /// a face. The painter now publishes through the host, which delivers to **both**
    /// transports; a request the build cannot deliver is reported and left retryable
    /// instead of pretending it was sent.
    /// </summary>
    public sealed class StationSignTransportTests {
        GameObject hostObject;

        [TearDown]
        public void TearDown() {
            if (hostObject != null) Object.DestroyImmediate(hostObject);
            hostObject = null;
            StationSignSignage.SendHook = null;
        }

        static StationSignFaceRequest Face() => new StationSignFaceRequest {
            ModuleId = "sign-309",
            Face = StationSignFaceName.Front,
            PanelWidth = 1f,
            PanelHeight = .3f,
        };

        [Test]
        public void TheHostPublishesOneEnvelopeToTheDesktopSubscriber() {
            hostObject = new GameObject(StationGameHost.ObjectName);
            var host = hostObject.AddComponent<StationGameHost>();
            var seen = new List<string>();
            host.ReplyPublished += seen.Add;
            Assert.IsTrue(host.PublishOutbound("{\"schemaVersion\":2,\"kind\":\"signRequest\"}"),
                "the desktop presenter's subscription is a transport even with no WebGL glue");
            CollectionAssert.AreEqual(new[] { "{\"schemaVersion\":2,\"kind\":\"signRequest\"}" }, seen,
                "the same envelope the WebGL page would see reaches the presenter once");
        }

        [Test]
        public void TheWebGlBridgeReportsThatTheDesktopHasNoGlue() {
            Assert.IsFalse(StationWebBridge.Publish("{\"kind\":\"signRequest\"}"),
                "a build without the WebGL glue must say so rather than report a delivery");
        }

        [Test]
        public void AnUndeliverableFaceRequestIsRecordedAndStaysRetryable() {
            var provider = new StationSignWebProvider(_ => false,
                () => new StationSignContext { SessionId = "s-1", Revision = 3 });
            provider.Request(new StationSignFaceBatch { RequestId = "sign-req-1", Faces = new[] { Face() } });
            Assert.AreEqual(1, provider.DroppedRequests, "the dropped batch is counted");
            Assert.AreEqual("publish-unavailable", provider.LastPublishError, "and named for the face status");
            Assert.AreEqual(0, provider.OpenRequests, "a request that was never sent holds no reply slot");

            var sent = new List<string>();
            var live = new StationSignWebProvider(json => { sent.Add(json); return true; },
                () => new StationSignContext { SessionId = "s-1", Revision = 3 });
            live.Request(new StationSignFaceBatch { RequestId = "sign-req-2", Faces = new[] { Face() } });
            Assert.AreEqual(1, sent.Count, "the same face publishes normally once a route exists");
            Assert.AreEqual(0, live.DroppedRequests);
            Assert.AreEqual(1, live.OpenRequests, "the live request waits for its faceReady");
        }

        [Test]
        public void ATestHookStillWalksTheRequestEnvelope() {
            var seen = new List<string>();
            StationSignSignage.SendHook = seen.Add;
            Assert.IsTrue(StationSignSignage.Send("{\"kind\":\"signRequest\"}"),
                "the verifier seam is unchanged and reports delivery");
            CollectionAssert.AreEqual(new[] { "{\"kind\":\"signRequest\"}" }, seen);
        }
    }
}
