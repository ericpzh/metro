using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.App {
    /// <summary>
    /// The one place a **generated** glass material is configured (plan 13 §2c).
    ///
    /// The source renders glass as `MeshStandardMaterial` clones with `transparent: true`
    /// and their own opacity (`PieceBuilder.glass` 0.26 / `tintedGlass` 0.4, the lift
    /// cabin 0.2, PSD panes a little above them). The Unity port built the same parts from
    /// ordinary URP/Lit materials whose alpha was simply discarded: a Lit material stays on
    /// the opaque pass, writes depth, and outputs alpha 1, so lift shafts, PSD panes and
    /// balustrades all read as solid painted panels.
    ///
    /// Colour alone cannot fix that — URP Lit needs the transparent *surface* (blend,
    /// depth-write policy and queue) set together with the tint. This factory is the only
    /// place those are set, and it never touches an imported (glTFast) material: importing
    /// already produces transparent materials with the right queue, and mutating a shared
    /// imported asset would corrupt every instance of it.
    /// </summary>
    public static class StationGlass {
        /// <summary>The transparent render queue URP's own Lit material uses.</summary>
        public const int TransparentQueue = (int)RenderQueue.Transparent;

        /// <summary>Whether a material is already configured for the transparent surface.</summary>
        public static bool IsTransparent(Material material) =>
            material && material.HasProperty("_Surface") && material.GetFloat("_Surface") > 0.5f;

        /// <summary>
        /// Build a transparent URP Lit glass material. <paramref name="tint"/> is the
        /// authored sRGB colour (converted to linear, as `THREE.Color` does);
        /// <paramref name="opacity"/> is the source's alpha.
        /// </summary>
        public static Material Create(Shader shader, string name, Color tint, float opacity,
            float smoothness = 0.94f, float metallic = 0f, bool doubleSided = true) {
            if (!shader) throw new System.ArgumentNullException(nameof(shader));
            var material = new Material(shader) { name = name };
            Apply(material, tint.linear, opacity, smoothness, metallic, doubleSided);
            return material;
        }

        /// <summary>
        /// Turn an already-created material into the transparent surface. The palette
        /// builders mint their materials in a loop (one per colour), so the glass entries
        /// are configured in place instead of being replaced.
        /// </summary>
        public static void MakeTransparent(Material material, float opacity, float smoothness = 0.94f, float metallic = 0f, bool doubleSided = true) {
            if (!material) return;
            var tint = material.HasProperty("_BaseColor") ? material.GetColor("_BaseColor")
                : material.HasProperty("_Color") ? material.GetColor("_Color")
                : Color.white;
            // A palette mints `color = <sRGB byte colour>`, which URP stores as raw gamma
            // values; the source converts to linear in `new THREE.Color(hex)`. Convert once.
            tint = tint.linear;
            Apply(material, tint, opacity, smoothness, metallic, doubleSided);
        }

        static void Apply(Material material, Color tint, float opacity, float smoothness, float metallic, bool doubleSided) {
            var colour = tint;
            colour.a = Mathf.Clamp01(opacity);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", colour);
            if (material.HasProperty("_Color")) material.SetColor("_Color", colour);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", smoothness);
            if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", metallic);
            if (material.HasProperty("_Cull")) material.SetFloat("_Cull", doubleSided ? 0f : 2f);

            // URP's transparent surface: alpha blend, no depth write, queued after opaque.
            // All four are needed; the keyword is what makes the fragment keep its alpha
            // (`OutputAlpha`) instead of forcing 1.
            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
            if (material.HasProperty("_Blend")) material.SetFloat("_Blend", 0f);
            if (material.HasProperty("_SrcBlend")) material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            if (material.HasProperty("_DstBlend")) material.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
            if (material.HasProperty("_SrcBlendAlpha")) material.SetFloat("_SrcBlendAlpha", (float)BlendMode.One);
            if (material.HasProperty("_DstBlendAlpha")) material.SetFloat("_DstBlendAlpha", (float)BlendMode.OneMinusSrcAlpha);
            if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.DisableKeyword("_ALPHAPREMULTIPLY_ON");
            material.SetOverrideTag("RenderType", "Transparent");
            material.renderQueue = TransparentQueue;
            material.enableInstancing = true;
        }
    }
}
