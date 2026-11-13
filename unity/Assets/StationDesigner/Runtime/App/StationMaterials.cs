using System;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// The station palette shared by the authored cell batching and the runtime
    /// assemblies, so a generated stair and a committed block read as one material
    /// family and the whole station keeps one small material list. Public because a
    /// sign/board builder takes it as a parameter in its own public surface.
    /// </summary>
    public sealed class StationMaterials : IDisposable {
        public static readonly Color32[] Colours = {
            new Color32(184,185,178,255), new Color32(141,151,153,255), new Color32(219,212,195,255),
            new Color32(79,113,67,255), new Color32(93,106,110,255), new Color32(61,69,76,255),
            new Color32(181,192,195,255), new Color32(42,107,118,255), new Color32(217,169,61,255),
            new Color32(139,77,59,255), new Color32(79,140,148,255), new Color32(83,60,49,255),
            new Color32(75,120,58,255), new Color32(215,227,225,255),
        };
        // Generated glass and steel read apart from the block greys without adding gloss.
        public const int Glass = 10, Steel = 6, Dark = 5, Light = 13, Line = 7, Warm = 8, Track = 5, Platform = 2;

        readonly Material[] materials;

        public StationMaterials(Shader shader) {
            if (!shader) throw new ArgumentNullException(nameof(shader));
            materials = new Material[Colours.Length];
            for (int i = 0; i < materials.Length; i++) materials[i] = new Material(shader) { color = Colours[i] };
        }

        public Material this[int colour] => materials[Mathf.Clamp(colour, 0, materials.Length - 1)];

        public void Dispose() {
            foreach (var material in materials) UnityEngine.Object.Destroy(material);
        }
    }
}
