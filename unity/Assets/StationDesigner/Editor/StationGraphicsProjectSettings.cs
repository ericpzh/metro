using System.Collections.Generic;
using Metro.App;
using UnityEditor;
using UnityEngine;

namespace Metro.Editor {
    static class StationGraphicsProjectSettings {
        [SettingsProvider]
        public static SettingsProvider Create() {
            SerializedObject settings = null;
            return new SettingsProvider("Project/Station Designer/Graphics", SettingsScope.Project) {
                label = "Graphics",
                keywords = new HashSet<string> { "Graphics", "Model", "Detail", "LOD", "Quality" },
                activateHandler = (_, _) => settings = new SerializedObject(StationModelDetailConfiguration.Load()),
                guiHandler = _ => {
                    settings.Update();
                    EditorGUI.BeginChangeCheck();
                    Draw(settings, nameof(StationModelDetailConfiguration.DefaultProfile));
                    Draw(settings, nameof(StationModelDetailConfiguration.BalancedBias));
                    Draw(settings, nameof(StationModelDetailConfiguration.LowBias));
                    Draw(settings, nameof(StationModelDetailConfiguration.FullThreshold));
                    Draw(settings, nameof(StationModelDetailConfiguration.ReducedThreshold));
                    Draw(settings, nameof(StationModelDetailConfiguration.Hysteresis));
                    Draw(settings, nameof(StationModelDetailConfiguration.NativeThreshold));
                    if (!EditorGUI.EndChangeCheck()) return;
                    settings.ApplyModifiedProperties();
                    if (!AssetDatabase.Contains(settings.targetObject)) {
                        AssetDatabase.CreateAsset(settings.targetObject,
                            $"Assets/StationDesigner/Resources/{StationModelDetailConfiguration.ResourceName}.asset");
                    }
                    AssetDatabase.SaveAssetIfDirty(settings.targetObject);
                }
            };
        }

        static void Draw(SerializedObject settings, string name) =>
            EditorGUILayout.PropertyField(settings.FindProperty(name));
    }
}
