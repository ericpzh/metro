using System;
using Metro.View;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Metro.Editor {
    /// <summary>
    /// Binds the internal soft-human catalogue for the **local-only** passenger scene at
    /// Play Mode entry. Plan 11 H3 keeps every internal passenger asset out of public
    /// artefacts, and <c>unity/tests/passenger-profile.test.mjs</c> enforces it by
    /// refusing a serialized reference to the catalogue from any asset outside
    /// <c>Generated/Passengers</c>. So <c>StationGameLocal.unity</c> carries an
    /// unassigned <see cref="PassengerCatalogueAnchor"/> marker and this Editor hook
    /// injects the catalogue in memory when that scene starts playing. Nothing is
    /// serialized, so no public asset references the internal library.
    ///
    /// The injection is Editor-only on purpose: a WebGL local profile needs its own
    /// build-time path (still open in H3), not a scene reference smuggled in here.
    /// </summary>
    [InitializeOnLoad]
    public static class LocalPassengerInjection {
        /// <summary>The scene the injection applies to; every other scene keeps the public profile.</summary>
        public const string LocalSceneName = "StationGameLocal";

        static LocalPassengerInjection() {
            EditorApplication.playModeStateChanged -= OnPlayModeChanged;
            EditorApplication.playModeStateChanged += OnPlayModeChanged;
        }

        /// <summary>Inject now (a menu item and the smoke command can call this in Play Mode).</summary>
        [MenuItem("Metro/Station Game/Inject Local Passenger Catalogue (Play Mode)")]
        public static void InjectNow() {
            var catalogue = AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(PassengerCatalogue.AssetPath);
            if (!catalogue) {
                Debug.LogError("LOCAL_PASSENGER_INJECT_FAILED: no catalogue at " + PassengerCatalogue.AssetPath);
                return;
            }
            PassengerCatalogueAnchor.Inject(catalogue);
            Debug.Log($"STATION_LOCAL_PASSENGER_INJECTED scene={SceneManager.GetActiveScene().name} count={catalogue.Count} rights={catalogue.rights}");
        }

        static void OnPlayModeChanged(PlayModeStateChange change) {
            if (change == PlayModeStateChange.EnteredPlayMode) {
                var sceneName = SceneManager.GetActiveScene().name;
                bool isLocalScene = string.Equals(sceneName, LocalSceneName, StringComparison.Ordinal);
                bool isInteractiveStationGame =
                    string.Equals(sceneName, "StationGame", StringComparison.Ordinal) &&
                    !Application.isBatchMode &&
                    AssetDatabase.LoadAssetAtPath<PassengerCatalogue>(PassengerCatalogue.AssetPath) != null;
                if (!isLocalScene && !isInteractiveStationGame) return;
                InjectNow();
            } else if (change == PlayModeStateChange.EnteredEditMode) {
                PassengerCatalogueAnchor.ClearInjection();
            }
        }
    }
}
