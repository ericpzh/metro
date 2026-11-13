using UnityEngine;

namespace Metro.View {
    /// <summary>
    /// Scene binding for the local soft-human profile. A public build has no anchor
    /// and therefore no internal passenger asset; the local verifier scene carries
    /// one. The renderer reports <c>passenger-catalogue-missing</c> rather than
    /// selecting the <c>passenger-adult.glb</c> stand-in.
    ///
    /// It is its own script file because Unity only attaches a MonoBehaviour whose
    /// class name matches the file name; the lead's scene builder adds it to the local
    /// scene only (the public scene must stay unbound; see `unity/tests/passenger-profile.test.mjs`).
    /// </summary>
    [AddComponentMenu("Metro/Passenger Catalogue Anchor")]
    [DisallowMultipleComponent]
    public sealed class PassengerCatalogueAnchor : MonoBehaviour {
        public PassengerCatalogue catalogue;

        static PassengerCatalogueAnchor active;
        static PassengerCatalogue injected;

        /// <summary>The anchor the last Awake registered, if its asset is still alive.</summary>
        public static PassengerCatalogueAnchor Active => active;

        public static void Inject(PassengerCatalogue catalogue) => injected = catalogue;
        public static void ClearInjection() => injected = null;

        /// <summary>The bound catalogue, or null. Never substitutes a stand-in catalogue.</summary>
        public static PassengerCatalogue Resolve() {
            if (injected != null) return injected;
            if (active != null && active.catalogue != null) return active.catalogue;
            var found = FindAnyObjectByType<PassengerCatalogueAnchor>();
            if (found != null && found.catalogue != null) {
                active = found;
                return found.catalogue;
            }
            return null;
        }

        void Awake() {
            if (catalogue != null) active = this;
        }

        void OnDestroy() {
            if (active == this) active = null;
        }
    }
}