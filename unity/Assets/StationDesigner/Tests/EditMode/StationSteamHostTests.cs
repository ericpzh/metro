using Metro.App;
using NUnit.Framework;

namespace Metro.EditModeTests {
    public sealed class StationSteamHostTests {
        [TearDown]
        public void TearDown() {
            StationSteamHost.ResetForTests();
        }

        [Test]
        public void MapsSteamLanguagesToChineseOrEnglishUiLocales() {
            Assert.AreEqual("", StationSteamHost.MapSteamLanguageToUiLocale(null));
            Assert.AreEqual("", StationSteamHost.MapSteamLanguageToUiLocale("  "));
            Assert.AreEqual("zh-CN", StationSteamHost.MapSteamLanguageToUiLocale("schinese"));
            Assert.AreEqual("zh-CN", StationSteamHost.MapSteamLanguageToUiLocale("tchinese"));
            Assert.AreEqual("zh-CN", StationSteamHost.MapSteamLanguageToUiLocale("ZH-CN"));
            Assert.AreEqual("en", StationSteamHost.MapSteamLanguageToUiLocale("english"));
            Assert.AreEqual("en", StationSteamHost.MapSteamLanguageToUiLocale("japanese"));
            Assert.AreEqual("en", StationSteamHost.MapSteamLanguageToUiLocale("french"));
        }

        [Test]
        public void AppliesEnglishStartupLocaleWithoutDisturbingBenchmarkOrExplicitEnglishRoutes() {
            Assert.AreEqual("/game/en/", StationSteamHost.ApplyStartupLocaleToRoute("/game/", "en"));
            Assert.AreEqual("/game/en/", StationSteamHost.ApplyStartupLocaleToRoute("/game", "en"));
            Assert.AreEqual("/game/en/zoo", StationSteamHost.ApplyStartupLocaleToRoute("/game/zoo", "en"));
            Assert.AreEqual("/game/en/zoo", StationSteamHost.ApplyStartupLocaleToRoute("/game/en/zoo", "en"));
            Assert.AreEqual("/game/benchmark", StationSteamHost.ApplyStartupLocaleToRoute("/game/benchmark", "en"));
            Assert.AreEqual("/game/zoo", StationSteamHost.ApplyStartupLocaleToRoute("/game/zoo", "zh-CN"));
        }

        [Test]
        public void ParsesSteamRuntimeConfigJsonSafely() {
            Assert.IsTrue(StationSteamHost.TryParseRuntimeConfig(
                "{\"appId\":1234560,\"requireSteamRestart\":true}",
                out uint appId,
                out bool requireRestart));
            Assert.AreEqual(1234560u, appId);
            Assert.IsTrue(requireRestart);

            Assert.IsFalse(StationSteamHost.TryParseRuntimeConfig("{}", out appId, out requireRestart));
            Assert.AreEqual(0u, appId);
            Assert.IsFalse(requireRestart);

            Assert.IsFalse(StationSteamHost.TryParseRuntimeConfig("not-json", out appId, out requireRestart));
        }

        [Test]
        public void RaisesOverlayActiveChangedOnlyOnStateTransitions() {
            int calls = 0;
            bool last = false;
            void Handler(bool active) {
                calls++;
                last = active;
            }

            StationSteamHost.OverlayActiveChanged += Handler;
            try {
                StationSteamHost.SetOverlayActiveForTests(true);
                StationSteamHost.SetOverlayActiveForTests(true);
                Assert.IsTrue(StationSteamHost.IsOverlayActive);
                Assert.AreEqual(1, calls);
                Assert.IsTrue(last);

                StationSteamHost.SetOverlayActiveForTests(false);
                StationSteamHost.SetOverlayActiveForTests(false);
                Assert.IsFalse(StationSteamHost.IsOverlayActive);
                Assert.AreEqual(2, calls);
                Assert.IsFalse(last);
            } finally {
                StationSteamHost.OverlayActiveChanged -= Handler;
            }
        }
    }
}
