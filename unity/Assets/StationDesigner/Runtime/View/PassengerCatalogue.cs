using System;
using System.Collections.Generic;
using UnityEngine;

namespace Metro.View {
    /// <summary>
    /// One walk gait profile, exactly the manifest's <c>walkProfiles</c> row
    /// (`slow` 0.9 m/s, `medium` 1.15 m/s, `fast` 1.4 m/s, all a 1.12 s cycle).
    /// </summary>
    [Serializable]
    public struct PassengerWalkProfileSpec {
        public string name;
        public double speed;
        public double cycleSeconds;
        public double stride;
        public int firstFrame;
    }

    /// <summary>
    /// The rig and clip bindings shared by every recipe. The 440 prefabs are the
    /// same 16-bone soft-human body with the same 49 clips; the builder loads this
    /// set from the canonical recipe and validates that every recipe resolves the
    /// same clip names, so the catalogue records one clip table instead of 440
    /// copies. A recipe whose rig does not match this table fails the build.
    /// </summary>
    [Serializable]
    public sealed class PassengerClipSet {
        public string modelPath = "";
        public AnimationClip[] clips = Array.Empty<AnimationClip>();
        public string[] clipNames = Array.Empty<string>();
        public float[] clipDurations = Array.Empty<float>();
        public string[] bones = Array.Empty<string>();
        public PassengerWalkProfileSpec[] walkProfiles = Array.Empty<PassengerWalkProfileSpec>();
        public int walkFrames = 24;
    }

    /// <summary>
    /// One manifest row, keyed by the source recipe ID. The recipe ID is the only
    /// appearance selector the renderer accepts; a simulation ID never indexes the
    /// array directly.
    /// </summary>
    [Serializable]
    public sealed class PassengerCatalogueEntry {
        public int index;
        public string recipe = "";
        public string sex = "";
        public string outfit = "";
        public string accessory = "";
        public string accessoryType = "";
        public string accessorySide = "";
        public string garmentShape = "";
        public string modelPath = "";
        public string prefabPath = "";
        public GameObject prefab;
        /// <summary>SHA-256 of the promoted recipe GLB (manifest <c>sha256</c>).</summary>
        public string assetSha256 = "";
        /// <summary>SHA-256 of the shared recipe bake (manifest <c>source.recipeSha256</c>).</summary>
        public string recipeSha256 = "";
        public bool adultEligible = true;
        public bool childEligible = true;
        public bool fullDetail = true;
        /// <summary>The manifest declares a runtime Low variant of this recipe's vertices.</summary>
        public bool lowDetail = true;
        public int triangles;
        public int lowTriangles;
        public float baseHeightMetres = 1.70f;
        public float assetHeightMetres;
        public string rights = "";
        public string[] bones = Array.Empty<string>();
    }

    /// <summary>
    /// The validated soft-human recipe catalogue the local verifier renders from.
    /// It is built by <c>Metro.Editor.PassengerCatalogueBuilder</c> from the exact
    /// 440-row library manifest and must never be shipped in a public pack: the
    /// assets are <c>INTERNAL_REVIEW_ONLY</c> and the production rig is blocked.
    ///
    /// Selection is deterministic over the **same ordered eligible pools** as the
    /// source: manifest order, filtered by <c>childEligible</c>/<c>adultEligible</c>,
    /// indexed by an identity hash. Child and Low are runtime variants of a recipe
    /// ID, not extra rows (the manifest says so, and the builder keeps that true).
    /// </summary>
    [CreateAssetMenu(menuName = "Metro/Passenger Catalogue", fileName = "PassengerCatalogue")]
    public sealed class PassengerCatalogue : ScriptableObject {
        /// <summary>Inside the internal passenger root, so a public pack excludes one folder.</summary>
        public const string AssetPath = "Assets/StationDesigner/Generated/Passengers/passenger-catalogue.asset";
        public const string ManifestPath = "Assets/StationDesigner/Generated/Passengers/passenger-library.manifest.json";
        public const string InternalRoot = "Assets/StationDesigner/Generated/Passengers";
        /// <summary>The retained Low-topology sample; the comparison target for Low parity.</summary>
        public const string LowSamplePath = "Assets/StationDesigner/Generated/Models/soft-human-adult-commuter-daypack-low.glb";

        public int schemaVersion = 1;
        public string manifestPath = ManifestPath;
        public string manifestSha256 = "";
        public string family = "passenger-library";
        public string rights = "";
        public string sourcePath = "";
        public string sourceSha256 = "";
        public string recipeSha256 = "";
        public PassengerClipSet clipSet = new PassengerClipSet();
        public PassengerCatalogueEntry[] entries = Array.Empty<PassengerCatalogueEntry>();

        Dictionary<string, PassengerCatalogueEntry> index;
        int[] adultPool;
        int[] childPool;

        public int Count => entries?.Length ?? 0;
        public int AdultPoolCount { get { EnsureIndex(); return adultPool.Length; } }
        public int ChildPoolCount { get { EnsureIndex(); return childPool.Length; } }
        public int ClipCount => clipSet?.clips?.Length ?? 0;

        void OnEnable() => Invalidate();

        /// <summary>Drop the derived lookup/pools after an edit (tests and the builder call this).</summary>
        public void Invalidate() {
            index = null;
            adultPool = null;
            childPool = null;
        }

        public void EnsureIndex() {
            if (index != null && adultPool != null && childPool != null) return;
            index = new Dictionary<string, PassengerCatalogueEntry>(StringComparer.Ordinal);
            var adults = new List<int>();
            var children = new List<int>();
            var rows = entries ?? Array.Empty<PassengerCatalogueEntry>();
            for (int i = 0; i < rows.Length; i++) {
                var entry = rows[i];
                if (entry == null || string.IsNullOrEmpty(entry.recipe)) continue;
                index[entry.recipe] = entry;
                if (entry.adultEligible) adults.Add(i);
                if (entry.childEligible) children.Add(i);
            }
            adultPool = adults.ToArray();
            childPool = children.ToArray();
        }

        /// <summary>The ordered eligible pool for one age, as manifest indices.</summary>
        public int[] Pool(bool child) { EnsureIndex(); return child ? childPool : adultPool; }

        /// <summary>Compare the ordered pool with an expected sequence (the TS oracle's pools).</summary>
        public bool PoolEquals(int[] expected, bool child) {
            var pool = Pool(child);
            if (expected == null || expected.Length != pool.Length) return false;
            for (int i = 0; i < pool.Length; i++) if (pool[i] != expected[i]) return false;
            return true;
        }

        public bool TryGet(string recipeId, out PassengerCatalogueEntry entry) {
            entry = null;
            if (string.IsNullOrEmpty(recipeId)) return false;
            EnsureIndex();
            return index.TryGetValue(recipeId, out entry) && entry != null && entry.prefab != null;
        }

        public bool TryGetAt(int entryIndex, out PassengerCatalogueEntry entry) {
            entry = null;
            var rows = entries ?? Array.Empty<PassengerCatalogueEntry>();
            if (entryIndex < 0 || entryIndex >= rows.Length) return false;
            entry = rows[entryIndex];
            return entry != null && entry.prefab != null;
        }

        /// <summary>
        /// The source's pool index for an identity hash: <c>floor(hash / 2^32 * pool.Length)</c>
        /// over the ordered eligible pool. Returns -1 when the pool is empty.
        /// </summary>
        public int SelectIndex(uint hash, bool child) {
            var pool = Pool(child);
            if (pool.Length == 0) return -1;
            int at = (int)Math.Floor(hash / 4294967296.0 * pool.Length);
            if (at < 0) at = 0;
            if (at >= pool.Length) at = pool.Length - 1;
            return pool[at];
        }

        /// <summary>Resolve the recipe a stable simulation ID selects (identity only, no RNG).</summary>
        public bool TryGetForSimId(int simId, out PassengerCatalogueEntry entry) {
            entry = null;
            bool child = PassengerAppearance.IsChild(simId);
            int at = SelectIndex(PassengerAppearance.IdentityHash(simId, PassengerAppearance.OutfitSalt), child);
            return TryGetAt(at, out entry);
        }

        /// <summary>The recipe a simulation ID selects, or "" when the catalogue cannot serve it.</summary>
        public string RecipeForSimId(int simId) => TryGetForSimId(simId, out var entry) ? entry.recipe : "";

        public PassengerWalkProfileSpec WalkProfile(int profile) {
            var profiles = clipSet?.walkProfiles;
            if (profiles != null && profile >= 0 && profile < profiles.Length) return profiles[profile];
            // The catalogue builder always supplies the three manifest profiles. A
            // hand-made asset without them still has the source's own table here.
            return PassengerAppearance.DefaultWalkProfiles[
                profile < 0 ? 0 : profile >= PassengerAppearance.DefaultWalkProfiles.Length
                    ? PassengerAppearance.DefaultWalkProfiles.Length - 1 : profile];
        }

        public AnimationClip Clip(string name) {
            var clips = clipSet?.clips;
            var names = clipSet?.clipNames;
            if (clips == null || names == null) return null;
            for (int i = 0; i < clips.Length && i < names.Length; i++) {
                if (string.Equals(names[i], name, StringComparison.Ordinal)) return clips[i];
            }
            return null;
        }

        /// <summary>Structural validation (no AssetDatabase); the builder adds manifest/import checks.</summary>
        public PassengerCatalogueReport Verify() {
            var problems = new List<string>();
            var rows = entries ?? Array.Empty<PassengerCatalogueEntry>();
            if (rows.Length == 0) problems.Add("catalogue has no entries");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < rows.Length; i++) {
                var entry = rows[i];
                if (entry == null) { problems.Add("entry " + i + " is null"); continue; }
                if (entry.index != i) problems.Add(entry.recipe + ": index " + entry.index + " != row " + i);
                if (string.IsNullOrEmpty(entry.recipe)) { problems.Add("entry " + i + " has no recipe id"); continue; }
                if (!seen.Add(entry.recipe)) problems.Add(entry.recipe + ": duplicate recipe id");
                if (entry.prefab == null) problems.Add(entry.recipe + ": prefab reference is missing");
                else if (entry.prefab.name != entry.recipe) problems.Add(entry.recipe + ": prefab is named " + entry.prefab.name);
                if (string.IsNullOrEmpty(entry.prefabPath)) problems.Add(entry.recipe + ": no prefab path");
                if (string.IsNullOrEmpty(entry.modelPath)) problems.Add(entry.recipe + ": no model path");
                if (string.IsNullOrEmpty(entry.assetSha256)) problems.Add(entry.recipe + ": no source hash");
                if (entry.bones == null || entry.bones.Length == 0) problems.Add(entry.recipe + ": no bone table");
                if (!entry.adultEligible && !entry.childEligible) problems.Add(entry.recipe + ": eligible for no age");
            }
            var clips = clipSet?.clips ?? Array.Empty<AnimationClip>();
            var names = clipSet?.clipNames ?? Array.Empty<string>();
            if (clips.Length == 0) problems.Add("clip set has no clips");
            if (clips.Length != names.Length) problems.Add("clip set names " + names.Length + " != clips " + clips.Length);
            for (int i = 0; i < clips.Length && i < names.Length; i++) {
                if (clips[i] == null) problems.Add("clip " + names[i] + " is not bound");
            }
            var bones = clipSet?.bones ?? Array.Empty<string>();
            if (bones.Length != 16) problems.Add("clip set bones " + bones.Length + " != 16");
            var profiles = clipSet?.walkProfiles ?? Array.Empty<PassengerWalkProfileSpec>();
            if (profiles.Length != 3) problems.Add("walk profiles " + profiles.Length + " != 3");
            EnsureIndex();
            if (adultPool.Length == 0) problems.Add("adult pool is empty");
            if (childPool.Length == 0) problems.Add("child pool is empty");
            return new PassengerCatalogueReport {
                Entries = rows.Length, AdultPool = adultPool.Length, ChildPool = childPool.Length,
                Clips = clips.Length, Bones = bones.Length, Problems = problems.ToArray(),
            };
        }
    }

    /// <summary>Counts and problems from <see cref="PassengerCatalogue.Verify"/>.</summary>
    public struct PassengerCatalogueReport {
        public int Entries;
        public int AdultPool;
        public int ChildPool;
        public int Clips;
        public int Bones;
        public string[] Problems;
        public bool Ok => Problems == null || Problems.Length == 0;
        public override string ToString() =>
            "PassengerCatalogue " + Entries + " entries, pools " + AdultPool + "/" + ChildPool +
            ", " + Clips + " clips, " + Bones + " bones" + (Ok ? "" : ", " + Problems.Length + " problems");
    }
}