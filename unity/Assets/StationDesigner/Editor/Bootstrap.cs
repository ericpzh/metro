namespace Metro.Editor {
    /// <summary>
    /// Shared Editor asset paths. The original bootstrap scene generator was retired
    /// when the project consolidated to a single scene
    /// (<c>StationGameLocal.unity</c>); only the font path is still consumed by the
    /// scene generator.
    /// </summary>
    public static class Bootstrap {
        public const string FontPath = "Assets/StationDesigner/Fonts/NotoSansSC.ttf";
    }
}
