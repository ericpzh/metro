using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>
    /// Cached renderer slots on one consist instance whose materials are bound to live
    /// line colour and city cab artwork (<c>lineLivery</c>, <c>trainMark</c>,
    /// <c>chongqingTrainMark</c>, <c>nanjingTrainMark</c>).
    /// </summary>
    public sealed class TrainLiveryBinding {
        public struct Slot {
            public MeshRenderer Renderer;
            public int MaterialIndex;
            public Material Template;
        }

        public string LineId = "";
        public string LineColour = "";
        public string City = StationCityStyles.DefaultCity;
        public readonly List<Slot> Livery = new List<Slot>();
        public readonly List<Slot> CityMark = new List<Slot>();
        public readonly List<Slot> ChongqingMark = new List<Slot>();
        public readonly List<Slot> NanjingMark = new List<Slot>();
    }

    public struct TrainMarkRequestItem {
        public string Key;
        public string Kind; // "city" | "chongqing" | "nanjing"
        public string City;
        public string LineId;
        public string Colour;
    }

    /// <summary>Optional test/headless provider for <see cref="TrainMarkTextureCache"/>.</summary>
    public interface ITrainMarkProvider {
        bool TryProvide(TrainMarkRequestItem item, out Texture2D texture);
    }

    /// <summary>
    /// Shared texture cache and Bridge v2 out-of-band provider for train cab/side city marks
    /// (<c>trainMarkRequest</c> → <c>train.markChunk</c> / <c>train.markReady</c>).
    /// Follows the same bounded 48 KiB chunking and session/revision fencing as
    /// <see cref="StationCalligraphyFaceCache"/> and <see cref="PsdHeaderTextureCache"/>.
    /// </summary>
    public static class TrainMarkTextureCache {
        public const int MaxChunkChars = 48 * 1024;

        static readonly Dictionary<string, Texture2D> Textures = new Dictionary<string, Texture2D>(StringComparer.Ordinal);
        static readonly HashSet<string> InFlightKeys = new HashSet<string>(StringComparer.Ordinal);
        static readonly Dictionary<string, List<string>> PendingChunks = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        static readonly List<Action> Listeners = new List<Action>();
        static Texture2D clearTexture;
        static int requestSequence;
        static ITrainMarkProvider overrideProvider;

        public static event Action TextureUpdated {
            add { if (value != null && !Listeners.Contains(value)) Listeners.Add(value); }
            remove { if (value != null) Listeners.Remove(value); }
        }

        public static void SetProviderForTests(ITrainMarkProvider provider) {
            overrideProvider = provider;
        }

        public static void ClearCacheForTests() {
            foreach (var tex in Textures.Values) {
                if (tex != null) UnityEngine.Object.DestroyImmediate(tex);
            }
            Textures.Clear();
            InFlightKeys.Clear();
            PendingChunks.Clear();
        }

        public static Texture2D ClearTransparentTexture() {
            if (clearTexture != null) return clearTexture;
            clearTexture = new Texture2D(2, 2, TextureFormat.RGBA32, false) {
                name = "train-mark-clear",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
                hideFlags = HideFlags.HideAndDontSave,
            };
            var clear = new Color32(0, 0, 0, 0);
            clearTexture.SetPixels32(new[] { clear, clear, clear, clear });
            clearTexture.Apply(false, false);
            return clearTexture;
        }

        public static string CityMarkKey(string city) => "city:" + StationCityStyles.Normalize(city);
        public static string ChongqingMarkKey(string lineId, string hexColour) =>
            "cq:" + (lineId ?? "") + ":" + NormalizeHex(hexColour);
        public static string NanjingMarkKey() => "nj";

        public static string NormalizeHex(string hex) {
            if (string.IsNullOrWhiteSpace(hex)) return StationCityStyles.DefaultLineColour;
            string s = hex.Trim();
            if (!s.StartsWith("#", StringComparison.Ordinal)) s = "#" + s;
            return s.ToLowerInvariant();
        }

        public static bool TryGet(string key, out Texture2D texture) {
            if (!string.IsNullOrEmpty(key) && Textures.TryGetValue(key, out texture) && texture != null) {
                return true;
            }
            texture = null;
            return false;
        }

        public static bool RequestIfMissing(TrainMarkRequestItem item) {
            if (string.IsNullOrEmpty(item.Key)) return false;
            if (TryGet(item.Key, out _)) return true;
            if (overrideProvider != null && overrideProvider.TryProvide(item, out var provided) && provided != null) {
                Textures[item.Key] = provided;
                return true;
            }
            if (!InFlightKeys.Add(item.Key)) return false;
            var host = StationGameHost.Active;
            if (host == null) return false;
            string reqId = "tm-" + (++requestSequence);
            var markObj = new JObject {
                ["key"] = item.Key,
                ["kind"] = item.Kind ?? "city",
                ["city"] = StationCityStyles.Normalize(item.City),
            };
            if (!string.IsNullOrEmpty(item.LineId)) markObj["lineId"] = item.LineId;
            if (!string.IsNullOrEmpty(item.Colour)) markObj["colour"] = NormalizeHex(item.Colour);
            var env = new JObject {
                ["schemaVersion"] = 2,
                ["kind"] = "trainMarkRequest",
                ["id"] = reqId,
                ["sessionId"] = host.ClientSessionId ?? "",
                ["revision"] = host.CurrentRevision,
                ["payload"] = new JObject {
                    ["requestId"] = reqId,
                    ["marks"] = new JArray { markObj },
                },
            };
            host.PublishOutbound(env.ToString(Newtonsoft.Json.Formatting.None));
            return false;
        }

        public static bool IsMarkCommand(string type) =>
            string.Equals(type, "train.markChunk", StringComparison.Ordinal) ||
            string.Equals(type, "train.markReady", StringComparison.Ordinal);

        public static bool HandleCommand(string type, JObject payload) {
            if (payload == null) return false;
            if (string.Equals(type, "train.markChunk", StringComparison.Ordinal)) {
                string key = payload.Value<string>("key") ?? "";
                string data = payload.Value<string>("data") ?? "";
                int index = payload.Value<int?>("index") ?? 0;
                if (string.IsNullOrEmpty(key) || data.Length > MaxChunkChars + 64) return false;
                if (!PendingChunks.TryGetValue(key, out var list)) {
                    PendingChunks[key] = list = new List<string>();
                }
                while (list.Count <= index) list.Add("");
                list[index] = data;
                return true;
            }
            if (string.Equals(type, "train.markReady", StringComparison.Ordinal)) {
                bool changed = false;
                var marks = payload["marks"] as JArray;
                if (marks != null) {
                    for (int i = 0; i < marks.Count; i++) {
                        var item = marks[i] as JObject;
                        string key = item?.Value<string>("key") ?? "";
                        if (string.IsNullOrEmpty(key)) continue;
                        InFlightKeys.Remove(key);
                        if (!PendingChunks.TryGetValue(key, out var parts)) continue;
                        PendingChunks.Remove(key);
                        string base64 = string.Concat(parts);
                        if (string.IsNullOrEmpty(base64)) continue;
                        try {
                            byte[] png = Convert.FromBase64String(base64);
                            var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false) {
                                name = "train-mark:" + key,
                                wrapMode = TextureWrapMode.Clamp,
                                filterMode = FilterMode.Bilinear,
                                hideFlags = HideFlags.HideAndDontSave,
                            };
                            if (ImageConversion.LoadImage(tex, png, markNonReadable: false)) {
                                if (Textures.TryGetValue(key, out var oldTex) && oldTex != null && oldTex != clearTexture) {
                                    UnityEngine.Object.DestroyImmediate(oldTex);
                                }
                                Textures[key] = tex;
                                changed = true;
                            } else {
                                UnityEngine.Object.DestroyImmediate(tex);
                            }
                        } catch (Exception) {
                            // Ignore malformed chunks cleanly.
                        }
                    }
                }
                if (changed) NotifyListeners();
                return true;
            }
            return false;
        }

        static void NotifyListeners() {
            for (int i = Listeners.Count - 1; i >= 0; i--) {
                try { Listeners[i]?.Invoke(); } catch (Exception) { }
            }
        }
    }

    /// <summary>
    /// Binds live line livery colour and city-specific cab/side marks onto any promoted
    /// Unity train consist (retained live consists and exploded-view consists) without
    /// ever mutating imported GLB/prefab shared materials.
    /// </summary>
    public static class TrainLiveryBinder {
        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        static readonly int ColorId = Shader.PropertyToID("_Color");
        static readonly int BaseMapId = Shader.PropertyToID("_BaseMap");
        static readonly int MainTexId = Shader.PropertyToID("_MainTex");

        static string BaseMaterialName(Material mat) {
            if (mat == null || string.IsNullOrEmpty(mat.name)) return "";
            string n = mat.name;
            const string inst = " (Instance)";
            if (n.EndsWith(inst, StringComparison.Ordinal)) n = n.Substring(0, n.Length - inst.Length);
            return n.Trim();
        }

        public static TrainLiveryBinding Capture(GameObject consistRoot) {
            var binding = new TrainLiveryBinding();
            if (consistRoot == null) return binding;
            var renderers = consistRoot.GetComponentsInChildren<MeshRenderer>(includeInactive: true);
            for (int r = 0; r < renderers.Length; r++) {
                var mr = renderers[r];
                if (mr == null) continue;
                var mats = mr.sharedMaterials;
                if (mats == null) continue;
                for (int m = 0; m < mats.Length; m++) {
                    var mat = mats[m];
                    string name = BaseMaterialName(mat);
                    if (string.Equals(name, "lineLivery", StringComparison.Ordinal)) {
                        binding.Livery.Add(new TrainLiveryBinding.Slot { Renderer = mr, MaterialIndex = m, Template = mat });
                    } else if (string.Equals(name, "trainMark", StringComparison.Ordinal)) {
                        binding.CityMark.Add(new TrainLiveryBinding.Slot { Renderer = mr, MaterialIndex = m, Template = mat });
                    } else if (string.Equals(name, "chongqingTrainMark", StringComparison.Ordinal)) {
                        binding.ChongqingMark.Add(new TrainLiveryBinding.Slot { Renderer = mr, MaterialIndex = m, Template = mat });
                    } else if (string.Equals(name, "nanjingTrainMark", StringComparison.Ordinal)) {
                        binding.NanjingMark.Add(new TrainLiveryBinding.Slot { Renderer = mr, MaterialIndex = m, Template = mat });
                    }
                }
            }
            return binding;
        }

        public static void Apply(
            TrainLiveryBinding binding,
            string lineId,
            string lineColourHex,
            string city,
            Dictionary<string, Material> materialPool,
            List<Material> ownedMaterials,
            bool recaptureVisibility) {
            if (binding == null) return;
            string normCity = StationCityStyles.Normalize(city);
            string normHex = TrainMarkTextureCache.NormalizeHex(lineColourHex);
            binding.LineId = lineId ?? "";
            binding.LineColour = normHex;
            binding.City = normCity;

            // 1. Live line livery colour (opaque).
            if (binding.Livery.Count > 0) {
                Color srgb = ColorUtility.TryParseHtmlString(normHex, out var parsed)
                    ? parsed
                    : new Color(0.184f, 0.494f, 0.949f, 1f);
                for (int i = 0; i < binding.Livery.Count; i++) {
                    var slot = binding.Livery[i];
                    if (slot.Renderer == null || slot.Template == null) continue;
                    string poolKey = "livery|" + slot.Template.GetEntityId() + "|" + normHex;
                    if (!materialPool.TryGetValue(poolKey, out var mat) || mat == null) {
                        mat = new Material(slot.Template) {
                            name = "lineLivery:" + normHex,
                            hideFlags = HideFlags.HideAndDontSave,
                        };
                        if (mat.HasProperty(BaseColorId)) mat.SetColor(BaseColorId, srgb);
                        if (mat.HasProperty(ColorId)) mat.SetColor(ColorId, srgb);
                        materialPool[poolKey] = mat;
                        ownedMaterials?.Add(mat);
                    }
                    AssignSlot(slot, mat, recaptureVisibility);
                }
            }

            // 2. Shared 3-slot cab trainMark (guangzhou/shenzhen/shanghai/beijing/chengdu/wuhan; blank for chongqing/nanjing).
            if (binding.CityMark.Count > 0) {
                bool blank = normCity == "chongqing" || normCity == "nanjing";
                Texture2D markTex = null;
                if (blank) {
                    markTex = TrainMarkTextureCache.ClearTransparentTexture();
                } else {
                    string key = TrainMarkTextureCache.CityMarkKey(normCity);
                    if (!TrainMarkTextureCache.TryGet(key, out markTex)) {
                        if (!TrainMarkTextureCache.RequestIfMissing(new TrainMarkRequestItem {
                            Key = key, Kind = "city", City = normCity,
                        }) || !TrainMarkTextureCache.TryGet(key, out markTex)) {
                            // Keep baked Guangzhou texture on Guangzhou while request is pending; clear other cities to avoid wrong emblem flash.
                            if (normCity != "guangzhou") markTex = TrainMarkTextureCache.ClearTransparentTexture();
                        }
                    }
                }
                ApplyMarkSlots(binding.CityMark, "cityMark|" + normCity + "|" + (markTex != null ? markTex.GetEntityId() : 0),
                    "trainMark:" + normCity, markTex, materialPool, ownedMaterials, recaptureVisibility);
            }

            // 3. Chongqing line-numbered cab badge (only active for city == "chongqing").
            if (binding.ChongqingMark.Count > 0) {
                Texture2D cqTex;
                if (normCity == "chongqing") {
                    string key = TrainMarkTextureCache.ChongqingMarkKey(binding.LineId, normHex);
                    if (!TrainMarkTextureCache.TryGet(key, out cqTex)) {
                        if (!TrainMarkTextureCache.RequestIfMissing(new TrainMarkRequestItem {
                            Key = key, Kind = "chongqing", City = normCity, LineId = binding.LineId, Colour = normHex,
                        }) || !TrainMarkTextureCache.TryGet(key, out cqTex)) {
                            cqTex = TrainMarkTextureCache.ClearTransparentTexture();
                        }
                    }
                } else {
                    cqTex = TrainMarkTextureCache.ClearTransparentTexture();
                }
                ApplyMarkSlots(binding.ChongqingMark, "cqMark|" + binding.LineId + "|" + normHex + "|" + cqTex.GetEntityId(),
                    "chongqingTrainMark:" + binding.LineId, cqTex, materialPool, ownedMaterials, recaptureVisibility);
            }

            // 4. Nanjing side emblem (only active for city == "nanjing").
            if (binding.NanjingMark.Count > 0) {
                Texture2D njTex;
                if (normCity == "nanjing") {
                    string key = TrainMarkTextureCache.NanjingMarkKey();
                    if (!TrainMarkTextureCache.TryGet(key, out njTex)) {
                        if (!TrainMarkTextureCache.RequestIfMissing(new TrainMarkRequestItem {
                            Key = key, Kind = "nanjing", City = normCity,
                        }) || !TrainMarkTextureCache.TryGet(key, out njTex)) {
                            njTex = TrainMarkTextureCache.ClearTransparentTexture();
                        }
                    }
                } else {
                    njTex = TrainMarkTextureCache.ClearTransparentTexture();
                }
                ApplyMarkSlots(binding.NanjingMark, "njMark|" + normCity + "|" + njTex.GetEntityId(),
                    "nanjingTrainMark:" + normCity, njTex, materialPool, ownedMaterials, recaptureVisibility);
            }
        }

        static void ApplyMarkSlots(
            List<TrainLiveryBinding.Slot> slots,
            string keyPrefix,
            string matName,
            Texture2D tex,
            Dictionary<string, Material> materialPool,
            List<Material> ownedMaterials,
            bool recaptureVisibility) {
            for (int i = 0; i < slots.Count; i++) {
                var slot = slots[i];
                if (slot.Renderer == null || slot.Template == null) continue;
                if (tex == null) {
                    AssignSlot(slot, slot.Template, recaptureVisibility);
                    continue;
                }
                string poolKey = keyPrefix + "|" + slot.Template.GetEntityId();
                if (!materialPool.TryGetValue(poolKey, out var mat) || mat == null) {
                    mat = new Material(slot.Template) {
                        name = matName,
                        hideFlags = HideFlags.HideAndDontSave,
                    };
                    if (mat.HasProperty(BaseMapId)) mat.SetTexture(BaseMapId, tex);
                    if (mat.HasProperty(MainTexId)) mat.SetTexture(MainTexId, tex);
                    materialPool[poolKey] = mat;
                    ownedMaterials?.Add(mat);
                }
                AssignSlot(slot, mat, recaptureVisibility);
            }
        }

        static void AssignSlot(TrainLiveryBinding.Slot slot, Material mat, bool recaptureVisibility) {
            var mats = slot.Renderer.sharedMaterials;
            if (mats == null || slot.MaterialIndex < 0 || slot.MaterialIndex >= mats.Length) return;
            if (ReferenceEquals(mats[slot.MaterialIndex], mat)) return;
            mats[slot.MaterialIndex] = mat;
            slot.Renderer.sharedMaterials = mats;
            if (recaptureVisibility) {
                var visTarget = slot.Renderer.GetComponentInParent<StationVisibilityTarget>();
                if (visTarget != null) visTarget.Recapture(slot.Renderer);
            }
        }
    }

    /// <summary>Routes browser-painted <c>train.markChunk</c> / <c>train.markReady</c> replies into <see cref="TrainMarkTextureCache"/>.</summary>
    public sealed class TrainMarkCommandHandler : IStationCommandHandler {
        public string Capability => "train-marks";

        public bool Handles(string type) => TrainMarkTextureCache.IsMarkCommand(type);

        public bool TryHandle(StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = null;
            rejectReason = null;
            if (command == null) return true;
            TrainMarkTextureCache.HandleCommand(command.Type, payload);
            return true;
        }
    }

    public static class TrainMarkArtworkPacket {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() {
            StationCommandHandlers.Add(new TrainMarkCommandHandler());
        }
    }
}
