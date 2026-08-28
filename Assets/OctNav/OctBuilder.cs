using UnityEngine;

namespace OctNav
{
    /// <summary>
    /// Component used to trigger the building of an octree-based navigation graph within a defined bounding area.
    /// Requires a BoundsHandles component to interactively define bounds in the editor.
    /// </summary>
    [RequireComponent(typeof(BoundsHandles))]
    public class OctBuilder : MonoBehaviour
    {
        [HideInInspector] public BoundsHandles boundHandles; // Editor-bound visual bounds manipulator
        [HideInInspector] public Bounds bounds;              // Current bounds defined for octree navigation

        private void OnValidate()
        {
            // Sets up the bounds handle and subscribes to bounds change events.
            if (boundHandles == null)
            {
                boundHandles = GetComponent<BoundsHandles>();
            }

            boundHandles.OnBoundsChanged -= UpdateBounds;
            boundHandles.OnBoundsChanged += UpdateBounds;

            bounds = boundHandles.GetBounds();
        }

        /// <summary>
        /// Updates the local bounds reference when the BoundsHandles are modified in the editor.
        /// </summary>
        private void UpdateBounds(Bounds newBounds)
        {
            bounds = newBounds;
        }

        /// <summary>
        /// Triggers the navigation graph build process using the defined bounds.
        /// </summary>
        public void Build()
        {
            OctManager.BuildNavigation(bounds);
        }
    }
}