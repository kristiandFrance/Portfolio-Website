
# OctNav Documentation

OctNav is a powerful Unity tool for efficient navigation and pathfinding within your game environments. It leverages an octree-based system for precise and performant agent movement.

## Installation

Install OctNav from the Unity Package Manager using the following Git URL:
```none
https://github.com/DeviousDevsStudios/OctNav.git
```


## 1. OctNav Window

The main OctNav window provides a central hub for managing your navigation volumes, building octrees, and visualizing navigation data.

The OctNav Window - Build Tab

![OctWindowBuild](https://github.com/DeviousDevsStudios/OctNav/blob/main/SampleImages/OctWindowBuild.png?raw=true)

### 1.1 Build Tab

This tab is used for creating and managing your OctVolumes and initiating the octree build process.

| **Parameter** | **Description** |
|--|--|
| **Refresh** | Refreshes the Target Volume List |
| **Target Volume** | Selects the specific `OctVolume` you want to work with, or choose "All Volumes" to apply actions across all defined volumes. |
| **Create New OctVolume** | Creates a new `OctVolume` GameObject in your scene, which defines the boundaries for your navigation data. |
| **Build Selected Volume** | Initiates the octree generation for the currently selected `OctVolume` (or all volumes if "All Volumes" is selected). |
| **Reset Selected Volume** | Clears the generated octree data for the selected `OctVolume`. |
| **Important Note:** |  OctNav recommends using convex shapes for geometry near octree edges to avoid potential mispathing issues. |

![OctWindowGizmos](https://github.com/DeviousDevsStudios/OctNav/blob/main/SampleImages/OctWindowGizmos.png?raw=true)

### 1.2 Gizmos Tab

The Gizmos tab allows you to configure the visualization of OctNav's internal data, which is crucial for debugging and understanding the generated navigation mesh.

_The OctNav Window - Gizmos Tab_


| **Parameter** | **Description** |
|--|--|
| **Show Octree** | Toggles the visibility of the octree structure in the Scene view. |
| **Show Empty Leaves** | Displays octree leaves that contain no navigation data. |
| **Show Collision Leaves** | Highlights octree leaves that represent collision geometry. |
| **Draw A\* Graph** | Visualizes the entire A* graph generated for pathfinding. |
| **Draw Grounded A\* Graph** | Shows the A* graph specifically for grounded paths. |
| **Show Surface Objects** | Renders objects recognized as navigation surfaces. |
| **Enable Distance Fade** | Fades out gizmos based on their distance from the camera for better clarity. |
| **Enable Selection Mode** | Allows selection of individual octree nodes in the Scene view. |
| **Node Index** | When `Enable Selection Mode` is active, displays the index of the selected node. Used with Previous/Next Node buttons. |
| **Previous Node** / **Next Node** | Navigates through selected octree nodes when in selection mode. |
| **Frame Selected Node** | Centers the Scene view camera on the currently selected octree node. |
| **Select Nearest Node** | Selects the octree node closest to the Scene view camera. |

![OctWindowSettings](https://github.com/DeviousDevsStudios/OctNav/blob/main/SampleImages/OctWindowSettings.png?raw=true)

### 1.3 Settings Tab

This tab controls global OctNav settings that influence the octree generation process.

_The OctNav Window - Settings Tab_

| **Parameter** | **Description** |
|--|--|
| **Max Depth** | Defines the maximum subdivision depth for the octree. Higher values result in more granular navigation data but increase build time and memory usage. |
| **Geometry Mask** | Specifies which layers of geometry OctNav should consider when building the navigation octree. |


![OctBuilder](https://github.com/DeviousDevsStudios/OctNav/blob/main/SampleImages/OctBuilder.png?raw=true)
## 2. OctBuilder Component

The `OctBuilder` component is typically attached to a GameObject and provides an alternative way to build the octree for a specific `OctVolume`.

_The OctBuilder Component in the Inspector_

### 2.1 Usage Example

Here is an example of how to use the `OctBuilder` component to build a navigation graph:

```csharp
using UnityEngine;
using OctNav;

public class MyBuilderScript : MonoBehaviour
{
    public OctBuilder octBuilder;

    void Start()
    {
        // Ensure the OctBuilder component is assigned in the inspector.
        // Or get it from the GameObject if it's on the same one.
        octBuilder = GetComponent<OctBuilder>();

        // Before calling Build(), you must ensure the BoundsHandles
        // component (which is required by OctBuilder) has its bounds
        // properly defined in the editor.
        // Once the bounds are set, you can trigger the build process:
        octBuilder.Build();
        Debug.Log("Octree Navigation Graph Built!");
    }
}

```

### 2.2 Public Functions Reference

This section documents all public functions available in the `OctBuilder` class.


| **Function Signature** | **Description** | **Parameters** | **Example Usage** |
|--|--|--|--|
| `Build()` | Triggers the navigation graph build process using the bounds defined by the attached `BoundsHandles` component. This function initiates the creation of the octree-based navigation graph within the specified area. | None | `csharp public OctBuilder builder; // Assign this in the Unity Editor void Start() {	builder.Build();	Debug.Log("Navigation graph build initiated."); } ` |

















![OctVolume](https://github.com/DeviousDevsStudios/OctNav/blob/main/SampleImages/OctVolume.png?raw=true)
## 3. OctVolume Component

The `OctVolume` component defines the three-dimensional area within which OctNav will generate navigation data. Each `OctVolume` acts as a container for a portion of your navigation mesh.

_The OctVolume Component in the Inspector_


| **Parameter** | **Description** |
|--|--|
| **Geometry Mask** | Specifies which layers of geometry are included or excluded from the volume's octree generation. |
| **Max Depth** | Overrides the global Max Depth setting for this specific `OctVolume`. |
| **Perform Culling** | If enabled, OctNav will cull unnecessary geometry during the build process, potentially improving performance. |
| **Draw Gizmos Only When Selected** | If enabled, gizmos for this volume will only be shown when the GameObject is selected. |
| **Show Hit Gizmos** | Displays gizmos for collision hits detected during octree generation. |
| **Show Octree Gizmos** | Toggles the visibility of the octree structure for this specific volume. |
| **Show Surface Object Gizmos** | Renders gizmos for objects identified as navigation surfaces within this volume. |
| **Draw Graph** | Visualizes the A* graph within this volume. |
| **Draw Grounded Graph** | Shows the grounded A* graph within this volume. |
| **Show Empty Leaves Gizmos** | Displays empty octree leaves within this volume. |
| **Enable Distance Fade** | Enables distance fading for gizmos within this volume. |
| **Fade Start Distance** | The distance at which gizmo fading begins. |
| **Fade End Distance** | The distance at which gizmos are fully faded out. |
| **Build Octrees** | Manually triggers the octree build for this volume (calls `BuildChildren()`). |
| **Reset** | Clears the generated octree data for this volume (calls `ResetOctree()`). |


### 3.1 Usage Example

Here is an example of how to build the octree volume dynamically using `BuildChildren()`:

```csharp
public OctVolume volume;

public void UpdateVolume()
{
    // Build the volume at runtime if major scene changes occur
    volume.BuildChildren();
}

```

### 3.2 Public Functions Reference

This section documents all public functions available in the `OctVolume` class.


| **Function Signature** | **Description** | **Parameters** | **Returns** | **Example Usage** |
|--|--|--|--|--|
| `SaveOctree()` | Saves the current octree structure to disk. The octree data is stored in a JSON format within a specific directory relative to your Unity project (`SceneData/OctreeData/`). | None | None | `csharp public OctVolume octVolume; void SaveCurrentOctree() { octVolume.SaveOctree(); Debug.Log("Octree saved successfully."); }` |
| `LoadOctree()` | Attempts to load a previously saved octree from disk. If a saved octree is found and successfully loaded, it will rebuild the navigation graphs (both the general graph and the walkable grounded graph) based on the loaded data. | None | `bool` - `true` if the octree was successfully loaded; `false` otherwise. | `csharp public OctVolume octVolume; void Start() { if (octVolume.LoadOctree()) { Debug.Log("Octree loaded from file."); } else { Debug.LogWarning("No existing octree found or failed to load. Building a new one."); octVolume.BuildChildren(); // Fallback to building if load fails } }` |
| `BuildChildren()` | Builds a new octree from the geometry (defined by `geometryMask`) located inside the current bounds of the `OctVolume`. This is the primary function to generate the octree structure and its associated navigation graphs from scratch. It also handles setting colliders to convex temporarily during the build process if `setCollidersToConex` is enabled. | None | None | `csharp public OctVolume octVolume; void RebuildNavigation() { Debug.Log("Starting octree rebuild..."); octVolume.BuildChildren(); Debug.Log("Octree rebuild complete."); }` |
| `GetEmptyLeaves(OctNode node)` | Recursively finds all empty (non-colliding) leaf nodes within the octree starting from a given `OctNode` and adds them to the `emptyLeaves` list. These empty leaves represent navigable space. | `node`: The starting `OctNode` for the recursive search. | None | _This function is primarily called internally by OctVolume during the build process. You typically wouldn't need to call it directly._ |
| `BuildGraph()` | Adds empty leaf nodes and their connections (face links) to the main `OctNavigation.graph`. This function effectively constructs the primary navigation graph that agents can use for pathfinding. | None | None | _This function is primarily called internally by OctVolume during the build and load processes. You typically wouldn't need to call it directly._ |
| `BuildWalkableGraph()` | Builds the grounded navigation graph (`OctNavigation.groundGraph`) specifically for surface walking. It identifies "walkable" nodes (nodes with collision that have an empty node above them) and connects them, including handling steps and edges. | None | None | _This function is primarily called internally by OctVolume during the build and load processes. You typically wouldn't need to call it directly._ |
| `ResetOctree()` | Resets all internal octree data and navigation graphs associated with this volume. This clears all calculated nodes and connections, effectively preparing the volume for a new build or load operation. It also repaints the Scene View in the editor. | None | None | `csharp public OctVolume octVolume; void ResetData() { octVolume.ResetOctree(); Debug.Log("Octree data reset."); }` |
| `BuildSection(Bounds sectionBounds)` | Allows for rebuilding a specific section of the octree. This is useful for dynamic environments where only parts of the navigation mesh might change. It subdivides nodes within the `sectionBounds`, then rebuilds the affected graph parts. | `sectionBounds`: The `Bounds` defining the area to rebuild within the octree. | None | `csharp public OctVolume octVolume; public Vector3 centerOfChange; void UpdateDynamicArea() { Bounds changedArea = new Bounds(centerOfChange, new Vector3(10, 10, 10)); octVolume.BuildSection(changedArea); Debug.Log($"Section around {centerOfChange} rebuilt."); }` | `FindNodeAtPoint(Vector3 point)` | Finds and returns the specific `OctNode` that contains the given `Vector3` point within this `OctVolume`'s octree. | `point`: The `Vector3` position to search for within the octree. | `OctNode` - The `OctNode` that contains the point, or `null` if no node at that point is found or the root is null. | `csharp public OctVolume octVolume; public Transform playerTransform; void Update() { OctNode nodeUnderPlayer = octVolume.FindNodeAtPoint(playerTransform.position); if (nodeUnderPlayer != null) { Debug.Log($"Player is in octree node at: {nodeUnderPlayer.bounds.center}"); } }` |
| `DrawNodeGizmo(OctNode node, bool hitPass = false)` | This function is responsible for drawing gizmos for individual octree nodes in the Unity editor. It applies distance fading based on the camera's position and can draw either the overall octree structure or highlight collision nodes. This is an internal helper for the `OnDrawGizmos` and `OnDrawGizmosSelected` methods. | `node`: The `OctNode` to draw gizmos for. `hitPass`: A `bool` indicating if this pass is for drawing "hit" (colliding) gizmos. | None | _This function is used internally by the OctVolume to visualize the octree in the editor. You typically wouldn't call this directly from your scripts._ |



![OctAgent](https://github.com/DeviousDevsStudios/OctNav/blob/main/SampleImages/OctAgent.png?raw=true)

## 4. OctAgent Component

The `OctAgent` component is attached to any GameObject that needs to navigate using the OctNav system. It controls the agent's movement, pathfinding behavior, and interactions with the navigation octree.

_The OctAgent Component in the Inspector_

### 4.1 Base Locomotion

These parameters control the fundamental movement characteristics of the agent.

| **Parameter** | **Description** |
|--|--|
| **Max Speed** | The maximum speed the agent can reach. |
| **Acceleration** | The rate at which the agent increases its speed. |
| **Accuracy** | Determines how closely the agent adheres to its path. A lower value means tighter path following. |
| **Turn Speed** | The speed at which the agent rotates to face its target direction. |
| **Stopping Distance** | The distance from the target at which the agent will start to slow down and stop. |
| **Deceleration** | The rate at which the agent decreases its speed. |



### 4.2 Acceleration Profile
| **Parameter** | **Description** |
|--|--|
| **Acceleration Graph** | A curve defining the acceleration profile over time. |

### 4.3 Turning Speed Curve

| **Parameter** | **Description** |
|--|--|
| **Turn Rate To Speed** | A curve that can modify turn speed based on the agent's current movement speed. |


### 4.4 Path Recalculating

These settings govern when and how the agent recalculates its path.

| **Parameter** | **Description** |
|--|--|
| **Max Distance From Path** | If the agent strays further than this distance from its current path, it will recalculate a new one. |
| **Target Move Threshold** | If the target moves more than this distance, the agent will recalculate its path. |
| **Agent Radius** | The radius of the agent, used for collision avoidance and pathfinding calculations. |
| **Enable Raycast Smoothing** | Smooths the agent's movement by using raycasts to detect and adjust for obstacles. |
| **Spline Subdivision Count** | The number of subdivisions used for spline-based path smoothing. |




### 4.5 Dynamic Repathing

| **Parameter** | **Description** |
|--|--|
| **Enable Dynamic Repathing** | Allows the agent to dynamically recalculate its path if the environment changes or the current path becomes blocked. |
| **Nodes Away Before Repath** | The number of nodes an agent must be away from its target before a dynamic repath is triggered. |



### 4.6 Velocity-Dependent Turning

| **Parameter** | **Description** |
|--|--|
| **Min Turn Speed Boost Velocity** | The minimum velocity at which the agent starts to receive a turn speed boost. |
| **Max Turn Speed Boost Factor** | The maximum multiplier applied to the turn speed based on velocity. |




### 4.7 Aggressive Turning for Large Angles

| **Parameter** | **Description** |
|--|--|
| **Snap Turn Angle Threshold** | If the required turn angle exceeds this threshold, the agent will perform a "snap turn" for quicker reorientation. |
| **Snap Turn Additional Factor** | An additional multiplier applied to the turn speed during a snap turn. |



### 4.8 Target Information
| **Parameter** | **Description** |
|--|--|
| **Target** | The `Transform` that the agent will attempt to reach. |



### 4.9 Pathfinding Settings

| **Parameter** | **Description** |
|--|--|
| **Heuristic Type** | The type of heuristic function used in the A* pathfinding algorithm (e.g., Manhattan, Euclidean). |
| **Walking** | Specifies whether the agent is capable of walking on the navigation mesh. |
| **Straight Path** | If enabled, the agent attempts to follow a straight path whenever possible, reducing zig-zagging. |
| **Stay Upright** | Prevents the agent from tipping over when navigating on sloped surfaces. |
| **Control Rotation** | If enabled, OctNav will manage the agent's rotation to face its path direction. |




### 4.10 Utils

| **Parameter** | **Description** |
|--|--|
| **Layer Mask** | Defines which layers the agent can interact with for pathfinding. |
| **Draw Debug** | Toggles the visibility of debug gizmos for the agent's path and movement. |
| **Build Path** | Manually triggers the agent to build its current path to the target. |
| **Reset Path** | Clears the agent's current path. |



### 4.11 Usage Examples

Here are examples of how to move the agent to a target transform or a specific `Vector3` position:

```csharp
public void Update()
{
    // Sets the agent's target to a Unity Transform (e.g., a player object).
    // The agent will continuously try to pathfind to this transform's position.
    agent.SetTarget(player);
}
```

```csharp
public void Start()
{
    // Sets a fixed destination point for the agent.
    // The agent will navigate to this exact Vector3 coordinate.
    agent.SetDestination(new Vector3(10f, 0f, 5f));
}

```

### 4.12 Public Functions Reference

This section documents all public functions available in the `OctAgent` class.


| Function | Parameters | Returns | Description | Example Usage |
|---------|------------|---------|-------------|----------------|
| `SetDestination(Vector3 point)` | `point`: The target destination as a `Vector3`. | None | Sets a manual destination point for movement, resetting any target and forcing a repath. | `// Move the agent to the coordinates (10, 0, 5)`<br>`agent.SetDestination(new Vector3(10f, 0f, 5f));` |
| `SetTarget(Transform newTarget = null)` | `newTarget`: The target `Transform` to follow. Can be `null` to clear the target. | None | Sets a new movement target using a `Transform`. Resets any destination and repaths. | `// Set the player Transform as the agent's target`<br>`agent.SetTarget(playerTransform);`<br>`// To stop following the target:`<br>`agent.SetTarget(null);` |
| `SetDestinationStraight(Vector3? point = null)` | `point`: Optional `Vector3?`. If `null`, uses current goal if available. | None | Sets a straight-line destination. Will move directly and stop if blocked. | `// Move the agent directly to (20, 0, 10)`<br>`agent.SetDestinationStraight(new Vector3(20f, 0f, 10f));`<br>`// Move straight to current goal:`<br>`agent.SetDestinationStraight();` |
| `PathToPoint(Vector3 goalPosition)` | `goalPosition`: The `Vector3` position to navigate toward. | None | Computes a path to the given point using A* or direct logic. | `agent.PathToPoint(new Vector3(5f, 0f, 5f));` |
| `Stop(bool fullStop = false)` | `fullStop`: If `true`, fully halts and zeroes velocity. | None | Stops the agent’s movement and optionally clears all velocity. | `agent.Stop();`<br>`agent.Stop(true);` |
| `Pause()` | None | None | Pauses movement, storing current velocity. | `agent.Pause();` |
| `Resume()` | None | None | Resumes movement from paused state. | `agent.Resume();` |
| `BeginMovement()` | None | `PathSubscription` object if goal is valid; otherwise `null`. | Begins movement toward the goal and allows subscription to destination events. | `agent.SetDestination(new Vector3(100f, 0f, 100f));`<br>`using (var sub = agent.BeginMovement()) {`<br>`  if (sub != null) sub.OnReached += HandleDestinationReached;`<br>`}` |
| `ResetPath()` | None | None | Resets internal path without starting or stopping movement. | `agent.ResetPath();` |
| `GetAStarPathLength()` | None | `int` - Number of nodes in current A* path. Returns `0` if null. | Gets the current number of nodes in the A* path. | `int count = agent.GetAStarPathLength();`<br>`Debug.Log($"Current path has {count} nodes.");` |
| `GetPathNode(int index)` | `index`: Index of the node to retrieve. | `OctNode` at index or `null` if invalid. | Gets the `OctNode` at the given path index. | `if (agent.GetAStarPathLength() > 0) {`<br>`  OctNode node = agent.GetPathNode(0);`<br>`  Debug.Log(node?.bounds.center);`<br>`}` |
