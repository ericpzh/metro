using System.Linq;
using Metro.Build;
using Metro.View;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Placement converts document coordinates to the Unity world once and applies the
/// prefab pivot and yaw the catalogue records. The asymmetric fare gate and the
/// ceiling camera are the pieces that expose a wrong basis.
/// </summary>
public class ModulePlacementTests {
    const string GatePrefab = "Assets/StationDesigner/Generated/Prefabs/Gate.prefab";
    const string CctvPrefab = "Assets/StationDesigner/Generated/Prefabs/Cctv.prefab";

    static readonly Vector3 DefaultOffset = new Vector3(.5f, .5f, 1f);

    static Vector2 Plan(Vector3 direction) => new Vector2(direction.x, direction.z).normalized;

    /// <summary>The source `rotateLocal(rot, dx, dy)` quarter turn, counter-clockwise in plan.</summary>
    static Vector2 RotatePlan(int rotation, float x, float y) {
        switch (((rotation % 4) + 4) % 4) {
            case 1: return new Vector2(-y, x);
            case 2: return new Vector2(-x, -y);
            case 3: return new Vector2(y, -x);
            default: return new Vector2(x, y);
        }
    }

    [Test] public void DocumentCoordinatesMapPlanThenElevation() {
        var module = new ModuleFacts { Id = "gate-1", Type = "gate", X = 59, Y = 18, Z = -15, Rotation = 0 };
        var position = ModulePlacement.Position(module, DefaultOffset);
        Assert.AreEqual(59.5f, position.x, 1e-5);
        Assert.AreEqual(-14f, position.y, 1e-5, "elevation plus the offset's floor rise");
        Assert.AreEqual(18.5f, position.z, 1e-5, "plan y becomes the Unity z");
        Assert.AreEqual(-15f, ModulePlacement.Floor(module.Z) - 1f, 1e-5);
    }

    [Test] public void QuarterTurnsAreOneNegativeYawEach() {
        for (int rotation = 0; rotation < 4; rotation++) {
            var yaw = ModulePlacement.Rotation(rotation).eulerAngles.y;
            var expected = ((-90f * rotation) % 360f + 360f) % 360f;
            Assert.AreEqual(expected, yaw, 1e-3, $"rotation {rotation}");
        }
        // A module saved with a wrapped rotation still lands on a quarter turn.
        Assert.AreEqual(ModulePlacement.Yaw(1), ModulePlacement.Yaw(5), 1e-4);
    }

    [Test] public void BenchRunCentresOnItsCellsWithTheEdgeInset() {
        var module = new ModuleFacts { Id = "bench-steel-2", Type = "bench", X = 109, Y = 3, Z = -20, Rotation = 0 };
        var position = ModulePlacement.Position(module, new Vector3(1f, .575f, 1f));
        Assert.AreEqual(110f, position.x, 1e-5);
        Assert.AreEqual(3.575f, position.z, 1e-5);
        Assert.AreEqual(-19f, position.y, 1e-5);
    }

    [TestCase(0)]
    [TestCase(1)]
    [TestCase(2)]
    [TestCase(3)]
    public void AsymmetricGateKeepsItsMachineOnTheServiceSide(int rotation) {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(GatePrefab);
        Assert.IsNotNull(prefab, "gate prefab is missing");
        var instance = Object.Instantiate(prefab);
        try {
            var body = instance.GetComponentsInChildren<Transform>(true).FirstOrDefault(node => node.name == "gate-body");
            Assert.IsNotNull(body, "the promoted gate lost its named body");
            var local = instance.transform.InverseTransformPoint(body.position);
            var module = new ModuleFacts { Id = "gate-1", Type = "gate", X = 62, Y = 18, Z = -15, Rotation = rotation };
            var pivot = ModulePlacement.Position(module, DefaultOffset);
            var rotationY = ModulePlacement.Rotation(rotation);
            var world = pivot + rotationY * new Vector3(local.x, 0f, local.z);
            var actual = Plan(world - pivot);
            // `sim/gates.ts` `gateMachineSide` puts the body on the cell's local −x half.
            var expected = Plan(new Vector3(RotatePlan(rotation, -1, 0).x, 0f, RotatePlan(rotation, -1, 0).y));
            Assert.AreEqual(expected.x, actual.x, 1e-3,
                $"rotation {rotation}: the gate body sits on the wrong side (prefab-local x {local.x:0.###})");
            Assert.AreEqual(expected.y, actual.y, 1e-3, $"rotation {rotation}: the gate body sits on the wrong side");
        } finally {
            Object.DestroyImmediate(instance);
        }
    }

    [Test] public void CeilingCctvHangsFromTheStoreyCeiling() {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(CctvPrefab);
        Assert.IsNotNull(prefab, "cctv prefab is missing");
        var module = new ModuleFacts {
            Id = "cctv-1", Type = "cctv", X = 89, Y = 12, Z = -16, Rotation = 1, CeilingAnchored = true,
        };
        var instance = Object.Instantiate(prefab);
        try {
            instance.transform.SetPositionAndRotation(ModulePlacement.Position(module, DefaultOffset),
                ModulePlacement.Rotation(module.Rotation));
            var bounds = RendererBounds(instance);
            // The promoted hang is authored for a four-metre ceiling above the origin.
            Assert.AreEqual(-16f + 5f, bounds.max.y, .15f, "the camera must reach the storey ceiling");
            Assert.Less(bounds.max.y - 1.2f, bounds.min.y, "the camera must hang below the ceiling");
            Assert.AreEqual(89.5f, bounds.center.x, .6f, "the camera must stay in its cell");
            Assert.AreEqual(12.5f, bounds.center.z, .6f, "the camera must stay in its cell");
        } finally {
            Object.DestroyImmediate(instance);
        }
    }

    [Test] public void LevelFilterKeepsTwoStoreysVisible() {
        var module = new ModuleFacts { Id = "module-1", Type = "bin", Z = -15 };
        Assert.IsTrue(ModulePlacement.VisibleAt(module, -15));
        Assert.IsTrue(ModulePlacement.VisibleAt(module, -13));
        Assert.IsFalse(ModulePlacement.VisibleAt(module, -18));
        Assert.AreEqual(new Vector3Int(1, 2, -3), ModulePlacement.Cell(new ModuleFacts { X = 1, Y = 2, Z = -3 }));
    }

    static Bounds RendererBounds(GameObject instance) {
        var renderers = instance.GetComponentsInChildren<Renderer>(true);
        Assert.IsNotEmpty(renderers, "prefab has no renderers");
        var bounds = renderers[0].bounds;
        foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
        return bounds;
    }
}
