using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
using UnityEngine;
using UnityEngine.Profiling;

namespace OctNav
{
    /// <summary>
    /// Defines the type of heuristic function to use in the A* pathfinding algorithm.
    /// </summary>
    public enum HeuristicType
    {
        Morrisium,
        Manhattan,
        Euclidean,
        Goober,
        Andradian,
        EuclideanUpBiased, 
        GooberUpBiased
    }

    /// <summary>
    /// Represents a navigational graph used for A* pathfinding over Octree-based nodes.
    /// </summary>
    public class OctNavGraph
    {
        public float upBias = 0.8f;
        public float downBias = 1.2f;
        public readonly Dictionary<OctNode, GraphNode> nodes = new Dictionary<OctNode, GraphNode>();
        public readonly HashSet<GraphEdge> edges = new HashSet<GraphEdge>();
        
        private OctVolume lastVolume;
        
        
        private readonly Dictionary<OctNode, OctVolume> nodeToVolumeMap = new Dictionary<OctNode, OctVolume>();

        public int maxIterations = 200;
        public HeuristicType heuristicType;
        private int currentSearchId = 0;
        int count = 0;

        /// <summary>
        /// Represents a node in the A* graph, which wraps an OctNode and includes A* metadata.
        /// </summary>
        public class GraphNode
        {
            static int nextId;
            public readonly int id;
            public int lastSearchId;
            public int closedSearchId;
            public int openSearchId;
            
            public float f, g, h;
            public GraphNode from;

            /// <summary>
            /// Gets the vector from the 'from' node to this node, used for directional heuristics.
            /// </summary>
            public Vector3 fromDirection => from != null ? Center - from.Center : Vector3.zero;

            public bool isHitNode;
            public List<GraphEdge> edges = new List<GraphEdge>();

            public OctNode octreeNode;
            private Vector3 cachedCenter;
            private Vector3 cachedSize;

            /// <summary>
            /// Gets the center position of the node, accounting for edge direction if applicable.
            /// </summary>
            public Vector3 Center => cachedCenter;

            /// <summary>
            /// Gets the bounds of the node centered around its adjusted center.
            /// </summary>
            public Bounds Bounds => octreeNode.bounds;

            /// <summary>
            /// Gets the size of the node's bounding volume.
            /// </summary>
            public Vector3 Size => cachedSize;

            public GraphNode(OctNode octreeNode, bool isHitNode = false)
            {
                this.id = nextId++;
                this.octreeNode = octreeNode;
                this.isHitNode = isHitNode;
                RecalculateCachedGeometry();
            }
            public void RecalculateCachedGeometry()
            {
                Vector3 c = octreeNode.bounds.center;

                if (isHitNode)
                {
                    Vector3 ext = octreeNode.bounds.extents;
                    c.y += ext.y;

                    if (octreeNode.isEdge)
                    {
                        Direction[] dirs = octreeNode.edgeDirs;
                        for (int i = 0; i < dirs.Length; i++)
                        {
                            Direction dir = dirs[i];
                            if (dir == Direction.PosX) c.x += ext.x;
                            else if (dir == Direction.NegX) c.x -= ext.x;
                            else if (dir == Direction.PosZ) c.z += ext.z;
                            else if (dir == Direction.NegZ) c.z -= ext.z;
                        }
                    }
                }

                cachedCenter = c;
                cachedSize = octreeNode.bounds.size;
            }
            
            public override bool Equals(object obj)
            {
                return obj is GraphNode other && other.id == id;
            }

            public override int GetHashCode()
            {
                return id;
            }
        }

        /// <summary>
        /// Represents an undirected edge between two graph nodes.
        /// </summary>
        public class GraphEdge
        {
            public readonly GraphNode a, b;

            public GraphEdge(GraphNode a, GraphNode b)
            {
                this.a = a;
                this.b = b;
            }

            public override bool Equals(object obj)
            {
                return obj is GraphEdge other && ((a == other.a && b == other.b) || (a == other.b && b == other.a));
            }

            public override int GetHashCode()
            {
                return a.GetHashCode() ^ b.GetHashCode();
            }
        }
        
        private readonly OctUtils.BinaryHeapPriorityQueue<GraphNode> openQueue =
            new OctUtils.BinaryHeapPriorityQueue<GraphNode>();

        private readonly List<GraphNode> pathBuffer =
            new List<GraphNode>(128);
        
        public List<GraphNode> AStar(GraphNode start, GraphNode end, HeuristicType heuristic)
        {
            currentSearchId++;
            heuristicType = heuristic;
            count = 0;
        
            if (start == null || end == null)
            {
                return null;
            }
        
            // Reset node state (no allocations)
            Dictionary<OctNode, GraphNode>.ValueCollection nodeValues = nodes.Values;
            foreach (GraphNode node in nodeValues)
            {
                node.f = float.PositiveInfinity;
                node.g = float.PositiveInfinity;
                node.h = 0f;
                node.from = null;
            }
        
            openQueue.Clear();
            pathBuffer.Clear();
            
            InitNodeIfNeeded(start);
            start.g = 0f;
            start.h = Heuristic(start, end);
            start.f = start.h;
        
            GraphNode bestReached = start;
            float bestH = start.h;
        
            openQueue.Enqueue(start, start.f);
        
            while (openQueue.Count > 0)
            {
                if (++count > maxIterations)
                {
                    break;
                }
        
                GraphNode current = openQueue.Dequeue();
        
                if (current.closedSearchId == currentSearchId)
                {
                    continue;
                }
        
                if (current.h < bestH)
                {
                    bestH = current.h;
                    bestReached = current;
                }
        
                if (current == end)
                {
                    ReconstructPath(pathBuffer, current);
                    return pathBuffer;
                }
        
                current.closedSearchId = currentSearchId;
        
                List<GraphEdge> edges = current.edges;
                for (int i = 0; i < edges.Count; i++)
                {
                    GraphEdge edge = edges[i];
                    GraphNode neighbor = Equals(edge.a, current) ? edge.b : edge.a;
        
                    if (neighbor.closedSearchId == currentSearchId)
                    {
                        continue;
                    }

                    float tentativeG = current.g + Heuristic(current, neighbor);
        
                    InitNodeIfNeeded(neighbor);

                    if (tentativeG < neighbor.g)
                    {
                        neighbor.from = current;
                        neighbor.g = tentativeG;
                        neighbor.h = Heuristic(neighbor, end);
                        neighbor.f = neighbor.g + neighbor.h;
                        
                        if (neighbor.openSearchId != currentSearchId)
                        {
                            neighbor.openSearchId = currentSearchId;
                            openQueue.Enqueue(neighbor, neighbor.f);
                        }
                    }
                }
            }
        
            // Fallback path
            pathBuffer.Clear();
            ReconstructPath(pathBuffer, bestReached);
            return pathBuffer.Count < 2 ? null : pathBuffer;
        }
        
        private void InitNodeIfNeeded(GraphNode node)
        {
            if (node.lastSearchId != currentSearchId)
            {
                node.lastSearchId = currentSearchId;
                node.g = float.PositiveInfinity;
                node.f = float.PositiveInfinity;
                node.h = 0f;
                node.from = null;
            }
        }
        
        /// <summary>
        /// Reconstructs the path from end node back to start.
        /// </summary>
        private void ReconstructPath(List<GraphNode> buffer, GraphNode endNode)
        {
            buffer.Clear();

            GraphNode current = endNode;
            while (current != null)
            {
                buffer.Add(current);
                current = current.from;
            }

            buffer.Reverse();
        }

        /// <summary>
        /// Computes the heuristic value between two nodes based on selected heuristic type.
        /// </summary>
        private float Heuristic(GraphNode a, GraphNode b)
        {
            Vector3 centerA = a.Center;
            Vector3 centerB = b.Center;
         
            float dx = Mathf.Abs(centerA.x - centerB.x);
            float dy = Mathf.Abs(centerA.y - centerB.y);
            float dz = Mathf.Abs(centerA.z - centerB.z);

            float centerDistance = Mathf.Sqrt(dx * dx + dy * dy + dz * dz);
            Vector3 diff = centerB - centerA;
          
            switch (heuristicType)
            {
                case HeuristicType.Morrisium:
                    float dnx = Mathf.Abs(diff.x) - (a.Size.x * 0.5f + b.Size.x * 0.5f);
                    float dny = Mathf.Abs(diff.y) - (a.Size.y * 0.5f + b.Size.y * 0.5f);
                    float dnz = Mathf.Abs(diff.z) - (a.Size.z * 0.5f + b.Size.z * 0.5f);
                    dnx = Mathf.Max(0f, dnx);
                    dny = Mathf.Max(0f, dny);
                    dnz = Mathf.Max(0f, dnz);
                    return (dnx + dny + dnz);

                case HeuristicType.Manhattan:
                    return (dx + dy + dz) * (dx + dy + dz);

                case HeuristicType.Euclidean:
                    return (dx * dx + dy * dy + dz * dz);                
                case HeuristicType.Goober:
                    return  (a.Bounds.center - b.Bounds.ClosestPoint(a.Bounds.center)).sqrMagnitude; // using bounds isnt the most efficent
              /*  case HeuristicType.Straight:
                    
                    Vector3 prevDir = a.fromDirection.normalized;
                    Vector3 nextDir = (b.center - a.center).normalized;
                  
                    float rawBend = (prevDir - nextDir).sqrMagnitude;
                    float inverted = 1f / (rawBend  + 1f);
                    return inverted * (dx * dx + dy * dy + dz * dz);*/
                case HeuristicType.Andradian:
                    float directionalWeight = ( (a.fromDirection - b.fromDirection).sqrMagnitude)+ 1;
                return directionalWeight * (dx * dx + dy * dy + dz * dz);

                case HeuristicType.EuclideanUpBiased:
                    {
                        float baseCost = dx * dx + dy * dy + dz * dz;
                        float mult = centerB.y > centerA.y ? upBias : centerB.y < centerA.y ? downBias : 1f;
                        return baseCost * mult;
                    }

                case HeuristicType.GooberUpBiased:
                    {
                        float baseCost = (a.Bounds.center - b.Bounds.ClosestPoint(a.Bounds.center)).sqrMagnitude; // using bounds isnt the most efficent
                        float mult = centerB.y > centerA.y ? upBias : centerB.y < centerA.y ? downBias : 1f;
                        return baseCost * mult;
                    }
                default:
                    return (dx * dx + dy * dy + dz * dz);

            }
        }

        /// <summary>
        /// Used by the open set to compare nodes based on their f score.
        /// </summary>
        public class NodeComparer : IComparer<GraphNode>
        {
            public int Compare(GraphNode x, GraphNode y)
            {
                if (x == null || y == null) return 0;

                int compare = x.f.CompareTo(y.f);
                if (compare == 0)
                {
                    return x.id.CompareTo(y.id);
                }
                return compare;
            }
        }

        /// <summary>
        /// Adds a node to the graph, optionally marking it as a hit node.
        /// </summary>
        public void AddNode(OctVolume volume, OctNode octreeNode, bool isHitNode = false)
        {
            if (!nodes.ContainsKey(octreeNode))
            {
                nodes[octreeNode] = new GraphNode(octreeNode, isHitNode);
            }

            // Always update volume map
            nodeToVolumeMap[octreeNode] = volume;
        }

        /// <summary>
        /// Adds a bidirectional edge between two nodes in the graph.
        /// </summary>
        public void AddEdge(OctNode a, OctNode b)
        {
            GraphNode nodeA = FindNode(a);
            GraphNode nodeB = FindNode(b);

            if (nodeA == null || nodeB == null) return;

            GraphEdge edge = new GraphEdge(nodeA, nodeB);
            if (edges.Add(edge))
            {
                nodeA.edges.Add(edge);
                nodeB.edges.Add(edge);
            }
        }

        /// <summary>
        /// Removes all nodes and edges associated with the given volume.
        /// </summary>
        public void ClearVolume(OctVolume volume)
        {
            // Find all nodes belonging to this volume
            List<OctNode> nodesToRemove = nodeToVolumeMap
                .Where(kvp => kvp.Value == volume)
                .Select(kvp => kvp.Key)
                .ToList();

            // Remove edges connected to these nodes
            foreach (OctNode octNode in nodesToRemove)
            {
                if (nodes.TryGetValue(octNode, out GraphNode graphNode))
                {
                    // Remove edges from both nodes and global edge set
                    foreach (GraphEdge edge in graphNode.edges.ToList())
                    {
                        edges.Remove(edge);

                        if (edge.a != graphNode)
                        { 
                            edge.a.edges.Remove(edge); 
                        }
                        if (edge.b != graphNode)
                        {
                            edge.b.edges.Remove(edge);
                        }
                    }

                    graphNode.edges.Clear();
                }

                nodes.Remove(octNode);
                nodeToVolumeMap.Remove(octNode);
            }
        }

        /// <summary>
        /// Draws the graph nodes and edges using Gizmos.
        /// </summary>
        public void DrawGraphGizmos()
        {
            foreach (GraphEdge edge in edges)
            {
                Gizmos.DrawLine(edge.a.Center, edge.b.Center);
            }
            foreach (GraphNode node in nodes.Values)
            {
                Gizmos.DrawWireSphere(node.Center,0.1f);
            }
        }

        /// <summary>
        /// Finds and returns the graph node associated with the given OctNode.
        /// </summary>
        public GraphNode FindNode(OctNode octreeNode)
        {
            nodes.TryGetValue(octreeNode, out GraphNode node);
            return node;
        }
       

        /// <summary>
        /// Finds the closest OctNode in the graph to a given position.
        /// </summary>
        public OctNode GetClosestOctNode(Vector3 position)
        {
           // OctVolume volume;
           // volume.FindNodeAtPoint(position, out OctNode nodeAtPoint);
            OctNode closestNode = null;
            float closestDistanceSqr = Mathf.Infinity;

            foreach (var nodePair in nodes)
            {
                OctNode node = nodePair.Key;

                float distanceSqr = (node.bounds.ClosestPoint(position) - position).sqrMagnitude;
                if (distanceSqr < closestDistanceSqr)
                {
                    closestDistanceSqr = distanceSqr;
                    closestNode = node;
                }
            }

            return closestNode;
        }

        public GraphNode GetClosestNodeLegacy(Vector3 position)
        {
            GraphNode closestNode = null;
            float closestDistanceSqr = Mathf.Infinity;

            foreach (KeyValuePair<OctNode, GraphNode> nodePair in nodes)
            {
                GraphNode node = nodePair.Value;

                float distanceSqr = (node.Bounds.ClosestPoint(position) - position).sqrMagnitude;
                if (distanceSqr < closestDistanceSqr)
                {
                    closestDistanceSqr = distanceSqr;
                    closestNode = node;
                }
            }

            return closestNode;
        }
        public GraphNode GetClosestNode(Vector3 position)
        {
            lastVolume = OctManager.volume;

            if (lastVolume == null)
            {
                Debug.LogWarning("OctManager.volume is null");
                return null;
            }

            if (lastVolume.bounds.Contains(position))
            {
                GraphNode node = GetClosestNodeInsideVolume(position);
                if (node != null)
                {
                    return node;
                }

                return RecoverClosestNodeNearPosition(lastVolume, position);
            }

            return GetClosestNodeFromOutsideVolume(position);
        }
        
        private GraphNode RecoverClosestNodeNearPosition(OctVolume volume, Vector3 position)
        {
            const float verticalStep = 1.0f;
            const float maxVertical = 6.0f;
            const float radialStep = 1.0f;
            const float maxRadius = 15.0f;

            for (float y = verticalStep; y <= maxVertical; y += verticalStep)
            {
                Vector3 up = position + Vector3.up * y;
                if (volume.bounds.Contains(up))
                {
                    GraphNode n = GetClosestNodeInsideVolume(up);
                    if (n != null) return n;
                }

                Vector3 down = position - Vector3.up * y;
                if (volume.bounds.Contains(down))
                {
                    GraphNode n = GetClosestNodeInsideVolume(down);
                    if (n != null) return n;
                }
            }

            for (float r = radialStep; r <= maxRadius; r += radialStep)
            {
                for (int i = 0; i < 8; i++)
                {
                    float angle = i * Mathf.PI * 0.25f;
                    Vector3 offset = new Vector3(Mathf.Cos(angle), 0f, Mathf.Sin(angle)) * r;
                    Vector3 sample = position + offset;

                    if (!volume.bounds.Contains(sample))
                    {
                        continue;
                    }

                    GraphNode n = GetClosestNodeInsideVolume(sample);
                    if (n != null) return n;
                }
            }

            Debug.LogWarning(
                $"[OctNav] Recovery failed: position {position} is in playable space but not represented by octree."
            );

            return null;
        }
        private GraphNode GetClosestNodeInsideVolume(Vector3 position)
        {
            GraphNode direct = TryGetGraphNodeAtPoint(lastVolume, position);
            if (direct != null)
            {
                return direct;
            }

            GraphNode probed = ProbeAroundPointForGraphNode(lastVolume, position);
            if (probed != null)
            {
                return probed;
            }
            
            return null;
        }
        private GraphNode GetClosestNodeFromOutsideVolume(Vector3 position)
        {
            Vector3 clamped = MovePointSlightlyInsideBounds(lastVolume, position);

            GraphNode node = GetClosestNodeInsideVolume(clamped);

            if (node == null)
            {
                Debug.LogError(
                    $"[OctNav] Failed to resolve GraphNode after clamping outside position. " +
                    $"Original={position}, Clamped={clamped}, Volume={lastVolume.name}"
                );
            }

            return node;
        }
        
        private Vector3 MovePointSlightlyInsideBounds(OctVolume volume, Vector3 outsidePosition)
        {
            Bounds b = volume.bounds;
        
            Vector3 closestOnBounds = b.ClosestPoint(outsidePosition);
            Vector3 inwardDirection = closestOnBounds - outsidePosition;
        
            if (inwardDirection.sqrMagnitude < 1e-8f)
            {
                inwardDirection = closestOnBounds - b.center;
            }
            if (inwardDirection.sqrMagnitude < 1e-8f)
            {
                inwardDirection = Vector3.up;
            }
        
            inwardDirection.Normalize();
            float inset = Mathf.Max(0.01f, 0.002f * b.size.magnitude);
        
            Vector3 insidePoint = closestOnBounds + inwardDirection * inset;
        
            if (b.Contains(insidePoint) == false)
            {
                Vector3 towardCenter = (b.center - closestOnBounds);
                if (towardCenter.sqrMagnitude < 1e-8f)
                {
                    towardCenter = Vector3.up;
                }
                insidePoint = closestOnBounds + towardCenter.normalized * inset;
            }
        
            return insidePoint;
        }
        
        private GraphNode TryGetGraphNodeAtPoint(OctVolume volume, Vector3 point)
        {
            OctNode leaf = volume.FindNodeAtPoint(point);
            if (leaf == null)
            {
                return null;
            }
        
            if (leaf.hasCollision == false)
            {
                GraphNode mapped;
                bool found = nodes.TryGetValue(leaf, out mapped);
                if (found == true)
                {
                    return mapped;
                }
            }
        
            GraphNode bfs = NearestEmptyViaBfs(leaf, point, 64);
            return bfs;
        }
        
        private GraphNode ProbeAroundPointForGraphNode(OctVolume volume, Vector3 center)
        {
            float probe = Mathf.Max(0.01f, 0.002f * volume.bounds.size.magnitude);
        
            for (int axis = 0; axis < 3; axis++)
            {
                for (int sign = -1; sign <= 1; sign += 2)
                {
                    Vector3 offset = Vector3.zero;
                    if (axis == 0)
                    {
                        offset.x = probe * sign;
                    }
                    else if (axis == 1)
                    {
                        offset.y = probe * sign;
                    }
                    else
                    {
                        offset.z = probe * sign;
                    }
        
                    Vector3 sample = center + offset;
        
                    if (volume.bounds.Contains(sample) == false)
                    {
                        continue;
                    }
        
                    GraphNode node = TryGetGraphNodeAtPoint(volume, sample);
                    if (node != null)
                    {
                        return node;
                    }
                }
            }
        
            return null;
        }
        
        private GraphNode NearestGraphNodeLinear(Vector3 position, OctVolume volumeFilter)
        {
            GraphNode bestNode = null;
            float bestDistanceSqr = float.PositiveInfinity;
        
            foreach (KeyValuePair<OctNode, GraphNode> pair in nodes)
            {
                OctNode octNode = pair.Key;
        
                if (volumeFilter != null)
                {
                    OctVolume mappedVolume;
                    bool mapped = nodeToVolumeMap.TryGetValue(octNode, out mappedVolume);
                    if (mapped == false)
                    {
                        continue;
                    }
                    if (mappedVolume != volumeFilter)
                    {
                        continue;
                    }
                }
        
                GraphNode candidate = pair.Value;
        
                Vector3 closest = candidate.Bounds.ClosestPoint(position);
                float distanceSqr = (closest - position).sqrMagnitude;
        
                if (distanceSqr < bestDistanceSqr)
                {
                    bestDistanceSqr = distanceSqr;
                    bestNode = candidate;
                }
            }
        
            return bestNode;
        }
        
        private readonly OctNode[] bfsQueue = new OctNode[256];
        private int bfsQueueHead;
        private int bfsQueueTail;

        private int currentBfsSearchId = 0;
        
        private GraphNode NearestEmptyViaBfs(OctNode start, Vector3 sample, int maxVisits)
        {
            currentBfsSearchId++;

            bfsQueueHead = 0;
            bfsQueueTail = 0;

            start.bfsSearchId = currentBfsSearchId;
            bfsQueue[bfsQueueTail++] = start;

            OctNode bestLeaf = null;
            float bestDistSqr = float.PositiveInfinity;

            int visits = 0;

            while (bfsQueueHead < bfsQueueTail && visits < maxVisits)
            {
                OctNode current = bfsQueue[bfsQueueHead++];
                visits++;

                if (!current.hasCollision)
                {
                    GraphNode gn;
                    if (nodes.TryGetValue(current, out gn))
                    {
                        Vector3 d = gn.Center - sample;
                        float distSqr = d.sqrMagnitude;

                        if (distSqr < bestDistSqr)
                        {
                            bestDistSqr = distSqr;
                            bestLeaf = current;
                        }
                    }
                }

                for (int i = 0; i < 6; i++)
                {
                    OctNode neigh = current.faceLinks != null
                        ? current.faceLinks[i]
                        : current.GetFaceNeighbour((Direction)i);

                    if (neigh == null)
                    {
                        continue;
                    }

                    if (neigh.bfsSearchId == currentBfsSearchId)
                    {
                        continue;
                    }

                    neigh.bfsSearchId = currentBfsSearchId;

                    if (bfsQueueTail < bfsQueue.Length)
                    {
                        bfsQueue[bfsQueueTail++] = neigh;
                    }
                }
            }

            if (bestLeaf != null)
            {
                return nodes[bestLeaf];
            }

            return null;
        }

        public GraphNode GetClosestNodeNew(Vector3 position)
        {
            GraphNode current = nodes.First().Value;
            float closestDistanceSqr = (current.Bounds.ClosestPoint(position) - position).sqrMagnitude;

            bool moved = false;
            do
            {
                moved = false;
                foreach (GraphEdge edge in current.edges)
                {
                    GraphNode neighbor = (edge.a == current) ? edge.b : edge.a;
                    float distanceSqr = (neighbor.Bounds.ClosestPoint(position) - position).sqrMagnitude;
                    if (distanceSqr < closestDistanceSqr)
                    {
                        closestDistanceSqr = distanceSqr;
                        current = neighbor;
                        moved = true;
                        break;
                    }
                }
            }
            while (moved);

            if (current == null)
            {
                Debug.Log("null node");    
            }
            return current;
        }
    }
}