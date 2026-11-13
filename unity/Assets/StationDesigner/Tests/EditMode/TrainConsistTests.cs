using System.Linq;
using Metro.View;
using NUnit.Framework;

/// <summary>
/// The consist cadence the platform screen doors repeat. Zoo Line 5 is a six-car L
/// set at 0.98 scale, so its 18 door centres must land on the recorded values.
/// </summary>
public class TrainConsistTests {
    static readonly float[] ZooLineFive = {
        -46.648f, -41.16f, -35.672f, -30.184f, -24.696f, -19.208f, -13.72f, -8.232f, -2.744f,
        2.744f, 8.232f, 13.72f, 19.208f, 24.696f, 30.184f, 35.672f, 41.16f, 46.648f,
    };

    [Test] public void LineFiveHasEighteenDoorsOnTheRecordedCadence() {
        var centres = TrainConsist.DoorCentres("L", 6, .98f).OrderBy(value => value).ToArray();
        Assert.AreEqual(18, centres.Length, "six L cars carry three doors per side");
        for (int i = 0; i < ZooLineFive.Length; i++)
            Assert.AreEqual(ZooLineFive[i], centres[i], 1e-3f, $"door {i}");
        // The cadence is uniform: consecutive openings are 5.488 m apart.
        for (int i = 1; i < centres.Length; i++)
            Assert.AreEqual(5.488f, centres[i] - centres[i - 1], 1e-3f, $"pitch {i}");
    }

    [Test] public void RunOffsetsMeasureFromTheRailsFirstCell() {
        var offsets = TrainConsist.DoorRunOffsets("L", 6, .98f, 101).OrderBy(value => value).ToArray();
        Assert.AreEqual(3.852f, offsets[0], 1e-3f);
        Assert.AreEqual(97.148f, offsets[offsets.Length - 1], 1e-3f);
        // Re-bed on a 101-cell run at x 17: the openings span world x 20.852 … 114.148.
        Assert.AreEqual(20.852f, 17f + offsets[0], 1e-3f);
        Assert.AreEqual(114.148f, 17f + offsets[offsets.Length - 1], 1e-3f);
    }

    [Test] public void FullScreenOpeningsWidenByThePlatformFactor() {
        foreach (var offset in TrainConsist.DoorCentres("L", 6, .98f))
            Assert.AreEqual(2.058f, TrainConsist.DoorWidthAt("L", 6, .98f, offset) * 1.5f, 1e-3f);
    }

    [Test] public void TheDStockEndDoorStaysNarrow() {
        var centres = TrainConsist.DoorCentres("D", 8, 1f).OrderBy(value => value).ToArray();
        var widths = centres.Select(offset => TrainConsist.DoorWidthAt("D", 8, 1f, offset)).ToArray();
        Assert.Contains(.8f, widths, "the D cab's single end door is 0.8 m");
        Assert.Contains(1.4f, widths, "the other D doors are 1.4 m");
    }

    [Test] public void OtherStockClassesKeepTheirOwnDoorCount() {
        Assert.AreEqual(10, TrainConsist.DoorCentres("A", 2, 1f).Length, "two A cars, five doors each");
        Assert.AreEqual(8, TrainConsist.DoorCentres("B", 2, 1f).Length);
        Assert.AreEqual(22f * 2f, TrainConsist.Length("A", 2, 1f), 1e-3f);
        Assert.AreEqual(16.8f * 6f * .98f, TrainConsist.Length("L", 6, .98f), .02f);
        // Rounding the distance from the centre keeps the front/back symmetry on a tie.
        var asymmetric = TrainConsist.DoorCentres("C", 3, 1f);
        foreach (var offset in asymmetric)
            Assert.IsTrue(asymmetric.Any(other => System.Math.Abs(other + offset) < 1e-3f), "door centres must be symmetric");
    }
}
