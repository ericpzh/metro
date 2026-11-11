using Metro.Feasibility;
using NUnit.Framework;
using UnityEngine;

public class PlaceholderCrowdMeshTests {
    [Test] public void OriginalPlaceholderHasHumanScaleAndAsymmetricLandmark() {
        var mesh = PlaceholderCrowdMesh.Create();
        try {
            Assert.That(mesh.bounds.min.y, Is.EqualTo(0).Within(0.001));
            Assert.That(mesh.bounds.max.y, Is.EqualTo(1.63f).Within(0.001));
            Assert.That(mesh.bounds.max.x, Is.GreaterThan(-mesh.bounds.min.x));
            Assert.That(mesh.triangles.Length, Is.EqualTo(7 * 36));
        } finally { Object.DestroyImmediate(mesh); }
    }
}
