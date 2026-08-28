using OctNav;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;
public interface IPathfindingService
{
    Task<List<OctNavGraph.GraphNode>> FindPathAsync(
        OctNavGraph.GraphNode start,
        OctNavGraph.GraphNode end,
        HeuristicType heuristic
    );
}
public class ThreadedPathfinding : IPathfindingService
{
    private readonly OctNavGraph graphSnapshot;

    public ThreadedPathfinding(OctNavGraph graph)
    {
        graphSnapshot = CloneGraph(graph);
    }

    public Task<List<OctNavGraph.GraphNode>> FindPathAsync(OctNavGraph.GraphNode start, OctNavGraph.GraphNode end, HeuristicType heuristic)
    {
        return Task.Run(() =>
        {
            return graphSnapshot.AStar(start, end, heuristic);
        });
    }

    private OctNavGraph CloneGraph(OctNavGraph original)
    {
        OctNavGraph clone = new OctNavGraph
        {
            maxIterations = original.maxIterations,
            heuristicType = original.heuristicType
        };

        foreach (var kvp in original.nodes) 
        {
            OctNode octNode = kvp.Key;
            OctNavGraph.GraphNode origGraphNode = kvp.Value;
            OctNavGraph.GraphNode clonedNode = new OctNavGraph.GraphNode(octNode, origGraphNode.isHitNode);
            clone.nodes.Add(octNode, clonedNode);
        }

        foreach (OctNavGraph.GraphEdge edge in original.edges)
        {
            clone.AddEdge(edge.a.octreeNode, edge.b.octreeNode);
        }

        return clone;
    }
}