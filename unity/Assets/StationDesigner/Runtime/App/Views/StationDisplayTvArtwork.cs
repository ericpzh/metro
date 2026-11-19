using System;
using System.Collections.Generic;
using System.Globalization;
using Metro.Build;
using Metro.Sim;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>
    /// 18 §2 / 20 §1 — a television plays content **and prints its own departure board**.
    ///
    /// Every promoted `tv` prefab carries an ad window (`tvContentWindow`, and `tvContentWindow2`
    /// on the back-to-back `tv-double`), a service plate (`tvDepartureBoard`, `…Board2`) and its
    /// LED trim. The promoted export bakes the review document's one advertisement into the
    /// windows and its one sample departure into the plates, so all fourteen Zoo televisions
    /// showed the same frozen picture and the same frozen board.
    ///
    /// **One face, one record.** A `tv-double` is one prefab standing for **two saved
    /// televisions** — the pair resolver's hanging half and its mate — and each has its own saved
    /// poster, its own sample point and its own screen. The 18-era binder kept only `plates[0]`
    /// and described the whole world once, so the second face printed the first one's board and a
    /// single global minimum arrival stood in for every screen in the station. This owns
    /// <see cref="TvFace"/>: module id, slot, sample point in document metres, saved poster,
    /// surface, independent ad deadline and independent plate key, matched to the stable
    /// `…Board[/2]` / `…Window[/2]` slots the export names.
    ///
    /// The window rotates on a **wall clock** deadline (6–20 s, seeded per face), because the
    /// source's `PlateSystem.updateAdScreens` is the one display timer that is not the simulation
    /// — a paused station keeps its board but its screens keep playing. The board itself is fed
    /// from the published frame and repaints only when its printed facts change.
    /// </summary>
    public static class StationDisplayTvArtwork {
        /// <summary>`render/stationDisplay.ts`: a window's content turns over every 6–20 s.</summary>
        public const double MinSwapSeconds = 6, MaxSwapSeconds = 20;
        public const string WindowTag = "tvContentWindow";
        public const string PlateTag = "tvDepartureBoard";
        public const string LedgerPrefix = "tv-window:";
        /// <summary>A `tv-double` is the most one promoted prefab carries.</summary>
        public const int MaxFaces = 2;

        /// <summary>One screen: its saved television, its sample point and its own art state.</summary>
        public sealed class TvFace {
            /// <summary>The saved television this face belongs to (stable document id).</summary>
            public string ModuleId = "";
            /// <summary>0 = the export's base slots, 1 = its `…2` pair slots.</summary>
            public int Slot;
            /// <summary>The saved television's cell centre in document metres (the sample point).</summary>
            public Vector3 Sample;
            public MeshRenderer Window;
            public StationDisplayArtwork.UprightSurface Surface;
            public MeshRenderer Plate;
            public StationDisplayArtwork.UprightSurface PlateSurface;
            /// <summary>The catalogue index this screen currently prints.</summary>
            public int Poster;
            /// <summary>The wall-clock second the next ad swap is due.</summary>
            public double Deadline;
            public int Swaps;
            public string PosterSlug = "";
            /// <summary>The facts the service plate currently prints (its repaint key).</summary>
            public string PlateKey = "";
            internal long LastSimTick = long.MinValue;
            internal bool LastHaveFrame;
            internal object LastModulePages;
            internal object LastEdgeBucket;
            internal object LastLines;
            internal string LastDocName = "";
            internal string LastLocale = "";
            // Diagnostics the verifier reads through `state.displays`.
            public string TrackId = "", LineId = "", Direction = "", Date = "";
            public int Minute;
            public string Status0 = "", Status1 = "", Status2 = "";
            public override string ToString() =>
                ModuleId + " face" + Slot + " @" + Sample.x.ToString("0.##", CultureInfo.InvariantCulture) + "," +
                Sample.y.ToString("0.##", CultureInfo.InvariantCulture) + "," +
                Sample.z.ToString("0.##", CultureInfo.InvariantCulture);
        }

        /// <summary>One emitted prefab root: one lone television, or both halves of a pair.</summary>
        public sealed class TvEntry {
            /// <summary>The module that emitted the root (the pair's hanging half).</summary>
            public string ModuleId = "";
            public readonly List<TvFace> Faces = new List<TvFace>();
            /// <summary>The content windows in slot order (the painters' own order).</summary>
            public readonly List<MeshRenderer> Windows = new List<MeshRenderer>();
            /// <summary>The first face's service plate, for a caller that only needs one.</summary>
            public MeshRenderer Plate => Faces.Count > 0 ? Faces[0].Plate : null;
        }

        static Texture2D[] catalogue;
        /// <summary>The televisions of each built world; a staged candidate keeps its own list.</summary>
        static readonly Dictionary<StationDisplayArtwork.Scope, List<TvEntry>> byScope =
            new Dictionary<StationDisplayArtwork.Scope, List<TvEntry>>();
        static bool sinkRegistered;

        /// <summary>The poster catalogue, sorted by slug, from the exported table.</summary>
        public static Texture2D[] Catalogue {
            get {
                if (catalogue != null && catalogue.Length > 0) return catalogue;
                var all = Resources.LoadAll<Texture2D>(StationDisplayArtwork.PosterResources);
                Array.Sort(all, (a, b) => string.CompareOrdinal(a != null ? a.name : "", b != null ? b.name : ""));
                catalogue = all;
                return catalogue;
            }
        }

        /// <summary>`loadAlighting`'s seed rule: a stable hash of the television's own id.</summary>
        static int Seed(string text) {
            uint hash = 2166136261u;
            foreach (var ch in text ?? "") {
                hash ^= ch;
                hash *= 16777619u;
            }
            return (int)(hash & 0x7fffffff);
        }

        /// <summary>The catalogue index a television starts on: its saved slug when it has one.</summary>
        public static int InitialPoster(ModuleFacts module) => IndexOf(module != null ? module.Config.Text("poster") : "",
            module != null ? module.Id : "");

        /// <summary>The catalogue index for one saved slug, seeded by id when the slug is unknown.</summary>
        public static int IndexOf(string slug, string moduleId) {
            var all = Catalogue;
            if (all.Length == 0) return 0;
            if (!string.IsNullOrEmpty(slug)) {
                for (int i = 0; i < all.Length; i++) {
                    if (all[i] != null && string.Equals(all[i].name, slug, StringComparison.Ordinal)) return i;
                }
            }
            return Seed(moduleId) % all.Length;
        }

        /// <summary>
        /// `state.displays` (20 §1): one line per bound face — its module, face slot, selected
        /// track and line, the published minute and date, the three card statuses and its current
        /// poster — bounded so the payload never grows with the station.
        /// </summary>
        public const int MaxPublishedFaces = 10;

        public static (object scope, string locale, long swaps) CurrentScopeFingerprint() {
            var scope = StationDisplayModuleRenderer.Active != null
                ? StationDisplayModuleRenderer.Active.Current?.Displays
                : null;
            if (scope == null || !byScope.TryGetValue(scope, out var entries)) return (null, "", 0L);
            long swaps = 0;
            for (int e = 0; e < entries.Count; e++) {
                var faces = entries[e].Faces;
                for (int f = 0; f < faces.Count; f++) swaps += faces[f].Swaps;
            }
            return (scope, scope.Locale ?? "", swaps);
        }

        public static Newtonsoft.Json.Linq.JObject Publish() {
            var scope = StationDisplayModuleRenderer.Active != null
                ? StationDisplayModuleRenderer.Active.Current?.Displays
                : null;
            var json = new Newtonsoft.Json.Linq.JObject {
                ["bound"] = scope != null,
                ["locale"] = scope != null ? scope.Locale : "",
                ["faces"] = 0,
                ["pairFaces"] = 0,
                ["sampled"] = 0,
                ["posters"] = 0,
            };
            var list = new Newtonsoft.Json.Linq.JArray();
            if (scope == null || !byScope.TryGetValue(scope, out var entries)) {
                json["list"] = list;
                return json;
            }
            int faces = 0, pairFaces = 0, sampled = 0, posters = 0;
            var slugs = new HashSet<string>(StringComparer.Ordinal);
            for (int e = 0; e < entries.Count; e++) {
                var entry = entries[e];
                if (entry.Faces.Count >= 2) pairFaces++;
                for (int f = 0; f < entry.Faces.Count; f++) {
                    var face = entry.Faces[f];
                    faces++;
                    if (face.PosterSlug.Length > 0) slugs.Add(face.PosterSlug);
                    if (sampled >= MaxPublishedFaces) continue;
                    sampled++;
                    list.Add(new Newtonsoft.Json.Linq.JObject {
                        ["module"] = face.ModuleId,
                        ["face"] = face.Slot,
                        ["poster"] = face.PosterSlug,
                        ["deadline"] = face.Deadline,
                        ["swaps"] = face.Swaps,
                        ["track"] = face.TrackId,
                        ["line"] = face.LineId,
                        ["direction"] = face.Direction,
                        ["minute"] = face.Minute,
                        ["date"] = face.Date,
                        ["status"] = new Newtonsoft.Json.Linq.JArray(face.Status0, face.Status1, face.Status2),
                        ["board"] = face.PlateKey,
                        ["upright"] = face.Surface != null && face.Surface.Upright,
                        ["basis"] = face.Surface != null ? face.Surface.Basis : "",
                    });
                }
            }
            json["faces"] = faces;
            json["pairFaces"] = pairFaces;
            json["sampled"] = sampled;
            json["posters"] = slugs.Count;
            json["list"] = list;
            return json;
        }

        /// <summary>
        /// Adopt the shell's print locale (the `exit.locale` notice drives every printed display).
        /// A switch re-keys every board: the words are part of its identity, so a board can never
        /// keep the previous language's pixels.
        /// </summary>
        public static void ApplyLocale(string locale) {
            var next = string.IsNullOrEmpty(locale) ? "zh-CN" : locale;
            foreach (var pair in byScope) {
                var scope = pair.Key;
                if (scope == null || scope.Locale == next) continue;
                scope.Locale = next;
                for (int e = 0; e < pair.Value.Count; e++) {
                    for (int f = 0; f < pair.Value[e].Faces.Count; f++) {
                        pair.Value[e].Faces[f].PlateKey = "";
                        pair.Value[e].Faces[f].LastLocale = "";
                    }
                }
            }
        }

        /// <summary>The `state.displays` contributor: the televisions' own diagnostics.</summary>
        public sealed class StateContributor : IStationStateContributor {
            public string Key => "displays";
            public Newtonsoft.Json.Linq.JObject BuildPayload(StationDocument document, StationIndex index) {
                var current = StationDisplayModuleRenderer.Active != null
                    ? StationDisplayModuleRenderer.Active.Current
                    : null;
                var scope = current?.Displays;
                if (scope != null) {
                    var host = StationGameHost.ResolveActive();
                    var session = host != null ? (host.Simulation as StationSimulationHost)?.Session : null;
                    var doc = document ?? host?.Document;
                    if (session != null && doc != null) {
                        RefreshPlates(scope, current.World, doc, session.Snapshot(), true);
                    }
                }
                return Publish();
            }
        }

        static bool contributorRegistered;
        /// <summary>Idempotent: the first built display world publishes `state.displays`.</summary>
        public static void RegisterContributor() {
            if (contributorRegistered) return;
            var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            if (host == null) return;
            contributorRegistered = true;
            host.RegisterStateContributor(new StateContributor());
        }

        /// <summary>The interval this television waits between posters, 6–20 s, seeded by its id.</summary>
        public static double SwapInterval(ModuleFacts module) => SwapIntervalFor(module != null ? module.Id : "");

        /// <summary>The next catalogue index: a seeded walk, so the rotation is deterministic.</summary>
        public static int NextPoster(int current) {
            var all = Catalogue;
            if (all.Length <= 1) return 0;
            int stride = 1 + Seed("next:" + current) % (all.Length - 1);
            return (current + stride) % all.Length;
        }

        /// <summary>
        /// The slot a printed surface's material names: the base slot for `tvContentWindow`, the
        /// pair slot for `tvContentWindow2`. −1 when the material is not that surface at all.
        /// </summary>
        public static int SlotOf(string materialName, string tag) {
            if (string.IsNullOrEmpty(materialName) || string.IsNullOrEmpty(tag)) return -1;
            int index = materialName.IndexOf(tag, StringComparison.OrdinalIgnoreCase);
            if (index < 0) return -1;
            int after = index + tag.Length;
            while (after < materialName.Length && (materialName[after] == ' ' || materialName[after] == '_')) after++;
            return after < materialName.Length && materialName[after] == '2' ? 1 : 0;
        }

        /// <summary>
        /// Bind one emitted television root: resolve every printed face it carries, match the
        /// pair's two logical saved televisions to the stable export slots, and start each face on
        /// its own saved poster. False with a ledger reason when no window resolves.
        /// </summary>
        public static bool Bind(StationDisplayArtwork.Scope scope, GameObject root, ModuleFacts module,
            IReadOnlyList<ModuleFacts> station, double wallSeconds) =>
            Bind(scope, null, null, default, false, root, module, station, wallSeconds);

        public static bool Bind(StationDisplayArtwork.Scope scope, Metro.App.StationWorldView world,
            StationDocument document, StationMotionFrame initialFrame, bool haveFrame,
            GameObject root, ModuleFacts module, IReadOnlyList<ModuleFacts> station, double wallSeconds) {
            if (scope == null || root == null || module == null) return false;
            var windows = new MeshRenderer[MaxFaces];
            var plates = new MeshRenderer[MaxFaces];
            foreach (var renderer in root.GetComponentsInChildren<MeshRenderer>(true)) {
                if (!renderer) continue;
                foreach (var material in renderer.sharedMaterials) {
                    if (!material || material.name == null) continue;
                    int window = SlotOf(material.name, WindowTag);
                    if (window >= 0) {
                        if (windows[window] == null) windows[window] = renderer;
                        continue;
                    }
                    int plate = SlotOf(material.name, PlateTag);
                    if (plate >= 0 && plates[plate] == null) plates[plate] = renderer;
                }
            }
            if (windows[0] == null && windows[1] == null) {
                scope.Notes.Add("tv-window-unresolved:" + module.Id + ":no-content-window");
                return false;
            }
            Metro.View.ModuleViews.TryPairSlot(module, station, out bool hangs);
            var mate = hangs ? Mate(module, station) : module;
            var first = module;
            if (!WindowSlotResolves(windows)) {
                // A paired root with only the `2` slots: the export named its faces from the
                // other half, so attribute them the other way round rather than dropping them.
                var window = windows[0];
                windows[0] = windows[1];
                windows[1] = window;
                var plate = plates[0];
                plates[0] = plates[1];
                plates[1] = plate;
                scope.Notes.Add("tv-face-order:" + module.Id + ":slots-swapped");
            }
            var entry = new TvEntry { ModuleId = module.Id ?? "" };
            for (int slot = 0; slot < MaxFaces; slot++) {
                if (windows[slot] == null) continue;
                var facts = slot == 0 ? first : mate;
                if (facts == null) {
                    scope.Notes.Add("tv-face-unresolved:" + module.Id + ":slot" + slot + ":no-mate");
                    continue;
                }
                var face = new TvFace {
                    ModuleId = facts.Id ?? "",
                    Slot = slot,
                    Sample = new Vector3(facts.X + .5f, facts.Y + .5f, facts.Z),
                    Window = windows[slot],
                    Plate = plates[slot],
                    Poster = InitialPoster(facts),
                    Deadline = wallSeconds + SwapInterval(facts),
                };
                face.Surface = StationDisplayArtwork.BindUprightArtwork(scope, face.Window);
                if (face.Surface == null) {
                    scope.Notes.Add("tv-window-unresolved:" + module.Id + ":slot" + slot + ":no-plate-mesh");
                    continue;
                }
                if (face.Plate != null) {
                    face.PlateSurface = StationDisplayArtwork.BindUprightArtwork(scope, face.Plate);
                }
                entry.Faces.Add(face);
                entry.Windows.Add(face.Window);
            }
            if (entry.Faces.Count == 0) {
                scope.Notes.Add("tv-window-unresolved:" + module.Id + ":no-resolved-face");
                return false;
            }
            if (!byScope.TryGetValue(scope, out var list)) byScope[scope] = list = new List<TvEntry>();
            list.Add(entry);
            var clock = haveFrame ? initialFrame.Clock : default;
            for (int i = 0; i < entry.Faces.Count; i++) {
                var face = entry.Faces[i];
                if (Apply(scope, face, face.Poster)) world?.RecaptureArtwork(face.Window);
                if (document != null || haveFrame) {
                    RepaintPlate(scope, world, face, document, initialFrame, haveFrame, clock);
                }
            }
            return true;
        }

        static bool WindowSlotResolves(MeshRenderer[] windows) => windows[0] != null;

        /// <summary>The other half of a back-to-back pair in the same cell, or null.</summary>
        static ModuleFacts Mate(ModuleFacts module, IReadOnlyList<ModuleFacts> station) {
            if (station == null) return null;
            for (int i = 0; i < station.Count; i++) {
                var other = station[i];
                if (other == null || ReferenceEquals(other, module)) continue;
                if (!string.Equals(other.Type, "tv", StringComparison.Ordinal)) continue;
                if (other.X != module.X || other.Y != module.Y || other.Z != module.Z) continue;
                if (NormTurn(other.Rotation - module.Rotation) != 2) continue;
                return other;
            }
            return null;
        }

        static int NormTurn(int turn) => ((turn % 4) + 4) % 4;

        /// <summary>Print one face's current poster on its window (the authored plate mesh, cropped).</summary>
        static bool Apply(StationDisplayArtwork.Scope scope, TvFace face, int poster) {
            var all = Catalogue;
            if (all.Length == 0 || face.Surface == null) return false;
            var slug = all[((poster % all.Length) + all.Length) % all.Length].name;
            if (!StationDisplayArtwork.PaintUpright(scope, face.Surface, slug)) return false;
            face.PosterSlug = slug;
            scope.Notes.Add(LedgerPrefix + face.ModuleId + ":window" + face.Slot + ":" + slug);
            return true;
        }

        /// <summary>
        /// Advance every television to the wall clock and bring each face's board up to the
        /// published frame. A due window swaps to its next seed-walked poster and only the
        /// **window** changes; a board repaints only when its own printed facts change, so a
        /// paused station keeps the same board while its screens keep playing.
        /// </summary>
        public static int Advance(StationDisplayArtwork.Scope scope, double wallSeconds) =>
            Advance(scope, wallSeconds, null, default, false);

        /// <summary>
        /// Advance every television and repaint each face's board from one snapshot. `document`
        /// supplies the station name and the typed lines; `frame` supplies the arrivals, the
        /// service clock and the date.
        /// </summary>
        public static int Advance(StationDisplayArtwork.Scope scope, double wallSeconds,
            StationDocument document, StationMotionFrame frame, bool haveFrame) =>
            Advance(scope, null, wallSeconds, document, frame, haveFrame);

        public static int Advance(StationDisplayArtwork.Scope scope, Metro.App.StationWorldView world,
            double wallSeconds, StationDocument document, StationMotionFrame frame, bool haveFrame) {
            if (scope == null) return 0;
            if (!byScope.TryGetValue(scope, out var entries)) return 0;
            int swaps = 0;
            var clock = haveFrame ? frame.Clock : default;
            for (int e = 0; e < entries.Count; e++) {
                var entry = entries[e];
                for (int f = 0; f < entry.Faces.Count; f++) {
                    var face = entry.Faces[f];
                    if (face.Surface == null) continue;
                    if (wallSeconds >= face.Deadline) {
                        face.Poster = NextPoster(face.Poster);
                        face.Swaps++;
                        face.Deadline = wallSeconds + SwapIntervalFor(face.ModuleId);
                        if (Apply(scope, face, face.Poster)) {
                            swaps++;
                            world?.RecaptureArtwork(face.Window);
                            scope.Notes.Add(LedgerPrefix + face.ModuleId + ":swap" + face.Swaps + ":" + face.PosterSlug);
                        }
                    }
                    if (document != null || haveFrame) {
                        RepaintPlate(scope, world, face, document, frame, haveFrame, clock);
                    }
                }
            }
            return swaps;
        }

        /// <summary>
        /// Bring every face's departure board up to the published simulation snapshot without
        /// advancing wall-clock advertisement swap deadlines.
        /// </summary>
        public static void RefreshPlates(StationDisplayArtwork.Scope scope, Metro.App.StationWorldView world,
            StationDocument document, StationMotionFrame frame, bool haveFrame) {
            if (scope == null || (!haveFrame && document == null)) return;
            if (!byScope.TryGetValue(scope, out var entries)) return;
            var clock = haveFrame ? frame.Clock : default;
            for (int e = 0; e < entries.Count; e++) {
                var entry = entries[e];
                for (int f = 0; f < entry.Faces.Count; f++) {
                    var face = entry.Faces[f];
                    if (face?.Surface == null) continue;
                    RepaintPlate(scope, world, face, document, frame, haveFrame, clock);
                }
            }
        }

        static void RepaintPlate(StationDisplayArtwork.Scope scope, Metro.App.StationWorldView world,
            TvFace face, StationDocument document, StationMotionFrame frame, bool haveFrame,
            StationClockFrame clock) {
            if (face == null || face.Plate == null) return;
            long simTick = haveFrame ? clock.Tick : -1;
            var activeIdx = StationGameHost.Active?.Index != null && ReferenceEquals(StationGameHost.Active.Index.Document, document)
                ? StationGameHost.Active.Index
                : null;
            object railToken = activeIdx != null
                ? (object)activeIdx.ModulesOfType("track")
                : document?.ModulePages;
            object edgeToken = activeIdx != null
                ? (object)activeIdx.ModulesOfType("platform-edge")
                : document?.ModulePages;
            if (!string.IsNullOrEmpty(face.PlateKey) &&
                face.LastSimTick == simTick &&
                face.LastHaveFrame == haveFrame &&
                ReferenceEquals(face.LastModulePages, railToken) &&
                ReferenceEquals(face.LastEdgeBucket, edgeToken) &&
                ReferenceEquals(face.LastLines, document?.Lines) &&
                string.Equals(face.LastDocName, document?.Name ?? "", StringComparison.Ordinal) &&
                string.Equals(face.LastLocale, scope.Locale ?? "", StringComparison.Ordinal)) {
                return;
            }
            if (face.PlateSurface == null) {
                face.PlateSurface = StationDisplayArtwork.BindUprightArtwork(scope, face.Plate);
            }
            var status = StationTvSchedule.Select(document, frame, haveFrame, face.Sample);
            var data = StationTvPlatePainter.Describe(document, status, clock, scope.Locale);
            face.LastSimTick = simTick;
            face.LastHaveFrame = haveFrame;
            face.LastModulePages = railToken;
            face.LastEdgeBucket = edgeToken;
            face.LastLines = document?.Lines;
            face.LastDocName = document?.Name ?? "";
            face.LastLocale = scope.Locale ?? "";
            face.TrackId = status.TrackId;
            face.LineId = status.LineId;
            face.Direction = status.Direction;
            face.Minute = (int)(clock.TimeOfDaySeconds / 60);
            face.Date = data.Date;
            face.Status0 = status.Arrivals.Length > 0 ? status.Arrivals[0].ToString() : "none";
            face.Status1 = status.Arrivals.Length > 1 ? status.Arrivals[1].ToString() : "none";
            face.Status2 = status.Arrivals.Length > 2 ? status.Arrivals[2].ToString() : "none";
            if (string.Equals(face.PlateKey, data.Key, StringComparison.Ordinal)) return;
            var material = PlateMaterial(scope, face, data);
            if (material == null) return;
            face.Plate.sharedMaterial = material;
            world?.RecaptureArtwork(face.Plate);
            face.PlateKey = data.Key;
            scope.Notes.Add("tv-plate:" + face.ModuleId + ":face" + face.Slot +
                ":track=" + face.TrackId + ":line=" + face.LineId +
                ":minute=" + face.Minute + ":date=" + face.Date +
                ":status=" + face.Status0 + "/" + face.Status1 + "/" + face.Status2);
        }

        /// <summary>
        /// The board's material for one face. Both the printed texture and the material live on
        /// the display scope, keyed by visible contents and the face's own template, so a
        /// superseded board is released with the world instead of leaking (the 18-era static
        /// cache was cleared without disposing anything).
        /// </summary>
        static Material PlateMaterial(StationDisplayArtwork.Scope scope, TvFace face,
            StationTvPlatePainter.PlateData data) {
            if (scope == null || face == null || face.Plate == null) return null;
            var template = face.PlateSurface != null && face.PlateSurface.Template != null
                ? face.PlateSurface.Template
                : face.Plate.sharedMaterial;
            if (!template) return null;
            string key = "tv-plate|" + data.Key + "#" + template.name;
            if (scope.Materials.TryGetValue(key, out var cached) && cached) return cached;
            if (!scope.PlateTextures.TryGetValue(data.Key, out var texture) || !texture) {
                texture = StationTvPlatePainter.Paint(data, scope.Font);
                if (!texture) return null;
                scope.PlateTextures[data.Key] = texture;
                scope.Textures.Add(texture);
            }
            var material = new Material(template) { name = "tv plate " + texture.name };
            StationDisplayArtwork.SetTexture(material, texture);
            StationDisplayArtwork.ResetTextureTransform(material);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", Color.white);
            else if (material.HasProperty("baseColorFactor")) material.SetColor("baseColorFactor", Color.white);
            scope.Materials[key] = material;
            return material;
        }

        static double SwapIntervalFor(string moduleId) {
            int seed = Seed("interval:" + moduleId);
            double span = MaxSwapSeconds - MinSwapSeconds;
            return MinSwapSeconds + (seed % 10000) / 10000.0 * span;
        }

        /// <summary>The televisions one world owns (`null`/empty before a build).</summary>
        public static IReadOnlyList<TvEntry> EntriesFor(StationDisplayArtwork.Scope scope) =>
            scope != null && byScope.TryGetValue(scope, out var list) ? (IReadOnlyList<TvEntry>)list : Array.Empty<TvEntry>();

        /// <summary>The catalogue texture a face currently prints.</summary>
        public static Texture2D PosterTextureOf(TvFace face) =>
            face != null ? StationDisplayArtwork.Poster(face.PosterSlug) : null;

        public static void Reset() {
            byScope.Clear();
            StationTvSchedule.Reset();
        }

        /// <summary>
        /// The presentation-clock driver: the display feature adds it once, and it advances the
        /// active world's televisions without touching the document. The advertisement's cadence
        /// is the host's frame clock (independent of simulation speed); the boards read the
        /// session snapshot once per update and are shared by every face of that update.
        /// </summary>
        sealed class Sink : IStationFrameSink {
            public void Tick(StationDocument document, StationIndex index, StationFrameClock clock) {
                var current = StationDisplayModuleRenderer.Active != null
                    ? StationDisplayModuleRenderer.Active.Current
                    : null;
                var scope = current?.Displays;
                if (scope == null) return;
                StationMotionFrame frame = default;
                bool haveFrame = false;
                var host = StationGameHost.ResolveActive();
                var session = host != null ? (host.Simulation as StationSimulationHost)?.Session : null;
                if (session != null) {
                    frame = session.Snapshot();
                    haveFrame = true;
                } else if (document != null) {
                    int total = Math.Max(0, (int)Math.Floor(clock.SimSeconds));
                    int hour = (total / 3600) % 24, minute = (total / 60) % 60;
                    frame = new StationMotionFrame {
                        Clock = new StationClockFrame {
                            Playing = clock.Playing,
                            DateKey = "2026-01-01",
                            Clock = hour.ToString("00", CultureInfo.InvariantCulture) + ":" +
                                minute.ToString("00", CultureInfo.InvariantCulture),
                            TimeOfDaySeconds = total,
                        },
                    };
                    haveFrame = true;
                }
                Advance(scope, current.World, Time.realtimeSinceStartupAsDouble, document, frame, haveFrame);
            }
        }

        /// <summary>Idempotent registration seam (self-registration and tests call the same one).</summary>
        public static void RegisterSink() {
            if (sinkRegistered) return;
            sinkRegistered = true;
            StationFrameSinks.Add(new Sink());
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() => RegisterSink();
    }
}
