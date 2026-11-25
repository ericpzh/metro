using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.View;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>
    /// The dimension-aware booth (port of <c>render/models/pieces/BoothModel.ts</c>
    /// <c>buildBoothCanonical</c>). A booth is authored as a <c>w × h</c> room: its body
    /// is two side runs and a back run inset by <c>depth = min(0.55, w/3, h/3)</c>, with
    /// a counter across the approach face (including the information counter's lowered
    /// accessible shoulder profile), smart counter-seated monitors that never overhang
    /// the slope or edges, and an open overhead fascia frame at 2.08–2.40 m.
    /// For <c>info</c> booths, the overhead canopy is only generated when a real ceiling
    /// sits within <see cref="HeaderMaxHang"/> (3 m) above all four frame corners, hung
    /// from that ceiling by four corner suspension rods.
    ///
    /// Local axes: <c>x</c> along the run, <c>y</c> up from the floor top, <c>z</c>
    /// along the saved plan y. <c>cfg.front</c> turns the whole booth about its
    /// footprint centre, exactly as the source's oriented group does.
    /// </summary>
    public static class BoothModuleViews {
        public const int SlotWhite = 0;
        public const int SlotBinSteel = 1;
        public const int SlotSteel = 2;
        public const int SlotDarkSteel = 3;
        public const int SlotGlass = 4;
        public const int SlotGateRed = 5;
        public const int SlotBlack = 6;
        public const int SlotScreen = 7;
        public const int SlotHeadlight = 8;
        public const int SlotCount = 9;

        const int FallbackBinSteel = 4;
        const int FallbackGateRed = 9;

        public const float HeaderBottom = 2.08f;
        public const float HeaderTop = 2.4f;
        /// <summary>Maximum vertical hang distance from the info canopy top to a ceiling, metres.</summary>
        public const float HeaderMaxHang = 3f;

        const double CeilingEps = 1e-6;

        /// <summary>
        /// The nine <c>PieceBuilder.ts</c> material slots used by <c>BoothModel.ts</c>.
        /// Extracted prefab materials remain asset-owned; only minted fallback or unlit
        /// materials are appended to the caller's <c>ownedMaterials</c> list.
        /// </summary>
        public sealed class BoothPalette {
            readonly Material[] slots;

            BoothPalette(Material[] slots) {
                this.slots = slots;
            }

            public Material this[int slot] => slots[Mathf.Clamp(slot, 0, slots.Length - 1)];

            /// <summary>
            /// Map onto a <see cref="StationMaterials"/> palette (used by translucent placement
            /// ghosts, EditMode unit probes, and LOD coverage counters).
            /// </summary>
            public static BoothPalette FromStationMaterials(StationMaterials materials) {
                if (materials == null) throw new ArgumentNullException(nameof(materials));
                return new BoothPalette(new[] {
                    materials[StationMaterials.Light],
                    materials[FallbackBinSteel],
                    materials[StationMaterials.Steel],
                    materials[StationMaterials.Dark],
                    materials[StationMaterials.Glass],
                    materials[FallbackGateRed],
                    materials[StationMaterials.Dark],
                    materials[StationMaterials.Line],
                    materials[StationMaterials.Light],
                });
            }

            /// <summary>
            /// Resolve the web-matching booth materials from <see cref="RuntimeCatalogue"/>
            /// prefabs (<c>TicketBooth</c>, <c>BenchSeat1</c>, <c>ElectricalCabinet</c>) plus an
            /// unlit <c>headlight</c> strip (<c>#fff6e2</c>). Any material minted here is added
            /// to <paramref name="ownedMaterials"/> so the owning world destroys it on disposal.
            /// </summary>
            public static BoothPalette FromCatalogue(
                RuntimeCatalogue catalogue,
                Shader litShader,
                StationMaterials fallback,
                List<Material> ownedMaterials) {
                Material Extract(string materialName, params string[] keys) {
                    if (catalogue == null || keys == null) return null;
                    for (int i = 0; i < keys.Length; i++) {
                        if (!catalogue.TryGet(keys[i], out var entry) || entry == null || !entry.prefab) continue;
                        var found = ExtractNamedMaterial(entry.prefab, materialName);
                        if (found != null) return found;
                    }
                    return null;
                }

                Material MakeLit(string name, Color32 srgb, float metallic, float roughness, int fallbackSlot) {
                    var shader = litShader != null ? litShader : Shader.Find("Universal Render Pipeline/Lit");
                    if (!shader) return fallback != null ? fallback[fallbackSlot] : null;
                    var mat = new Material(shader) { name = name };
                    Color col = srgb;
                    if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", col);
                    if (mat.HasProperty("_Color")) mat.SetColor("_Color", col);
                    if (mat.HasProperty("_Metallic")) mat.SetFloat("_Metallic", metallic);
                    if (mat.HasProperty("_Smoothness")) mat.SetFloat("_Smoothness", 1f - roughness);
                    ownedMaterials?.Add(mat);
                    return mat;
                }

                Material MakeUnlit(string name, Color32 srgb, int fallbackSlot) {
                    var shader = Shader.Find("Universal Render Pipeline/Unlit")
                        ?? Shader.Find("Unlit/Color")
                        ?? litShader
                        ?? Shader.Find("Universal Render Pipeline/Lit");
                    if (!shader) return fallback != null ? fallback[fallbackSlot] : null;
                    var mat = new Material(shader) { name = name };
                    Color col = srgb;
                    if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", col);
                    if (mat.HasProperty("_Color")) mat.SetColor("_Color", col);
                    ownedMaterials?.Add(mat);
                    return mat;
                }

                var white = Extract("white", "bench-seat-1", "cctv", "bridge")
                    ?? MakeLit("booth-white", new Color32(0xee, 0xf1, 0xf4, 255), .05f, .45f, StationMaterials.Light);
                var binSteel = Extract("binSteel", "booth", "bin", "door-steel-1")
                    ?? MakeLit("booth-binSteel", new Color32(0xce, 0xce, 0xc6, 255), .23f, .40f, FallbackBinSteel);
                var steel = Extract("steel", "booth", "ac-unit", "bench-steel-1")
                    ?? MakeLit("booth-steel", new Color32(0xb7, 0xbd, 0xc4, 255), .72f, .34f, StationMaterials.Steel);
                var darkSteel = Extract("darkSteel", "booth", "ac-unit", "bench-seat-1")
                    ?? MakeLit("booth-darkSteel", new Color32(0x3c, 0x43, 0x4c, 255), .40f, .55f, StationMaterials.Dark);
                var glass = Extract("glass", "booth", "curtain-wall")
                    ?? (fallback != null ? fallback[StationMaterials.Glass] : null);
                var gateRed = Extract("gateRed", "electrical-cabinet", "psd-end")
                    ?? MakeLit("booth-gateRed", new Color32(0xbc, 0x3a, 0x2f, 255), .10f, .35f, FallbackGateRed);
                var black = Extract("black", "booth", "ac-unit", "bin")
                    ?? MakeLit("booth-black", new Color32(0x1b, 0x1e, 0x24, 255), .20f, .60f, StationMaterials.Dark);
                var screen = Extract("screen", "booth", "tvm", "lift")
                    ?? (fallback != null ? fallback[StationMaterials.Line] : null);
                var headlight = MakeUnlit("booth-headlight", new Color32(0xff, 0xf6, 0xe2, 255), StationMaterials.Light);

                return new BoothPalette(new[] {
                    white,
                    binSteel,
                    steel,
                    darkSteel,
                    glass,
                    gateRed,
                    black,
                    screen,
                    headlight,
                });
            }
        }

        /// <summary>Shared unit cube for <see cref="GeometryKit"/>; never destroyed.</summary>
        public static Mesh Cube() {
            if (!cube) cube = BuildCube(flipV: false, "booth box");
            return cube;
        }

        /// <summary>
        /// Shared unit cube with V flipped (<c>1 - v</c>) so <c>glTFast</c>-imported LCD
        /// textures (<c>screen</c> from <c>ticket-booth.glb</c>) display right-side up on the
        /// approach (<c>-z</c>) face while keeping outward winding and positive signed volume.
        /// </summary>
        public static Mesh ScreenCube() {
            if (!screenCube) screenCube = BuildCube(flipV: true, "booth screen box");
            return screenCube;
        }

        static Mesh cube;
        static Mesh screenCube;

        /// <summary>
        /// Port of <c>sim/booths.ts:boothScreenPositions</c> in canonical centred booth coordinates
        /// (<c>x ∈ [-w/2, w/2]</c>, <c>planY ∈ [-h/2, h/2]</c>). Keeps every monitor base and bezel
        /// fully supported on flat full-height counter surface without overhanging the info slope or edges.
        /// </summary>
        public static void ComputeScreenLayout(bool info, float w, float h, out float screenY, out float[] screenXs) {
            float x0 = -w * .5f;
            float x1 = w * .5f;
            float y0 = -h * .5f;
            float inset = Mathf.Min(.55f, Mathf.Min(w / 3f, h / 3f));
            float a = x0 + inset;
            float b = x1 - inset;
            float mid = (a + b) * .5f;
            float run = Mathf.Max(.1f, b - a);

            float minY = y0 + (info ? .04f : .07f) + .09f;
            float maxY = y0 + inset - .09f - .02f;
            screenY = minY <= maxY ? Mathf.Clamp(y0 + inset * .67f, minY, maxY) : y0 + inset * .55f;

            if (info) {
                float lowWidth = Mathf.Min(.9f, run * .36f);
                float shoulder = Mathf.Min(.32f, run * .16f);
                float shoulderLeft = mid - lowWidth * .5f - shoulder;
                float minX = x0 + .23f;
                float maxX = shoulderLeft - .21f;
                float preferred = a + run * .16f;
                if (minX <= maxX) {
                    screenXs = new[] { Mathf.Clamp(preferred, minX, maxX) };
                    return;
                }
                if (shoulderLeft - x0 >= .32f) {
                    screenXs = new[] { (x0 + shoulderLeft) * .5f };
                    return;
                }
                screenXs = Array.Empty<float>();
                return;
            }

            float safeMin = x0 + .29f;
            float safeMax = x1 - .29f;
            float leftX = Mathf.Max(safeMin, a + run * .2f);
            float rightX = Mathf.Min(safeMax, b - run * .2f);
            if (rightX - leftX >= .44f) {
                screenXs = new[] { leftX, rightX };
                return;
            }
            if (safeMin <= safeMax) {
                screenXs = new[] { mid };
                return;
            }
            screenXs = Array.Empty<float>();
        }

        /// <summary>
        /// Port of <c>sim/booths.ts:boothHeaderHang</c>: resolves the lowest real ceiling underside
        /// within <see cref="HeaderMaxHang"/> (3 m) above <c>HeaderTop</c> at each of the four
        /// overhead-frame corners of an <c>info</c> booth. Returns <c>false</c> when any corner
        /// lacks a ceiling within 3 m (in which case the top bar is omitted).
        /// </summary>
        public static bool TryResolveInfoHeaderHang(StationIndex index, ModuleFacts module, out float[] ceilingZs) {
            ceilingZs = null;
            if (index == null || module == null || !string.Equals(module.Config.Text("kind"), "info", StringComparison.Ordinal)) {
                return false;
            }
            int width = Mathf.Max(1, module.Width);
            int depthPlan = Mathf.Max(1, module.Depth);
            int front = ((module.Config.Int("front", 0) % 4) + 4) % 4;
            double cx = module.X + width * .5;
            double cy = module.Y + depthPlan * .5;
            double w = front % 2 == 1 ? depthPlan : width;
            double h = front % 2 == 1 ? width : depthPlan;
            double hx = Math.Max(0.0, w * .5 - 0.09);
            double hy = Math.Max(0.0, h * .5 - 0.098);
            double minZ = module.ExactZ + 1.0 + HeaderTop;
            double maxZ = minZ + HeaderMaxHang;

            var locals = new (double lx, double ly)[] {
                (-hx, -hy),
                (hx, -hy),
                (-hx, hy),
                (hx, hy),
            };
            var result = new float[4];
            for (int i = 0; i < 4; i++) {
                StationCeilingMounts.RotateLocal(front, locals[i].lx, locals[i].ly, out double rx, out double ry);
                double wx = cx + rx;
                double wy = cy + ry;
                if (!TryBoothCeilingZ(index, wx, wy, minZ, maxZ, out double ceilZ)) return false;
                result[i] = (float)ceilZ;
            }
            ceilingZs = result;
            return true;
        }

        static bool TryBoothCeilingZ(StationIndex index, double wx, double wy, double minZ, double maxZ, out double bestZ) {
            double best = 0;
            bool found = false;
            int cellX = (int)Math.Floor(wx);
            int cellY = (int)Math.Floor(wy);

            void Offer(double z) {
                if (z < minZ - CeilingEps || z > maxZ + CeilingEps) return;
                if (!found || z < best) {
                    best = z;
                    found = true;
                }
            }

            // 1. Explicit solid cells with open air directly below.
            int czMin = (int)Math.Ceiling(minZ - CeilingEps);
            int czMax = (int)Math.Floor(maxZ + CeilingEps);
            for (int cz = czMin; cz <= czMax; cz++) {
                var cell = index.GetCell(cellX, cellY, cz);
                if (cell == null || !cell.IsSolid) continue;
                var below = index.GetCell(cellX, cellY, cz - 1);
                if (below != null && below.IsSolid) continue;
                Offer(cz);
                break;
            }

            // 2. Unexcavated virtual street plane (GroundZ = 0).
            if (StationCeilingMounts.GroundZ >= minZ - CeilingEps &&
                StationCeilingMounts.GroundZ <= maxZ + CeilingEps &&
                (!found || StationCeilingMounts.GroundZ < best) &&
                !StationFootprints.IsGroundHole(index, cellX, cellY)) {
                var belowGround = index.GetCell(cellX, cellY, StationCeilingMounts.GroundZ - 1);
                if (belowGround == null || !belowGround.IsSolid) {
                    Offer(StationCeilingMounts.GroundZ);
                }
            }

            // 3. Overhead non-tunnel track decks (platform or bridge bed).
            var tracks = index.ModulesOfType("track");
            for (int i = 0; i < tracks.Count; i++) {
                var track = tracks[i];
                if (track?.Facts == null || !StationCeilingMounts.IsCeilingTrack(track.Facts)) continue;
                double underside = StationCeilingMounts.TrackCeilingUnderside(track.Facts);
                if (underside < minZ - CeilingEps || underside > maxZ + CeilingEps) continue;
                if (found && underside >= best) continue;
                if (!StationCeilingMounts.TrackCellAt(track.Facts, cellX, cellY, track.Z)) continue;
                var belowTrack = index.GetCell(cellX, cellY, (int)Math.Round(underside) - 1);
                if (belowTrack != null && belowTrack.IsSolid) continue;
                Offer(underside);
            }

            // 4. Overhead roof / canopy modules.
            var roofs = index.ModulesOfType("roof");
            for (int i = 0; i < roofs.Count; i++) {
                var roof = roofs[i];
                if (roof == null) continue;
                if (TryRoofUndersideAt(roof, wx, wy, cellX, cellY, out double roofZ)) {
                    Offer(roofZ);
                }
            }

            bestZ = best;
            return found;
        }

        static bool TryRoofUndersideAt(StationModuleRecord roof, double wx, double wy, int cellX, int cellY, out double z) {
            z = 0;
            int rw = Math.Max(1, roof.Width);
            int rd = Math.Max(1, roof.Depth);
            StationCeilingMounts.RotateLocal(-roof.Rotation, cellX - roof.X, cellY - roof.Y, out double cellLocalX, out double cellLocalY);
            if (cellLocalX < -CeilingEps || cellLocalX >= rw - CeilingEps || cellLocalY < -CeilingEps || cellLocalY >= rd - CeilingEps) {
                return false;
            }
            string variant = roof.Config.Text("variant");
            if (string.IsNullOrEmpty(variant)) {
                string snap = roof.Config.Text("plateSnap");
                if (string.Equals(snap, "lower", StringComparison.Ordinal)) z = roof.Z;
                else if (string.Equals(snap, "upper", StringComparison.Ordinal)) z = roof.Z + 0.75;
                else z = roof.Z + 1.0 + StationRoofRules.Base;
                return true;
            }
            StationCeilingMounts.RotateLocal(-roof.Rotation, wx - (roof.X + 0.5), wy - (roof.Y + 0.5), out _, out double localY);
            double drop = string.Equals(variant, "canopy", StringComparison.Ordinal) ? StationRoofRules.Drop : 0.0;
            double ridgeZ = StationRoofRules.Ridge - drop;
            double eaveZ = StationRoofRules.Eave - drop;
            double crestY = (rd - 1) * 0.5;
            double span = Math.Min(1.0, Math.Abs(localY - crestY) / (rd * 0.5));
            z = roof.Z + 1.0 + ridgeZ - (ridgeZ - eaveZ) * span;
            return true;
        }

        /// <summary>
        /// Build one booth under `parent`, positioned and turned by the shared module
        /// placement (the run centre pivot), using <see cref="StationMaterials"/>.
        /// </summary>
        public static bool TryBuild(ModuleFacts module, Transform parent, StationMaterials materials,
            out GameObject view, out string note, float lift = 0f, StationIndex index = null) {
            if (materials == null) {
                view = null;
                note = "";
                return false;
            }
            return TryBuild(module, parent, BoothPalette.FromStationMaterials(materials), out view, out note, lift, index);
        }

        /// <summary>
        /// Build one booth under `parent`, positioned and turned by the shared module
        /// placement (the run centre pivot), using explicit web-matched materials.
        /// </summary>
        public static bool TryBuild(ModuleFacts module, Transform parent, BoothPalette palette,
            out GameObject view, out string note, float lift = 0f, StationIndex index = null) {
            view = null;
            note = "";
            if (module == null || parent == null || palette == null) return false;
            int width = Mathf.Max(1, module.Width);
            int depthPlan = Mathf.Max(1, module.Depth);
            int front = ((module.Config.Int("front", 0) % 4) + 4) % 4;
            bool info = string.Equals(module.Config.Text("kind"), "info", StringComparison.Ordinal);
            float[] headerCeilings = null;
            if (info && TryResolveInfoHeaderHang(index, module, out var resolvedCeilings)) {
                headerCeilings = resolvedCeilings;
            }
            // The source builds the canonical booth in its turned footprint: an odd front
            // quarter turn swaps the two plan extents before the booth is rotated back.
            float w = front % 2 == 1 ? depthPlan : width;
            float h = front % 2 == 1 ? width : depthPlan;
            var kit = new GeometryKit(parent, Cube(), slot => palette[slot]);
            var tempMeshes = new List<Mesh>(1);
            try {
                var yaw = Quaternion.Euler(0f, -90f * front, 0f);
                // A canonical-axis box at (lx, planY, elevation) with extents (sx, sy, sz).
                void Box(float lx, float planY, float elevation, float sx, float sy, float sz, int slot, int lastTier = 2) =>
                    kit.LocalBox(Vector3.zero, yaw, new Vector3(lx, elevation, planY),
                        new Vector3(sx, sz, sy), slot, lastTier);

                float inset = Mathf.Min(.55f, Mathf.Min(w / 3f, h / 3f));
                const float cap = .08f;
                float top = info ? 1.02f : .96f;
                int body = info ? SlotWhite : SlotBinSteel;
                int rim = info ? SlotWhite : SlotSteel;
                float a = -w * .5f + inset, b = w * .5f - inset, mid = (a + b) * .5f;
                float run = Mathf.Max(.1f, b - a);
                // Side runs own the corners; the back run and counter butt between them.
                if (info) {
                    // Info body and rim share `SlotWhite`: merge vertically into one seamless white shell.
                    float fullH = top + cap - .11f;
                    float fullZ = (top + cap + .11f) * .5f;
                    foreach (float x in new[] { -w * .5f + inset * .5f, w * .5f - inset * .5f }) {
                        Box(x, 0f, fullZ, inset, h, fullH, body);
                    }
                    Box(mid, h * .5f - inset * .5f, fullZ, run, inset, fullH, body);
                    float y0 = -h * .5f;
                    float lowWidth = Mathf.Min(.9f, run * .36f);
                    float shoulder = Mathf.Min(.32f, run * .16f);
                    float[] xs = {
                        a,
                        mid - lowWidth * .5f - shoulder,
                        mid - lowWidth * .5f,
                        mid + lowWidth * .5f,
                        mid + lowWidth * .5f + shoulder,
                        b,
                    };
                    float[] bodyBot = { .11f, .11f, .11f, .11f, .11f, .11f };
                    float[] topLine = { top + cap, top + cap, .72f + cap, .72f + cap, top + cap, top + cap };
                    var counterPrism = BuildProfilePrism(xs, bodyBot, topLine, y0, y0 + inset, "booth info counter");
                    tempMeshes.Add(counterPrism);
                    kit.LocalMesh(Vector3.zero, yaw, counterPrism, body);
                } else {
                    foreach (float x in new[] { -w * .5f + inset * .5f, w * .5f - inset * .5f }) {
                        Box(x, 0f, (top + .11f) * .5f, inset, h, top - .11f, body);
                        Box(x, 0f, top + cap * .5f, inset, h, cap, rim);
                    }
                    Box(mid, h * .5f - inset * .5f, (top + .11f) * .5f, run, inset, top - .11f, body);
                    Box(mid, h * .5f - inset * .5f, top + cap * .5f, run, inset, cap, rim);
                    Box(mid, -h * .5f + inset * .5f, (top + .11f) * .5f, run, inset, top - .11f, body);
                    Box(mid, -h * .5f + inset * .5f, top + cap * .5f, run, inset, cap, rim);
                }
                int kick = info ? SlotSteel : SlotDarkSteel;
                foreach (float planY in new[] { -h * .5f + .015f, h * .5f - .015f })
                    Box(mid, planY, .055f, w, .03f, .11f, kick, lastTier: 1);
                foreach (float x in new[] { -w * .5f + .015f, w * .5f - .015f })
                    Box(x, 0f, .055f, .03f, h, .11f, kick, lastTier: 1);

                if (info) {
                    // Only generate the info overhead canopy when a real ceiling sits within 3 m
                    // above all four frame corners, hanging the frame from that ceiling.
                    if (headerCeilings != null) {
                        float fasciaBottom = HeaderBottom + .045f;
                        foreach (float x in new[] { -w * .5f + .09f, w * .5f - .09f }) {
                            Box(x, 0f, (fasciaBottom + HeaderTop) * .5f, .18f, h, HeaderTop - fasciaBottom, SlotDarkSteel);
                            Box(x, 0f, HeaderBottom + .015f, .18f, h, .03f, SlotWhite, lastTier: 1);
                            Box(x, 0f, HeaderBottom + .0375f, .18f, h, .015f, SlotGateRed, lastTier: 0);
                        }
                        foreach (float planY in new[] { -h * .5f + .098f, h * .5f - .098f }) {
                            Box(mid, planY, (fasciaBottom + HeaderTop) * .5f, w - .36f, .18f, HeaderTop - fasciaBottom, SlotDarkSteel);
                            Box(mid, planY, HeaderBottom + .015f, w - .36f, .18f, .03f, SlotWhite, lastTier: 1);
                            Box(mid, planY, HeaderBottom + .0375f, w - .36f, .18f, .015f, SlotGateRed, lastTier: 0);
                        }
                        foreach (float planY in new[] { -h * .5f + .1f, h * .5f - .1f })
                            Box(mid, planY, HeaderBottom - .015f, w - .36f, .12f, .03f, SlotHeadlight, lastTier: 1);
                        foreach (float x in new[] { -w * .5f + .1f, w * .5f - .1f })
                            Box(x, 0f, HeaderBottom - .015f, .12f, h - .36f, .03f, SlotHeadlight, lastTier: 1);

                        float hx = Mathf.Max(0f, w * .5f - .09f);
                        float hy = Mathf.Max(0f, h * .5f - .098f);
                        var corners = new (float rx, float ry)[] {
                            (-hx, -hy),
                            (hx, -hy),
                            (-hx, hy),
                            (hx, hy),
                        };
                        float floorTop = (float)module.ExactZ + 1f + lift;
                        for (int i = 0; i < 4; i++) {
                            float ceilLocal = headerCeilings[i] - floorTop;
                            float drop = Mathf.Max(0f, ceilLocal - HeaderTop);
                            if (drop > .04f) {
                                float rodH = drop - .04f;
                                Box(corners[i].rx, corners[i].ry, HeaderTop + rodH * .5f, .05f, .05f, rodH, SlotSteel, lastTier: 1);
                                Box(corners[i].rx, corners[i].ry, ceilLocal - .02f, .14f, .14f, .04f, SlotDarkSteel, lastTier: 0);
                            } else if (drop > .005f) {
                                Box(corners[i].rx, corners[i].ry, HeaderTop + drop * .5f, .14f, .14f, drop, SlotDarkSteel, lastTier: 0);
                            }
                        }
                    }
                } else {
                    // Open rectangular overhead frame supported by corner posts and glazing.
                    foreach (float x in new[] { -w * .5f + .09f, w * .5f - .09f })
                        Box(x, 0f, (HeaderBottom + HeaderTop) * .5f, .18f, h, HeaderTop - HeaderBottom, SlotBinSteel);
                    foreach (float planY in new[] { -h * .5f + .098f, h * .5f - .098f })
                        Box(mid, planY, (HeaderBottom + HeaderTop) * .5f, w - .36f, .18f, HeaderTop - HeaderBottom, SlotBinSteel);
                    Glaze(Box, w, h, top, cap, mid);
                }

                // Counter fittings: flush on solid flat countertop (`BoothModel.ts`).
                ComputeScreenLayout(info, w, h, out float screenY, out var screens);
                var screenBox = ScreenCube();
                for (int i = 0; i < screens.Length; i++) {
                    float x = screens[i];
                    Box(x, screenY, top + cap + .0175f, .28f, .18f, .035f, SlotBlack, lastTier: 1);
                    Box(x, screenY, top + cap + .10f, .035f, .04f, .15f, SlotDarkSteel, lastTier: 1);
                    Box(x, screenY, top + cap + .23f, .34f, .045f, .23f, SlotBlack, lastTier: 1);
                    kit.LocalBoxMesh(Vector3.zero, yaw,
                        new Vector3(x, top + cap + .23f, screenY - .024f),
                        new Vector3(.30f, .19f, .002f),
                        screenBox, SlotScreen, lastTier: 1);
                }
                view = kit.Finish(string.IsNullOrEmpty(module.Id) ? "booth" : module.Id);
            } catch (Exception error) {
                DestroyNow(kit.Root ? kit.Root.gameObject : null);
                note = error.GetType().Name + ": " + error.Message;
                return false;
            } finally {
                for (int i = 0; i < tempMeshes.Count; i++) DestroyNow(tempMeshes[i]);
            }
            view.transform.SetPositionAndRotation(Pivot(module, lift), Quaternion.identity);
            return true;
        }

        static void Glaze(Action<float, float, float, float, float, float, int, int> box,
            float w, float h, float top, float cap, float mid) {
            const float post = .08f;
            float glassBottom = top + cap;
            float glassTop = HeaderBottom;
            float glassHeight = Mathf.Max(.05f, glassTop - glassBottom);
            float glassMid = (glassBottom + glassTop) * .5f;
            foreach (float x in new[] { -w * .5f + post * .5f, w * .5f - post * .5f }) {
                foreach (float planY in new[] { -h * .5f + post * .5f, h * .5f - post * .5f })
                    box(x, planY, glassMid, post, post, glassHeight, SlotDarkSteel, 1);
                box(x, 0f, glassMid, .025f, h - 2 * post, glassHeight, SlotGlass, 2);
            }
            box(mid, h * .5f - .04f, glassMid, w - 2 * post, .025f, glassHeight, SlotGlass, 2);
            int bays = Mathf.Max(1, Mathf.FloorToInt((w - .16f) / 1.6f));
            float bayWidth = (w - 2 * post) / bays;
            for (int i = 0; i < bays; i++) {
                float x = -w * .5f + post + bayWidth * (i + .5f);
                float sill = glassBottom + .16f;
                box(x, -h * .5f + .04f, (sill + glassTop) * .5f, bayWidth - .03f, .025f, glassTop - sill, SlotGlass, 2);
                box(x, -h * .5f + .04f, sill, bayWidth - .03f, .045f, .035f, SlotSteel, 1);
                if (i > 0) box(x - bayWidth * .5f, -h * .5f + .04f, glassMid, .03f, .06f, glassHeight, SlotDarkSteel, 1);
            }
        }

        /// <summary>
        /// Build a closed, flat-shaded, outward-wound prism extruded along canonical <c>planY</c>
        /// (<c>z</c> in Unity local space) from <paramref name="z0"/> to <paramref name="z1"/> for
        /// an x-monotone vertical strip profile (<c>xs[i]</c>, <c>bottoms[i]..tops[i]</c>).
        /// Matches <c>BoothModel.ts</c> <c>profile()</c> with zero internal faces.
        /// </summary>
        static Mesh BuildProfilePrism(float[] xs, float[] bottoms, float[] tops, float z0, float z1, string name) {
            int segs = xs.Length - 1;
            var verts = new List<Vector3>((segs * 4 + 2) * 4);
            var norms = new List<Vector3>((segs * 4 + 2) * 4);
            var uvs = new List<Vector2>((segs * 4 + 2) * 4);
            var tris = new List<int>((segs * 4 + 2) * 6);

            void Quad(Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3, Vector3 outward,
                Vector2 uv0, Vector2 uv1, Vector2 uv2, Vector2 uv3) {
                var normal = outward.normalized;
                int start = verts.Count;
                verts.Add(p0); verts.Add(p1); verts.Add(p2); verts.Add(p3);
                norms.Add(normal); norms.Add(normal); norms.Add(normal); norms.Add(normal);
                uvs.Add(uv0); uvs.Add(uv1); uvs.Add(uv2); uvs.Add(uv3);
                bool flip = Vector3.Dot(Vector3.Cross(p1 - p0, p2 - p0), normal) < 0f;
                if (flip) {
                    tris.Add(start); tris.Add(start + 2); tris.Add(start + 1);
                    tris.Add(start); tris.Add(start + 3); tris.Add(start + 2);
                } else {
                    tris.Add(start); tris.Add(start + 1); tris.Add(start + 2);
                    tris.Add(start); tris.Add(start + 2); tris.Add(start + 3);
                }
            }

            float xOrigin = xs[0];
            float depth = z1 - z0;
            for (int i = 0; i < segs; i++) {
                float x0 = xs[i], x1 = xs[i + 1];
                if (x1 - x0 <= 1e-5f) continue;
                float b0 = bottoms[i], b1 = bottoms[i + 1];
                float t0 = tops[i], t1 = tops[i + 1];
                float u0 = x0 - xOrigin, u1 = x1 - xOrigin;

                // Front cap (planY = z0, outward = -Z)
                Quad(
                    new Vector3(x0, b0, z0), new Vector3(x0, t0, z0),
                    new Vector3(x1, t1, z0), new Vector3(x1, b1, z0),
                    Vector3.back,
                    new Vector2(u0, b0), new Vector2(u0, t0),
                    new Vector2(u1, t1), new Vector2(u1, b1));

                // Back cap (planY = z1, outward = +Z)
                Quad(
                    new Vector3(x1, b1, z1), new Vector3(x1, t1, z1),
                    new Vector3(x0, t0, z1), new Vector3(x0, b0, z1),
                    Vector3.forward,
                    new Vector2(u1, b1), new Vector2(u1, t1),
                    new Vector2(u0, t0), new Vector2(u0, b0));

                // Top surface (along (x0, t0) -> (x1, t1), outward = (-(t1-t0), x1-x0, 0))
                var topNormal = new Vector3(-(t1 - t0), x1 - x0, 0f);
                Quad(
                    new Vector3(x0, t0, z0), new Vector3(x0, t0, z1),
                    new Vector3(x1, t1, z1), new Vector3(x1, t1, z0),
                    topNormal,
                    new Vector2(u0, 0f), new Vector2(u0, depth),
                    new Vector2(u1, depth), new Vector2(u1, 0f));

                // Bottom surface (along (x0, b0) -> (x1, b1), outward = (b1-b0, -(x1-x0), 0))
                var botNormal = new Vector3(b1 - b0, -(x1 - x0), 0f);
                Quad(
                    new Vector3(x0, b0, z1), new Vector3(x0, b0, z0),
                    new Vector3(x1, b1, z0), new Vector3(x1, b1, z1),
                    botNormal,
                    new Vector2(u0, depth), new Vector2(u0, 0f),
                    new Vector2(u1, 0f), new Vector2(u1, depth));
            }

            // Left end cap (x = xs[0], outward = -X)
            Quad(
                new Vector3(xs[0], bottoms[0], z1), new Vector3(xs[0], tops[0], z1),
                new Vector3(xs[0], tops[0], z0), new Vector3(xs[0], bottoms[0], z0),
                Vector3.left,
                new Vector2(depth, bottoms[0]), new Vector2(depth, tops[0]),
                new Vector2(0f, tops[0]), new Vector2(0f, bottoms[0]));

            // Right end cap (x = xs[segs], outward = +X)
            Quad(
                new Vector3(xs[segs], bottoms[segs], z0), new Vector3(xs[segs], tops[segs], z0),
                new Vector3(xs[segs], tops[segs], z1), new Vector3(xs[segs], bottoms[segs], z1),
                Vector3.right,
                new Vector2(0f, bottoms[segs]), new Vector2(0f, tops[segs]),
                new Vector2(depth, tops[segs]), new Vector2(depth, bottoms[segs]));

            var mesh = new Mesh { name = name };
            mesh.SetVertices(verts);
            mesh.SetNormals(norms);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateBounds();
            return mesh;
        }

        static Material ExtractNamedMaterial(GameObject prefab, string targetName) {
            if (!prefab || string.IsNullOrEmpty(targetName)) return null;
            foreach (var renderer in prefab.GetComponentsInChildren<MeshRenderer>(true)) {
                var shared = renderer.sharedMaterials;
                for (int i = 0; i < shared.Length; i++) {
                    var mat = shared[i];
                    if (!mat) continue;
                    if (string.Equals(OutdoorModuleViews.MaterialBaseName(mat.name), targetName, StringComparison.OrdinalIgnoreCase))
                        return mat;
                }
            }
            return null;
        }

        /// <summary>
        /// The footprint centre at the cell's floor top. `BoothModel` draws its canonical
        /// room in **world axes** and owns its orientation through `cfg.front`; the saved
        /// <c>rot</c> is not a turn of a booth (the source never reads it), so neither the
        /// pivot nor the geometry may follow it.
        /// </summary>
        static Vector3 Pivot(ModuleFacts module, float lift = 0f) {
            var document = new Vector3(
                module.X + Mathf.Max(1, module.Width) * .5f,
                module.Y + Mathf.Max(1, module.Depth) * .5f,
                (float)module.ExactZ + 1f + lift);
            return StationCoordinates.Point(document);
        }

        static void DestroyNow(UnityEngine.Object value) {
            if (!value) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }

        /// <summary>
        /// The booth's unit cube. RCA 15 §3: this used to be a hand-built 8-vertex box whose
        /// index table did not match its own bit order (x = bit 0, y = bit 1, z = bit 2), so
        /// every quad was a bowtie and `RecalculateNormals` smoothed the shell into artifacts.
        /// The opening builder's cube is already per-face with correct winding and normals, so
        /// the booth reuses it rather than carrying a second table.
        /// </summary>
        static Mesh BuildCube(bool flipV, string name) {
            var source = OpeningBuilder.UnitCube;
            var mesh = new Mesh { name = name };
            mesh.vertices = source.vertices;
            mesh.normals = source.normals;
            var sourceUvs = source.uv;
            if (flipV) {
                var uvs = new Vector2[sourceUvs.Length];
                for (int i = 0; i < sourceUvs.Length; i++)
                    uvs[i] = new Vector2(sourceUvs[i].x, 1f - sourceUvs[i].y);
                mesh.uv = uvs;
            } else {
                mesh.uv = sourceUvs;
            }
            mesh.triangles = source.triangles;
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
