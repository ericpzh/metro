using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace Metro.Editor {
    public static class Bootstrap {
        public const string ScenePath = "Assets/StationDesigner/Scenes/Bootstrap.unity";
        public const string FontPath = "Assets/StationDesigner/Fonts/NotoSansSC.ttf";
        public static void Generate() {
            var font = AssetDatabase.LoadAssetAtPath<Font>(FontPath);
            if (font == null) throw new System.Exception("Bootstrap font is missing: " + FontPath);
            if (System.IO.File.Exists(ScenePath)) {
                var existing = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
                var existingLabel = GameObject.Find("Counter label")?.GetComponent<Text>();
                if (!existing.IsValid() || GameObject.Find("Main Camera") == null || GameObject.Find("One metre cube") == null || GameObject.Find("Canvas")?.GetComponent<Metro.BootstrapCounter>() == null || existingLabel == null)
                    throw new System.Exception("Existing bootstrap scene is missing required objects; inspect it before regenerating");
                bool changed = false;
                if (existingLabel.font != font) {
                    existingLabel.font = font;
                    changed = true;
                }
                var existingCanvas = GameObject.Find("Canvas");
                if (GameObject.Find("Editable label") == null) { CreateInput(existingCanvas.transform, font, existingCanvas.GetComponent<Metro.BootstrapCounter>()); changed = true; }
                if (changed) { EditorSceneManager.MarkSceneDirty(existing); if (!EditorSceneManager.SaveScene(existing, ScenePath)) throw new System.Exception("Could not save bootstrap scene"); }
                Debug.Log("Validated existing " + ScenePath);
                return;
            }
            System.IO.Directory.CreateDirectory("Assets/StationDesigner/Scenes");
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var cameraObject = new GameObject("Main Camera", typeof(Camera), typeof(AudioListener));
            cameraObject.tag = "MainCamera";
            cameraObject.transform.position = new Vector3(2, 2, -4);
            cameraObject.transform.LookAt(Vector3.zero);
            var camera = cameraObject.GetComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(.1f, .14f, .18f);
            var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.name = "One metre cube";
            var light = new GameObject("Directional Light", typeof(Light));
            light.transform.rotation = Quaternion.Euler(50, -30, 0);
            light.GetComponent<Light>().type = LightType.Directional;
            var canvasObject = new GameObject("Canvas", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            var canvas = canvasObject.GetComponent<Canvas>(); canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvasObject.GetComponent<CanvasScaler>().uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            canvasObject.GetComponent<CanvasScaler>().referenceResolution = new Vector2(1280, 720);
            var labelObject = new GameObject("Counter label", typeof(RectTransform), typeof(Text));
            labelObject.transform.SetParent(canvasObject.transform, false);
            var text = labelObject.GetComponent<Text>(); text.font = font;
            text.fontSize = 28; text.alignment = TextAnchor.MiddleCenter; text.color = Color.white;
            var rect = labelObject.GetComponent<RectTransform>(); rect.anchorMin = new Vector2(0, 1); rect.anchorMax = new Vector2(1, 1); rect.pivot = new Vector2(.5f, 1); rect.sizeDelta = new Vector2(0, 100);
            var buttonObject = new GameObject("Click area", typeof(RectTransform), typeof(Image), typeof(Button));
            buttonObject.transform.SetParent(canvasObject.transform, false);
            var buttonRect = buttonObject.GetComponent<RectTransform>(); buttonRect.anchorMin = Vector2.zero; buttonRect.anchorMax = Vector2.one; buttonRect.offsetMin = Vector2.zero; buttonRect.offsetMax = Vector2.zero;
            buttonObject.GetComponent<Image>().color = new Color(1, 1, 1, .001f);
            labelObject.transform.SetAsLastSibling(); text.raycastTarget = false;
            var counter = canvasObject.AddComponent<Metro.BootstrapCounter>(); counter.label = text;
            UnityEditor.Events.UnityEventTools.AddPersistentListener(buttonObject.GetComponent<Button>().onClick, counter.Click);
            CreateInput(canvasObject.transform, font, counter);
            new GameObject("EventSystem", typeof(EventSystem), typeof(UnityEngine.InputSystem.UI.InputSystemUIInputModule));
            if (!EditorSceneManager.SaveScene(scene, ScenePath)) throw new System.Exception("Could not save bootstrap scene");
            AssetDatabase.SaveAssets(); AssetDatabase.Refresh();
            Debug.Log("Saved " + ScenePath);
        }
        static void CreateInput(Transform parent, Font font, Metro.BootstrapCounter counter) {
            var inputObject = new GameObject("Editable label", typeof(RectTransform), typeof(Image), typeof(InputField));
            inputObject.transform.SetParent(parent, false);
            var rect = inputObject.GetComponent<RectTransform>();
            rect.anchorMin = rect.anchorMax = new Vector2(.5f, 0); rect.pivot = new Vector2(.5f, 0);
            rect.anchoredPosition = new Vector2(0, 28); rect.sizeDelta = new Vector2(400, 48);
            inputObject.GetComponent<Image>().color = new Color(.23f, .3f, .36f, 1);
            var textObject = new GameObject("Input text", typeof(RectTransform), typeof(Text));
            textObject.transform.SetParent(inputObject.transform, false);
            var textRect = textObject.GetComponent<RectTransform>(); textRect.anchorMin = Vector2.zero; textRect.anchorMax = Vector2.one; textRect.offsetMin = new Vector2(10, 2); textRect.offsetMax = new Vector2(-10, -2);
            var text = textObject.GetComponent<Text>(); text.font = font; text.fontSize = 23; text.color = Color.white; text.alignment = TextAnchor.MiddleCenter; text.supportRichText = false;
            var input = inputObject.GetComponent<InputField>(); input.textComponent = text; input.text = "车站 Station";
            UnityEditor.Events.UnityEventTools.AddPersistentListener(input.onValueChanged, counter.InputChanged);
        }
    }
}
