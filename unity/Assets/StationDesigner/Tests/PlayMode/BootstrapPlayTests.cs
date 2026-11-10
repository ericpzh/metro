using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
public class BootstrapPlayTests {
    [UnityTest] public IEnumerator ClickUpdatesCounterLabel() {
        var root = new GameObject("counter", typeof(Metro.BootstrapCounter));
        var label = new GameObject("label", typeof(Text)).GetComponent<Text>();
        var counter = root.GetComponent<Metro.BootstrapCounter>();
        counter.label = label;
        yield return null;
        counter.Click();
        Assert.That(label.text, Does.Contain("1"));
        Object.Destroy(root); Object.Destroy(label.gameObject);
    }
}
