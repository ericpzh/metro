using NUnit.Framework;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;
public class BootstrapSceneTests {
    [Test] public void SceneContainsOneMetreCubeAndCamera() {
        var scene = EditorSceneManager.OpenScene("Assets/StationDesigner/Scenes/Bootstrap.unity", OpenSceneMode.Single);
        Assert.That(scene.IsValid(), Is.True);
        Assert.That(GameObject.Find("Main Camera"), Is.Not.Null);
        Assert.That(GameObject.Find("One metre cube").transform.localScale, Is.EqualTo(Vector3.one));
        var label = GameObject.Find("Counter label").GetComponent<Text>();
        var counter = GameObject.Find("Canvas").GetComponent<Metro.BootstrapCounter>();
        var button = GameObject.Find("Click area").GetComponent<Button>();
        Assert.That(counter.label, Is.SameAs(label));
        Assert.That(label.font.name, Is.EqualTo("NotoSansSC"));
        Assert.That(button.onClick.GetPersistentEventCount(), Is.EqualTo(1));
        Assert.That(button.onClick.GetPersistentTarget(0), Is.SameAs(counter));
        var input = GameObject.Find("Editable label").GetComponent<InputField>();
        Assert.That(input.text, Is.EqualTo("车站 Station"));
        Assert.That(input.textComponent.font, Is.SameAs(label.font));
        Assert.That(input.onValueChanged.GetPersistentTarget(0), Is.SameAs(counter));
    }
}
