using System;
using System.IO;
using System.Linq;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using NUnit.Framework;
using UnityEngine;

public class ZooWalkGraphTests {
    [Serializable] sealed class Layout { public ZooWalkGraph.Node[] nodes; public GatePathSlice.Waypoint[] prefix; public int start,gateNode,door; }
    [Serializable] sealed class Oracle { public GatePathSlice.Waypoint[] baseline,alternate; public OracleNode[] nodes,alternateNodes,fareNodes; }
    [Serializable] sealed class OracleNode { public OracleEdge[] edges; }
    [Serializable] sealed class OracleEdge { public int to; public float cost; }
    static string Read(string name) => File.ReadAllText(Path.Combine(Application.dataPath,"StationDesigner/Zoo",name));
    static void EqualPath(GatePathSlice.Waypoint[] expected,GatePathSlice.Waypoint[] actual) {
        Assert.NotNull(actual); Assert.AreEqual(expected.Length,actual.Length);
        for(int i=0;i<expected.Length;i++) {
            Assert.AreEqual(expected[i].x,actual[i].x,"x at "+i); Assert.AreEqual(expected[i].y,actual[i].y,"y at "+i);
            Assert.AreEqual(expected[i].z,actual[i].z,"z at "+i); Assert.AreEqual(expected[i].zone,actual[i].zone,"zone at "+i);
            Assert.AreEqual(expected[i].gate,actual[i].gate,"gate at "+i);
        }
    }
    [Test] public void RoutesFollowCommittedFloorAndSurviveSaveReopen() {
        var layout=JsonUtility.FromJson<Layout>(Read("ZooLayout.json"));
        var oracle=JsonUtility.FromJson<Oracle>(Read("ZooRouteOracle.json"));
        var graph=new ZooWalkGraph(layout.nodes); var doc=StationSaveV1.Read(Read("ZooSave.json"));
        GatePathSlice.Waypoint[] Route(StationSaveV1 station) {
            var cells=station.SolidCells().Select(c => (c.X,c.Y,c.Z)).ToHashSet();
            return graph.Find(layout.start,layout.gateNode,layout.door,(x,y,z)=>cells.Contains((x,y,z)),layout.prefix);
        }
        EqualPath(oracle.baseline,Route(doc));
        doc.RemoveCell(67,27,-15); EqualPath(oracle.alternate,Route(doc));
        var alternate=Route(doc); var sim=new GatePathSlice(alternate,2,1);
        for(int i=0;i<300&&!sim.Dead;i++) sim.Step(); Assert.IsTrue(sim.Dead); Assert.AreEqual(1,sim.WaitCount);
        // These four removals close the other TypeScript approaches while the
        // selected alternate route remains unchanged. The last tile cuts both.
        doc.RemoveCell(73,36,-15); doc.RemoveCell(77,14,-15);
        doc.RemoveCell(78,14,-15); doc.RemoveCell(80,18,-15);
        EqualPath(oracle.alternate,Route(doc));
        doc.RemoveCell(73,35,-15);
        var reopened=StationSaveV1.Read(doc.Write(DateTimeOffset.UnixEpoch)); Assert.IsNull(Route(reopened));
        var authored=StationSaveV1.Read(Read("ZooSave.json"));
        reopened.RestoreCellFrom(authored,73,35,-15); EqualPath(oracle.alternate,Route(reopened));
    }
    [Test] public void FloorTransactionsRejectUnknownOrNoOpCoordinates() {
        var edit=new ZooFloorEdits(new[] { (67,27,-15) });
        Assert.IsTrue(edit.CanSet(67,27,-15,true,false)); Assert.IsTrue(edit.CanSet(67,27,-15,false,true));
        Assert.IsFalse(edit.CanSet(67,27,-15,true,true)); Assert.IsFalse(edit.CanSet(61,20,-15,true,false));
        Assert.IsFalse(edit.CanSetGate(false,true,false)); Assert.IsTrue(edit.CanSetGate(false,true,true));
        Assert.IsTrue(edit.CanSetGate(true,false,false)); Assert.IsFalse(edit.CanSetGate(true,true,true));
    }
    [Test] public void FareBoundaryUsesGateDirectionWhenEnabled() {
        var nodes=new[] {
            new ZooWalkGraph.Node { x=0,zone=0,speed=1 },
            new ZooWalkGraph.Node { x=1,zone=3,speed=1,gate=true,gateMode=1 },
            new ZooWalkGraph.Node { x=2,zone=3,speed=1 },
        };
        var graph=new ZooWalkGraph(nodes,true);
        Assert.AreEqual(1,graph.WalkEdges(0,(x,y,z)=>true).Length);
        Assert.AreEqual(1,graph.WalkEdges(1,(x,y,z)=>true).Length);
        Assert.AreEqual(2,graph.WalkEdges(1,(x,y,z)=>true)[0].to);
        nodes[1].gateMode=-1;
        Assert.AreEqual(0,graph.WalkEdges(0,(x,y,z)=>true).Length);
        Assert.AreEqual(2,graph.WalkEdges(1,(x,y,z)=>true).Length);
    }
    [Test] public void ConstructedWalkEdgesMatchTheAuthoredTypeScriptGraph() {
        var layout=JsonUtility.FromJson<Layout>(Read("ZooLayout.json"));
        var oracle=JsonUtility.FromJson<Oracle>(Read("ZooRouteOracle.json"));
        var graph=new ZooWalkGraph(layout.nodes); var solid=StationSaveV1.Read(Read("ZooSave.json")).SolidCells()
            .Select(c => (c.X,c.Y,c.Z)).ToHashSet();
        void Compare(ZooWalkGraph current,OracleNode[] expected) {
            for(int i=0;i<layout.nodes.Length;i++) {
                var actual=current.WalkEdges(i,(x,y,z)=>solid.Contains((x,y,z)));
                Assert.AreEqual(expected[i].edges.Length,actual.Length,"edge count at "+i);
                for(int j=0;j<actual.Length;j++) {
                    Assert.AreEqual(expected[i].edges[j].to,actual[j].to,"edge target at "+i+":"+j);
                    Assert.AreEqual(expected[i].edges[j].cost,actual[j].cost,"edge cost at "+i+":"+j);
                }
            }
        }
        Compare(graph,oracle.nodes); Compare(new ZooWalkGraph(layout.nodes,true),oracle.fareNodes);
        solid.Remove((67,27,-15)); Compare(graph,oracle.alternateNodes);
    }
}
