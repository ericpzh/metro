using System;
using Metro.Sim;
using NUnit.Framework;

public class SimulationRngTests {
    [Test] public void MatchesTypeScriptStreamAndPoissonSampling() {
        var rng = new SimulationRng(7654321);
        var expected = new[] { 0.9596287554595619, 0.24698173557408154, 0.5742903097998351, 0.1711132691707462, 0.5100994687527418, 0.3726565765682608, 0.9816998380701989, 0.06307656737044454 };
        foreach (var value in expected) Assert.AreEqual(value, rng.Next());
        rng = new SimulationRng(7654321);
        foreach (var value in new[] { 1,0,0,0,0,1,0,0,0,0,2,0,0,0,0,1,1,0,0,3 })
            Assert.AreEqual(value, rng.PoissonHour(1800, 1));
    }

    [Test] public void SeedOneMatchesGoldenStreamAndDifferentSeedsDiverge() {
        var r = new SimulationRng(1);
        var five = new[] { r.Next(), r.Next(), r.Next(), r.Next(), r.Next() };
        var golden = new[] { 0.6270739406, 0.0027357212, 0.52744704, 0.9810509675, 0.9683778982 };
        for (int i = 0; i < golden.Length; i++) {
            Assert.AreEqual(golden[i], Math.Round(five[i], 10, MidpointRounding.AwayFromZero), 1e-12,
                $"seed 1 golden draw {i}");
        }

        var twin = new SimulationRng(1);
        for (int i = 0; i < five.Length; i++) {
            Assert.AreEqual(five[i], twin.Next(), $"seed 1 stream must repeat bit-for-bit at {i}");
        }

        var other = new SimulationRng(2);
        Assert.AreNotEqual(five[0], other.Next(), "different seeds must diverge");
    }

    [Test] public void StateSaveAndRestoreProducesIdenticalSubsequentStream() {
        var a = new SimulationRng(11);
        a.Next();
        a.Next();
        uint saved = a.State;
        var expected = new[] { a.Next(), a.Next(), a.Next(), a.Next() };

        var b = new SimulationRng(99);
        b.State = saved;
        for (int i = 0; i < expected.Length; i++) {
            Assert.AreEqual(expected[i], b.Next(), $"restored stream diverged at draw {i}");
        }
        Assert.AreEqual(a.State, b.State, "restored stream final state must match");
    }

    [Test] public void PoissonHourHandlesZeroNegativeMeanAndCapEdgeCases() {
        int once = new SimulationRng(5).PoissonHour(3600, 1);
        Assert.AreEqual(2, once, "seed 5 draw for lambda = 1 matches TypeScript");
        Assert.AreEqual(once, new SimulationRng(5).PoissonHour(3600, 1), "same seed repeats Poisson draw");

        Assert.AreEqual(0, new SimulationRng(5).PoissonHour(0, 60), "zero rate produces 0");
        Assert.AreEqual(0, new SimulationRng(5).PoissonHour(3600, 0), "zero seconds produces 0");
        Assert.AreEqual(0, new SimulationRng(5).PoissonHour(-5, 60), "negative rate produces 0");
        Assert.AreEqual(0, new SimulationRng(5).PoissonHour(3600, -10), "negative seconds produces 0");

        int hugeBoth = new SimulationRng(5).PoissonHour(1e9, 1e9);
        int hugeRate = new SimulationRng(5).PoissonHour(1e9, 1);
        Assert.AreEqual(63, hugeBoth, "huge lambda stops at Knuth loop cap 63");
        Assert.LessOrEqual(hugeRate, 63, "huge rate stays within loop cap");
        Assert.GreaterOrEqual(hugeRate, 0, "huge rate stays non-negative");

        var sampler = new SimulationRng(42);
        const int samples = 2000;
        long sum = 0;
        for (int i = 0; i < samples; i++) {
            int n = sampler.PoissonHour(7200, 1); // lambda = 2.0
            Assert.GreaterOrEqual(n, 0, "Poisson sample is non-negative");
            Assert.LessOrEqual(n, 63, "Poisson sample is bounded by cap");
            sum += n;
        }
        double mean = (double)sum / samples;
        Assert.That(mean, Is.EqualTo(2.0).Within(0.15),
            $"empirical mean {mean:F4} across {samples} samples should stay near lambda=2.0");
    }
}
