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
}
