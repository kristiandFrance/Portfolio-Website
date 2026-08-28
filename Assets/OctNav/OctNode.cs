using System;
using System.Collections.Generic;
using UnityEngine;

namespace OctNav
{
    /// <summary>
    /// Direction enums used for identifying face-adjacent neighbors in an octree.
    /// </summary>
    public enum Direction { PosX = 0, NegX = 1, PosY = 2, NegY = 3, PosZ = 4, NegZ = 5 }

    /// <summary>
    /// Represents a single node in an octree spatial subdivision used for navigation.
    /// </summary>
    public class OctNode
    {
        private static int nextId;
        public readonly int id;
        public int bfsSearchId;

        public Bounds bounds;
        public OctNode[] children = new OctNode[0];
        public int depth = 0;
        private const int MaxPossibleDepth = 16;

        public bool isOutside = false;
        public bool isLeaf = false;
        public bool isEdge = false;
        public bool hasCollision = false;

        public Direction[] edgeDirs = new Direction[6];
        public OctNode[] faceLinks = new OctNode[6]; // Cached face neighbors
        public OctNode[] neighbourLinks;             // Custom connections
        public OctNode parent;

        public int SiblingIndex { get; private set; }

        private Collider[] overlapBufer = new Collider[1];

        // Scratch space to optimize traversal without memory allocations
        private static readonly int[] _scratchPath = new int[MaxPossibleDepth];
        private static int _scratchPathLen;

        /// <summary>
        /// Constructs a new OctNode with given center, size, and parent.
        /// </summary>
        public OctNode(Vector3 center, Vector3 size, OctNode parent)
        {
            id = nextId++;
            bounds = new Bounds(center, size);
            this.parent = parent;
            depth = parent != null ? parent.depth + 1 : 0;
            children = null;
        }

        /// <summary>
        /// Constructs a new OctNode with a specific ID (used during deserialization or custom indexing).
        /// </summary>
        public OctNode(int nodeId, Vector3 center, Vector3 size, OctNode parent)
        {
            id = nodeId;
            bounds = new Bounds(center, size);
            this.parent = parent;
            depth = parent != null ? parent.depth + 1 : 0;
            children = null;
        }

        /// <summary>
        /// Checks for geometry collision using OverlapBox.
        /// </summary>
        public bool CheckCollision(LayerMask geometryMask)
        {
            return Physics.OverlapBoxNonAlloc(bounds.center, bounds.extents, overlapBufer, Quaternion.identity, geometryMask, QueryTriggerInteraction.Ignore) > 0;
        }

        /// <summary>
        /// Returns the face-adjacent neighbor node in the specified direction using hierarchical traversal.
        /// </summary>
        public OctNode GetFaceNeighbour(Direction dir)
        {
            int axis = (int)dir / 2;
            int sign = ((int)dir % 2 == 0) ? +1 : -1;
            int targetBit = (sign > 0) ? 0 : 1;

            List<int> path = new List<int>();
            OctNode walk = this;
            while (walk.parent != null)
            {
                int index = Array.IndexOf(walk.parent.children, walk);
                path.Add(index);
                walk = walk.parent;
            }

            int branchLevel = -1;
            OctNode branchNode = this;
            for (int level = 0; level < path.Count; level++)
            {
                int index = path[level];
                int bit = (index >> axis) & 1;

                if ((sign > 0 && bit == 0) || (sign < 0 && bit == 1))
                {
                    branchLevel = level;
                    break;
                }

                branchNode = branchNode.parent;
            }
            if (branchLevel < 0 || branchNode == null || branchNode.parent == null) return null;

            int siblingIndex = path[branchLevel] ^ (1 << axis);
            OctNode neighbour = branchNode.parent.children[siblingIndex];
        

            for (int level = branchLevel - 1; level >= 0; level--)
            {   
                if (neighbour == null)
                {
                    return null;
                }
                if (neighbour.children == null || neighbour.children.Length == 0) break;

                int childIndex = 0;
                for (int a = 0; a < 3; a++)
                {
                    int b = (a == axis) ? targetBit : ((path[level] >> a) & 1);
                    childIndex |= (b << a);
                }

                neighbour = neighbour.children[childIndex];
            }

            return neighbour;
        }

        /// <summary>
        /// Navigates from a node's parent to a neighbor at the same depth and returns the matching child.
        /// </summary>
        public OctNode FaceNeighbourAtDepth(int childIndex, Direction dir)
        {
            if (children == null) return null;

            int bitX = (childIndex & 1);
            int bitY = ((childIndex >> 1) & 1);
            int bitZ = ((childIndex >> 2) & 1);

            switch (dir)
            {
                case Direction.PosX: if (bitX == 0) return null; bitX = 0; break;
                case Direction.NegX: if (bitX == 1) return null; bitX = 1; break;
                case Direction.PosY: if (bitY == 0) return null; bitY = 0; break;
                case Direction.NegY: if (bitY == 1) return null; bitY = 1; break;
                case Direction.PosZ: if (bitZ == 0) return null; bitZ = 0; break;
                case Direction.NegZ: if (bitZ == 1) return null; bitZ = 1; break;
                default: throw new ArgumentOutOfRangeException(nameof(dir), dir, null);
            }

            int neighbourChildIndex = (bitZ << 2) | (bitY << 1) | bitX;
            return children[neighbourChildIndex];
        }

        /// <summary>
        /// Subdivides this node into 8 children, each occupying one octant of the parent volume.
        /// </summary>
        public void Split()
        {
            Vector3 childSize = bounds.size * 0.5f;
            Vector3 childQuarter = bounds.size * 0.25f;
            children = new OctNode[8];

            for (int i = 0; i < 8; i++)
            {
                int x = (i >> 0) & 1;
                int y = (i >> 1) & 1;
                int z = (i >> 2) & 1;

                int sx = (x == 0) ? -1 : 1;
                int sy = (y == 0) ? -1 : 1;
                int sz = (z == 0) ? -1 : 1;

                Vector3 offset = new Vector3(
                    sx * childQuarter.x,
                    sy * childQuarter.y,
                    sz * childQuarter.z
                );

                Vector3 center = bounds.center + offset;
                OctNode child = new OctNode(center, childSize, this);
                child.SiblingIndex = i;
                children[i] = child;
            }
        }

        /// <summary>
        /// Recursively subdivides this node and its children to the specified max depth,
        /// checking geometry intersection at each level.
        /// </summary>
        public void SubdivideRecursive(int maxDepth, LayerMask geometryMask, Bounds volumeBounds, float targetResolution)
        {
            if (!volumeBounds.Intersects(bounds))
            {
                isOutside = true;
                hasCollision = false;
                isLeaf = true;
                return;
            }

            hasCollision = CheckCollision(geometryMask);

            float minSize = Mathf.Min(bounds.size.x, bounds.size.y, bounds.size.z);
            bool atResolution = (minSize <= targetResolution);

            if (depth >= maxDepth || !hasCollision || atResolution)
            {
                isLeaf = true;
                return;
            }
            
            //Parent has split so this is no longer a leaf node setting this just incase
            isLeaf = false;
            Split();

            if (children == null || children.Length == 0)
            {
                isLeaf = true;
                return;
            }

            foreach (OctNode child in children)
            {
                child.SubdivideRecursive(maxDepth, geometryMask, volumeBounds, targetResolution);
            }
        }
    }
}