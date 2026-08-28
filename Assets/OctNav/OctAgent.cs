using NaughtyAttributes;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.AI;

namespace OctNav
{
    [RequireComponent(typeof(NavMeshAgent))]
    [RequireComponent(typeof(Rigidbody))]
    public class OctAgent : MonoBehaviour
    {
        [Header("Base Locomotion")]
        [BoxGroup("Locomotion")] public float maxSpeed = 50f;
        [BoxGroup("Locomotion")] public float acceleration = 50f;
        [BoxGroup("Locomotion")] public float deceleration = 15f;
        [BoxGroup("Locomotion")] public float accuracy = 5f;
        [BoxGroup("Locomotion")] public float turnSpeed = 1000f;
        [BoxGroup("Locomotion")] public float stoppingDistance = 1f;


        [Header("Acceleration Profile")]
        [Tooltip("Relates acceleration multiplier (y) to delta velocity (x)")]
        [BoxGroup("Locomotion")] public AnimationCurve accelerationGraph = AnimationCurve.EaseInOut(0f, 0.5f, 1f, 3f);


        [Header("Turning Speed Curve")]
        [Tooltip("Relates velocity multiplier (y) to turning degrees per second (x)")]
        [BoxGroup("Locomotion")] public AnimationCurve turnRateToSpeed = AnimationCurve.Linear(0f, 1f, 100f, 0.3f);


        [Header("Auto Path")]
        [SerializeField, BoxGroup("Toggles")] private bool enableAutoPath = true;
        [ShowIf(nameof(enableAutoPath)), BoxGroup("Toggles"), SerializeField] private float maxDistanceFromPath = 5f;
        [ShowIf(nameof(enableAutoPath)), BoxGroup("Toggles"),SerializeField] private float targetMoveThreshold = 10f;


        [Header("Path Smoothing")]
        [SerializeField, BoxGroup("Toggles")] private bool enableSmoothing = true;
        [ShowIf(nameof(enableSmoothing)), BoxGroup("Toggles")] public float agentRadius = 2f;
        [Tooltip("Enable raycast-based smoothing for path segments, if disabled will use a funelling technique instead with no at runtime physics checks.")]
        [ShowIf(nameof(enableSmoothing)), BoxGroup("Toggles")]public bool enableRaycastSmoothing = true;
        [Tooltip("How many smoothing points are created, or path resolution.")]
        [ShowIf(nameof(enableSmoothing)), BoxGroup("Toggles")] public int splineSubdivisionCount = 3;


        [Header("Dynamic Pathing")]
        [Tooltip("Combines a next path with the current path.")]
        [BoxGroup("Toggles")] public bool enableDynamicRepathing = false;
        [BoxGroup("Toggles"),ShowIf(nameof(enableDynamicRepathing))] public int nodesAwayBeforeRepath = 1;
        private bool isPreloadingNextPath = false;


        [Tooltip("Goal of second combined path.")]
        public Vector3? nextGoal = null;


        [Header("Velocity-Dependent Turning")]
        [BoxGroup("Turning")] public float minTurnSpeedBoostVelocity = 0.5f; // Velocity below which boost starts
        [BoxGroup("Turning")] public float maxTurnSpeedBoostFactor = 2.0f; // Max multiplier for turnSpeed when very slow


        [Header("Aggressive Turning for Large Angles")]
        [BoxGroup("Turning")] public float snapTurnAngleThreshold = 60f; // Angle (degrees) beyond which an aggressive turn boost is applied
        [BoxGroup("Turning")] public float snapTurnAdditionalFactor = 2.0f; // Additional multiplier for turn speed when angle is very large


        [Header("Target Information")]
        [Tooltip("The target Transform to follow. If null, will use manualDestination instead.")]
        [BoxGroup("Target")] public Transform target;
        [Tooltip("If set, this will override the target and use this position as the destination.")]
        [BoxGroup("Target")] public Vector3? manualDestination = null;
        [Tooltip("Utilize for reading current path destination as a Vector3.")]
        private Vector3? currentGoal => manualDestination.HasValue ? manualDestination : target != null ? (Vector3?)target.position : null;


        [Header("Pathfinding Settings")]
        [Tooltip("The heuristic type used for A* pathfinding.")]
        [BoxGroup("Pathfinding")] public HeuristicType heuristicType = HeuristicType.Goober;
        [Tooltip("If true, the agent will use a straight path instead of A* pathfinding.")]
        [BoxGroup("Pathfinding")]public bool straightPath = false;
        [Tooltip("If true, the agent will always try keep rotation upright.")]
        [BoxGroup("Pathfinding")]public bool stayUpright = true;
        [Tooltip("If true, the agent will determine its rotaton")]
        [BoxGroup("Pathfinding")]public bool controlRotation = true;
        [Tooltip("If true, the agent will always override every other rotation to face the target.")]
        [BoxGroup("Pathfinding")]public bool faceTarget = false;
        [BoxGroup("Pathfinding")]public float faceTargetTurnMultiplier = 1f;
        [BoxGroup("Pathfinding")]public float minPathRecomputeInterval = 0.2f;
        private float nextAllowedPathTime = 0.0f;


        [Header("Circling Settings")]
        [Tooltip("Circle target instead of going straight to them")]
        [BoxGroup("Toggles")] public bool circleTarget = false;

        [ShowIf(nameof(circleTarget)), BoxGroup("Toggles")] public int circleSubdivsCount = 16;
        [ShowIf(nameof(circleTarget)), BoxGroup("Toggles")] public float circleRadius = 10;
        [ShowIf(nameof(circleTarget)), BoxGroup("Toggles")] public bool circleClockwise = true;
        [ShowIf(nameof(circleTarget)), BoxGroup("Toggles")] public float circleYOffset= 10;

        [Header("Stuck Detection")]
        [BoxGroup("Stuck")] public float stuckVelocityThreshold = 0.1f;
        [BoxGroup("Stuck")] public float stuckDistanceThreshold = 0.5f;
        [BoxGroup("Stuck")] public float stuckTimeout = 2.0f;

        private Vector3 lastStuckCheckPosition;
        private float stuckTimer = 0f;
        public event Action OnStuck;
        private bool isStuck = false;

        [Header("Line Of Sight"), BoxGroup("Toggles")]
        public bool preferLineOfSight = false;

        private int loopStartIndex = 0;
        private bool loopPath = false;
        private bool isComputingPath = false;
        /// <summary> 
        /// The current path the agent is following, represented as a list of waypoints.   
        /// </summary>
        public AgentPath currentPath = new AgentPath();
        private List<OctNavGraph.GraphNode> currentAStarPath = new List<OctNavGraph.GraphNode>();
        private OctNavGraph.GraphNode currentEndGraphNode;

        [Header("Functionality")]
        public bool isPaused { get; private set; } = false;
        public bool isMoving { get; private set; } = false;
        [Tooltip("Callback when the agent reaches its destination.")]
        public event Action OnDestinationReached;
        [Tooltip("Callback when the agent updates its path.")]
        public event Action<List<Vector3>> OnPathUpdated;
        private bool slowdownOnFinish = true;

        [Header("Utils")]
        [Tooltip("The layer mask used for raycasting and collision detection.")]
        [BoxGroup("Utils")] public LayerMask layerMask = ~0;
        [Tooltip("Draws debug information in the scene view.")]
        [BoxGroup("Utils")] public bool drawDebug = true;


        [Header("Ground Options")]
        [BoxGroup("Ground")] public NavMeshAgent navMeshAgent;
        [Tooltip("If true, the agent will use the ground path instead of flying path.")]
        private bool canWalk => navMeshAgent != null && navMeshAgent.enabled && navMeshAgent.isOnNavMesh;

        [SerializeField]
        [BoxGroup("Ground")] private bool _walking = false; 

        public bool walking
        {
            get => _walking;
            set
            {
                if (_walking == value) return;
                _walking = value;

                if (rb != null)
                {
                    rb.isKinematic = _walking; 
                }

                if (navMeshAgent != null)
                {
                    navMeshAgent.enabled = _walking;
                }
            }
        }

        [Header("Multithreading")]
        private bool useMultithreading = false;
        private IPathfindingService pathfinder;
        private CancellationTokenSource cancelToken;
        private static readonly Queue<Action> mainThreadQueue = new Queue<Action>();

        [HideInInspector] public int currentWaypoint;
       
        private Vector3 lastForward;
        private OctNavGraph.GraphNode currentGraphNode;

        private bool forceNewPath = false;
        private bool reachedDestination = false;

        private List<List<Vector3>> portals = new List<List<Vector3>>();
        private List<Vector3> viaPoints = new List<Vector3>();

        private Rigidbody rb;
        private Vector3 currentVelocity;
        private Vector3 cashedVelocity;
        private Vector3 cashedAngularVelocity;
        private Vector3 targetCachedPosition;
        private bool isOnGround;
        private float groundCheckDistance = 0.2f;
    
        private void Start()
        {
            if (OctManager.GetGraph(walking) == null || OctManager.GetGraph(walking).nodes.Count == 0) 
            { 
                Debug.LogError("No OctNavGraph found for the agent. Please ensure a valid graph is set up in the OctManager.");
                enabled = false; 
                return;
            }
            InitNavMeshAgent();
            if (useMultithreading)
            {
                pathfinder = new ThreadedPathfinding(OctManager.GetGraph(walking));
           
            }
            rb = GetComponent<Rigidbody>();
            rb.isKinematic = false;
            rb.interpolation = RigidbodyInterpolation.Interpolate;
            rb.collisionDetectionMode = CollisionDetectionMode.Continuous;
            if(walking)
            {
                rb.useGravity = true;
            }
            else
            {
                rb.useGravity = false;
            }

            currentGraphNode = OctManager.GetGraph(walking).GetClosestNode(transform.position);
            lastForward = transform.forward;
     
            isPreloadingNextPath = false;
            forceNewPath = true;

            lastStuckCheckPosition = transform.position;
            stuckTimer = 0f;
            isStuck = false;
        }

        public bool InitNavMeshAgent()
        {
            if (navMeshAgent == null)
            {
                navMeshAgent = GetComponent<NavMeshAgent>();
            }
            if (navMeshAgent != null)
            {
                navMeshAgent.enabled = walking;
                navMeshAgent.updateRotation = !(controlRotation && faceTarget);
                navMeshAgent.speed = maxSpeed;
                navMeshAgent.acceleration = acceleration;
                navMeshAgent.stoppingDistance = stoppingDistance;
                navMeshAgent.radius = agentRadius/3;
                return true;
            }
            return false;
        }
        private void Update()
        {
            lock (mainThreadQueue)
            {
                while (mainThreadQueue.Count > 0)
                { 
                    mainThreadQueue.Dequeue().Invoke(); 
                }
            }
        }
        private void FixedUpdate()
        {
            if (walking != navMeshAgent.enabled) Debug.LogWarning($"Agent {name}: walking={walking} but navMeshAgent.enabled={navMeshAgent.enabled}");
            if(!walking){
                if (ClampGraphSeeded() == true)
                {
                    Debug.Log("ClampGraphSeeded");
                   // return;
                }
            }
            // Pre-checks: Ensure necessary components and goals are present
            if (OctManager.GetGraph(walking) == null || currentGoal == null) return;

            // Handle walking movement
            if (navMeshAgent != null)
            {
                navMeshAgent.updateRotation = !(controlRotation && faceTarget);
            }

            // Sets isgrounded 
            GroundCheck();
            if (enableAutoPath) { 
                //Debug.Log($"Target position: {currentGoal.Value}, Cached position: {targetCachedPosition}");
                if (!forceNewPath && !isComputingPath && Vector3.Distance(targetCachedPosition, currentGoal.Value) > targetMoveThreshold && !straightPath)
                {
                    forceNewPath = true;
                }
            }
            if (walking && navMeshAgent != null)
            {
                try
                {
                    if(navMeshAgent.isOnNavMesh)
                    {
                        if (!navMeshAgent.pathPending &&
                            navMeshAgent.remainingDistance <= navMeshAgent.stoppingDistance)
                        {
                            if (!reachedDestination)
                            {
                                reachedDestination = true;
                                OnDestinationReached?.Invoke();
                            }
                        }
                    }
                }
                catch (Exception e) { Debug.LogWarning("Prob missing player on navmesh.."); }
            }

            // Handle destination reached or pausing
            if (!reachedDestination && !isMoving)
            {
                reachedDestination = true;
                OnDestinationReached?.Invoke();
            }
     

            // Check distance to final goal for stopping

            float distToGoal = Vector3.Distance(transform.position, currentGoal.Value);
            if (distToGoal < stoppingDistance)
            {
                reachedDestination = true;
                OnDestinationReached?.Invoke();
                if (!enableAutoPath)
                {
                    isMoving = false;
                    return;
                }
            }

            // Waypoint progression
            Vector3 nextWaypointPosition = currentPath[currentWaypoint];
            float distToNextWaypoint = Vector3.Distance(transform.position, nextWaypointPosition);

            if (distToNextWaypoint < accuracy)
            {
                currentWaypoint++;

                if (currentWaypoint >= currentPath.Length)
                {
                    currentWaypoint = circleTarget && loopPath ? loopStartIndex : currentPath.Length - 1;
                }


                if (straightPath && currentWaypoint >= currentPath.Length - 1)
                {
                    float distToFinal = Vector3.Distance(transform.position, currentPath[currentPath.Length - 1]);
                    if (distToFinal < stoppingDistance)
                    {
                        reachedDestination = true;
                        isMoving = false;
                        OnDestinationReached?.Invoke();
                        return;
                    }
                }
            }

            // Path re-calculation and recovery

            if (forceNewPath)
            {
                isMoving = true;
                if (useMultithreading)
                { 
                    GetNewPathAsync(); 
                }
                else
                {
                    GetNewPath();
                }
                   
                OnPathUpdated?.Invoke(currentPath.waypoints);
                forceNewPath = false;
            }
            float pathDistance = PathDistance();
            if (pathDistance > maxDistanceFromPath)
            {  

                int bestWaypoint = FindBestNextWaypoint();
                if (bestWaypoint != -1)
                {
                    currentWaypoint = bestWaypoint;
                }
                else
                {
                    Debug.LogWarning("No suitable recovery waypoint found, recalculating path");
                    forceNewPath = true;
                    return;
                }
            }

            if (!walking) 
            {            // Handle empty or invalid path
                if (currentPath == null || currentPath.Length == 0 || currentWaypoint < 0 || currentWaypoint >= currentPath.Length)
                {
                    forceNewPath = true;
                    isPreloadingNextPath = false;
                    isMoving = false;
                    reachedDestination = true;
                    return;
                }
            }
            // Dynamic Repathing
            if (enableDynamicRepathing && nextGoal.HasValue)
            {
                int remaining = currentAStarPath.Count - 1 - GetCurrentRawIndex();
                if (!isPreloadingNextPath && remaining < nodesAwayBeforeRepath && !straightPath && isMoving && !forceNewPath)
                {
                    PreloadAndMergePath();
                    isPreloadingNextPath = true;
                }
            }
            if (!isMoving || isPaused)
            {
                if (slowdownOnFinish) { 
                    ApplyStoppingForce();
                }
                return;
            }
            if (walking) return;
            CheckStuck();
            if(!rb.isKinematic)
            {HandleMovement(nextWaypointPosition);}
        }
        private void CheckStuck()
        {
            if (!isMoving || isPaused || currentPath == null || currentPath.Length == 0)
            {
                stuckTimer = 0f;
                isStuck = false;
                lastStuckCheckPosition = transform.position;
                return;
            }

            float distanceMoved = Vector3.Distance(transform.position, lastStuckCheckPosition);

            float velocityMag = rb != null ? rb.linearVelocity.magnitude : 0f;
            float distToNextWaypoint = Vector3.Distance(transform.position, currentPath[currentWaypoint]);

            bool notMakingProgress = distanceMoved < stuckDistanceThreshold && velocityMag < stuckVelocityThreshold && distToNextWaypoint > accuracy;

            if (notMakingProgress)
            {
                stuckTimer += Time.fixedDeltaTime;
                if (stuckTimer > stuckTimeout && !isStuck)
                {
                    isStuck = true;
                    // some enemies are being detected as stuck because IsMoving is true yet they are actually stationary so this code is fucked either way
                    //if(enableAutoPath)
                    //{
                    //    forceNewPath = true;
                    //    isPreloadingNextPath = false;
                    //}
                    //Debug.LogWarning($"[OctAgent] Agent {name} appears stuck. Triggering OnStuck.");
                    //OnStuck?.Invoke();
                }
            }
            else
            {
                stuckTimer = 0f;
                isStuck = false;
            }

            lastStuckCheckPosition = transform.position;

        }
        private void HandleMovement(Vector3 nextWaypointPosition)
        {

            // Core Movement and Rotation Logic
            Vector3 desiredDir = (nextWaypointPosition - transform.position).normalized;
            
            // Ensure lastForward is always valid, especially at start
            if (lastForward.magnitude < 0.001f)
            {
                lastForward = transform.forward;
            }

            // Calculate the angle to the desired direction
            float angleToDesired = Vector3.Angle(lastForward, desiredDir);

            // Dynamic Turn Speed Adjustment based on Current Velocity
            // Calculate a boost factor for turn speed. Higher when current velocity is low
            float currentSpeedNormalized = Mathf.Clamp01(currentVelocity.magnitude / minTurnSpeedBoostVelocity);
            float turnSpeedBoost = Mathf.Lerp(maxTurnSpeedBoostFactor, 1.0f, currentSpeedNormalized); // Lerp from maxBoost (slow) to 1.0 (fast)

            float effectiveTurnSpeed = turnSpeed * turnSpeedBoost;

            // Aggressive Turn Boost for Large Angles (to prevent spinning)
            // If the angle to desired direction is very large, allow for an even sharper turn
            if (angleToDesired > snapTurnAngleThreshold)
            {
                effectiveTurnSpeed *= snapTurnAdditionalFactor;
            }


            // Calculate the maximum angle the agent can turn in this FixedUpdate frame with ALL boosts
            float maxTurnThisFrame = effectiveTurnSpeed * Time.fixedDeltaTime;

            // Determine the actual angle the agent will turn this frame
            // This clamps the turn to the agent's max effective turn speed if the desired turn is too sharp
            float actualTurnAngleThisFrame = Mathf.Min(angleToDesired, maxTurnThisFrame);

            // Calculate the ACTUAL turn rate in degrees per second
            float turnRateDegPerSec = actualTurnAngleThisFrame * (1 / Time.fixedDeltaTime);

            // This curve still dictates how velocity is affected by the actual turning rate.
            float turnSpeedMultiplier = Mathf.Clamp01(turnRateToSpeed.Evaluate(turnRateDegPerSec));

            // Determine the actual movement direction considering turn limitations
            Vector3 movementDir;
            if (angleToDesired > maxTurnThisFrame && angleToDesired > 0.001f)
            {
                movementDir = Vector3.Slerp(lastForward, desiredDir, actualTurnAngleThisFrame / angleToDesired);
            }
            else
            {
                movementDir = desiredDir;
            }

            // Validate and normalize movementDir
            if (float.IsNaN(movementDir.x) || float.IsNaN(movementDir.y) || float.IsNaN(movementDir.z))
            {
                Debug.LogWarning("movementDir resulted in NaN, using desiredDir as fallback.");
                movementDir = desiredDir;
            }
            if (movementDir.magnitude < 0.001f)
            {
                Debug.LogWarning("movementDir is near zero, setting to transform.forward.");
                movementDir = transform.forward;
            }
            movementDir = movementDir.normalized;


            // Calculate target velocity applying the turn speed multiplier
            Vector3 targetVelocity = movementDir * maxSpeed * turnSpeedMultiplier;

            // Validate targetVelocity
            if (float.IsNaN(targetVelocity.x) || float.IsNaN(targetVelocity.y) || float.IsNaN(targetVelocity.z))
            {
                Debug.LogWarning("targetVelocity is NaN, stopping movement and returning.");
                currentVelocity = Vector3.zero;
                return;
            }

            isMoving = true;

            // Apply acceleration/deceleration
            Vector3 difference = targetVelocity - currentVelocity;
            float deltaSpeed = difference.magnitude;
            float normalizedDelta = Mathf.Clamp01(deltaSpeed / maxSpeed); // Normalize difference

            // Evaluate acceleration curve and apply
            float accelFactor = accelerationGraph.Evaluate(normalizedDelta);
            currentVelocity += difference.normalized * accelFactor * acceleration * Time.fixedDeltaTime;

            // Final validation of currentVelocity
            if (float.IsNaN(currentVelocity.x) || float.IsNaN(currentVelocity.y) || float.IsNaN(currentVelocity.z))
            {
                Debug.LogWarning("currentVelocity is NaN, resetting to zero.");
                currentVelocity = Vector3.zero;
            }

            // Apply linear velocity to Rigidbody
            /* if (walking && isOnGround)
             {
 #if UNITY_6000_0_OR_NEWER
                 rb.linearVelocity = new Vector3(currentVelocity.x, rb.linearVelocity.y, currentVelocity.z);
 #else
                 rb.velocity = new Vector3(currentVelocity.x, rb.velocity.y, currentVelocity.z);
 #endif
             }
             else*/
            {
#if UNITY_6000_0_OR_NEWER
                rb.linearVelocity = currentVelocity;
#else
                rb.velocity = currentVelocity;
#endif
            }

            // Handle agent's rotation
            if (controlRotation)
            {
                if(faceTarget && target!= null)
                {
                    RotateTowardsTarget();
                }
                else { 
                    if (desiredDir != Vector3.zero && desiredDir.magnitude > 0.001f)
                    {
                        Vector3 newForwardRotation;
                        if (angleToDesired > maxTurnThisFrame && angleToDesired > 0.001f)
                        {
                            newForwardRotation = Vector3.Slerp(lastForward, desiredDir, maxTurnThisFrame / angleToDesired);
                        }
                        else
                        {
                            newForwardRotation = desiredDir;
                        }

                        // Validate newForwardRotation before applying
                        if (!float.IsNaN(newForwardRotation.x) && !float.IsNaN(newForwardRotation.y) && !float.IsNaN(newForwardRotation.z) && newForwardRotation.magnitude > 0.001f)
                        {
                            Quaternion targetRotation = Quaternion.LookRotation(newForwardRotation, Vector3.up);

                            // Keep rotation upright if stayUpright is enabled
                            if (stayUpright)
                            {
                                Vector3 euler = targetRotation.eulerAngles;
                                euler.x = 0f;
                                euler.z = 0f;
                                targetRotation = Quaternion.Euler(euler);
                            }

                            rb.MoveRotation(targetRotation);
                            lastForward = newForwardRotation.normalized;
                        }
                        else
                        {
                            Debug.LogWarning("newForwardRotation resulted in NaN or zero magnitude, skipping rotation.");
                        }
                    }
                }
            }
            else
            {
                lastForward = transform.forward;
            }
        }

        private void RotateTowardsTarget()
        {
            if (rb == null) return;

            Vector3 look = target.position - transform.position;
            if (stayUpright) look.y = 0f;
            if (look.sqrMagnitude < 1e-6f) return;

            Quaternion desired = Quaternion.LookRotation(look.normalized, Vector3.up);
            float maxStep = turnSpeed*faceTargetTurnMultiplier * Time.fixedDeltaTime;
            rb.MoveRotation(Quaternion.RotateTowards(rb.rotation, desired, maxStep));
        }

        private float PathDistance()
        {
            if (currentPath == null || currentPath.Length == 0 || currentWaypoint >= currentPath.Length)
                return 0;

            Vector3 currentPos = transform.position;
            return currentPath.ClosestDistanceToPoint(currentPos);
        }

        private int FindBestNextWaypoint()
        {
            
           float minDistance = float.MaxValue;
           int bestIndex = -1;

           for (int i = currentWaypoint-1; i < currentPath.Length; i++)
           {
               float dist = Vector3.Distance(transform.position, currentPath[i]);
               if (dist < minDistance)
               {
                   minDistance = dist;
                   bestIndex = i;
               }
           }

            return bestIndex+1;
        }

        private void GroundCheck()
        {
            isOnGround = Physics.Raycast(transform.position, Vector3.down, groundCheckDistance);
        }

        private void ApplyStoppingForce()
        {
            if (walking)
            {
                if(navMeshAgent!=null && navMeshAgent.enabled)
                {
                    navMeshAgent.isStopped = true;
                    navMeshAgent.velocity = Vector3.zero;
                }
            }
            else if (rb != null)
            {
#if UNITY_6000_0_OR_NEWER
                rb.linearVelocity = Vector3.Lerp(rb.linearVelocity, Vector3.zero, deceleration * Time.fixedDeltaTime);
#else
                rb.velocity = Vector3.Lerp(rb.velocity, Vector3.zero, deceleration * Time.fixedDeltaTime);
#endif
            }
        }

        /// <summary>
        /// Gets the number of nodes in the current A* path.
        /// </summary>
        /// <returns>The length of the current A* path. Returns 0 if the path is null.</returns>
        public int GetAStarPathLength() => currentAStarPath?.Count ?? 0;

        /// <summary>
        /// Retrieves the OctNode at the specified index in the current A* path.
        /// </summary>
        /// <param name="index">The index of the node to retrieve.</param>
        /// <returns>
        /// The <see cref="OctNode"/> at the given index, or null if the index is out of bounds or the path is invalid.
        /// </returns>
        public OctNode GetPathNode(int index)
        {
            if (index < 0 || index >= currentAStarPath.Count)
            {
                Debug.LogError($"Index out of bounds. Path length: {currentAStarPath.Count}, Index: {index}");
                return null;
            }
            return currentAStarPath[index].octreeNode;
        }

        public void GetNewPath()
        { 
            if (Time.time < nextAllowedPathTime)
            {
                return;
            }
            if (isComputingPath)
            {
                return;
            }

            isComputingPath = true;
            
            nextAllowedPathTime = Time.time + minPathRecomputeInterval;
            reachedDestination = false;

            currentGraphNode = OctManager.GetGraph(walking).GetClosestNode(transform.position);
            if (currentGoal.HasValue)
            { 
                currentWaypoint = 0; 
                PathToPoint(currentGoal.Value);
                targetCachedPosition = currentGoal.Value;
            }
            else
            {
                isComputingPath = false;
                Debug.LogAssertion("Target has not been assigned to the agent: " + gameObject.name);
            }
            //Profiler.EndSample(); 
            //Profiler.enabled = false;
        }
        public static void Enqueue(Action a)
        {
            if (a == null) return;
            lock (mainThreadQueue)
            {
                mainThreadQueue.Enqueue(a);
            }
        }
        private void SmoothAndApplyPath()
        {
            Vector3 finalPoint = currentAStarPath.Last().Center;
            if (enableSmoothing)
            {
                if (enableRaycastSmoothing)
                {
                    currentPath = BuildSmoothedPathPhysics(currentAStarPath, finalPoint, splineSubdivisionCount);
                }
                else
                {
                    currentPath = BuildSmoothedPath(currentAStarPath, finalPoint, splineSubdivisionCount);
                }
            }
            else
            {
                currentPath = new AgentPath();
                foreach (OctNavGraph.GraphNode node in currentAStarPath)
                {
                    currentPath.Add(node.Center);
                }
            }

            currentWaypoint = 0;
            OnPathUpdated?.Invoke(currentPath.waypoints);
            isMoving = true;
        }
        private void GetNewPathAsync()
        {
            cancelToken?.Cancel();
            cancelToken = new CancellationTokenSource();

            OctNavGraph.GraphNode start = OctManager.GetGraph(walking).GetClosestNode(transform.position);
            OctNavGraph.GraphNode end = OctManager.GetGraph(walking).GetClosestNode(currentGoal.Value);

            currentEndGraphNode = end;

            _ = pathfinder.FindPathAsync(start, end, heuristicType)
               .ContinueWith(t =>
               {
                   if (t.IsCompletedSuccessfully && !cancelToken.IsCancellationRequested)
                   {
                       List<OctNavGraph.GraphNode> raw = t.Result;
                       if (raw == null || raw.Count == 0)
                       {
                           Debug.LogWarning("[OctAgent] A* returned no path, will retry next frame.");
                           Enqueue(() => forceNewPath = true);
                           return;
                       }

                       Enqueue(() =>
                       {
                           currentAStarPath = raw;
                           SmoothAndApplyPath();
                       });
                   }
               }, TaskScheduler.Default);
        }
        private void OnDestroy()
        {
            cancelToken?.Cancel();
            lock (mainThreadQueue) { mainThreadQueue.Clear(); }
        }

        /// <summary>
        /// Sets a manual destination point for movement, resetting any target and forcing a repath.
        /// </summary>
        /// <param name="point">The target destination as a Vector3.</param>
        public void SetDestination(Vector3 point)
        {
            
            straightPath = false;
            manualDestination = point;
            target = null;
        }
        /// <summary>
        /// Sets a new movement target using a Transform. Resets destination and forces a new path if the graph is valid.
        /// </summary>
        /// <param name="newTarget">The target Transform to follow. If null defaults to agents current target.</param>
        public void SetTarget(Transform newTarget = null)
        {
            straightPath = false;
            if(newTarget!= null)
            {
                target = newTarget;
            }
            forceNewPath = false;
            if (target == null)
            {
                Debug.LogError("Target is null.");
                Stop();
                return;
            }
            manualDestination = null;
        }

        /// <summary>
        /// Sets a straight-line movement destination. Defaults to current goal if point is not provided.
        /// </summary>
        /// <param name="point">Optional destination point. If null, uses the current goal if available.</param>
        public void SetDestinationStraight(Vector3? point = null)
        {
            Vector3? dest = point ?? currentGoal ?? null;
            if (!dest.HasValue) return;
            straightPath = true;
            manualDestination = dest;
            target = null;
        }

        /// <summary>
        /// Computes a path to the given goal position using A* or straight path logic.
        /// </summary>
        /// <param name="goalPosition">The position to navigate toward.</param>
        public void PathToPoint(Vector3 goalPosition)
        {
            if (preferLineOfSight)
            {
                if (HasLineOfSight(transform.position, goalPosition))
                {
                    SetDestinationStraight(goalPosition);
                }
                else
                {
                    Vector3 vantage;
                    if (TryFindLosVantage(goalPosition, 2, out vantage))
                    {
                        goalPosition = vantage;
                    }
                }
            }
            currentWaypoint = 0;
            isMoving = true;
            forceNewPath = false;
            if (straightPath)
            {
                if(walking && navMeshAgent != null)
                {
                    navMeshAgent.enabled = false;
                }
                currentPath = BuildStraightPath(goalPosition);
                OnPathUpdated?.Invoke(currentPath.waypoints);
                isComputingPath = false;
                return;
            }

            if (walking && navMeshAgent != null && !straightPath)
            {
                if (!currentGoal.HasValue)
                {
                    Debug.LogWarning("No target set");
                    isComputingPath = false;
                    return;
                }
                navMeshAgent.enabled = true;

                Vector3 navTarget;
                if (NavMesh.SamplePosition(currentGoal.Value, out NavMeshHit hit, 1000f, NavMesh.AllAreas))
                {
                    navTarget = hit.position;
                    navMeshAgent.SetDestination(navTarget);
                }
                else
                {
                    Debug.LogWarning("Couldn't find NavMesh position near target");
                    navMeshAgent.SetDestination(transform.position);
                }
            
                targetCachedPosition = currentGoal.Value;
                OnPathUpdated?.Invoke(currentPath.waypoints);

                isComputingPath = false;
                return;
            }

            OctNavGraph currentGraph = OctManager.GetGraph(walking);
            if (currentGraph == null || currentGraph.nodes.Count == 0)
            {
                Debug.LogError("graph is null.");
                isMoving = false;
                isComputingPath = false;
                return;
            }

            targetCachedPosition = goalPosition;

            // dont need we set this before pathing to point
            //currentGraphNode = currentGraph.GetClosestNode(transform.position);
            
            OctNavGraph.GraphNode targetGraphNode = currentGraph.GetClosestNode(currentGoal.Value);
            currentEndGraphNode = targetGraphNode;

            if (currentGraphNode == targetGraphNode)
            {
                currentAStarPath = new List<OctNavGraph.GraphNode> { currentGraphNode };
                currentPath.Clear();
                currentPath.Add(goalPosition);
                currentWaypoint = 0;
                if (circleTarget)
                {
                    currentPath.AddCircle(goalPosition, circleRadius, circleSubdivsCount, circleClockwise, circleYOffset);
                    OnPathUpdated?.Invoke(currentPath.waypoints);
                }
                isComputingPath = false;
                return;
            }
            float startTime = Time.realtimeSinceStartup;
            currentAStarPath = currentGraph.AStar(currentGraphNode, targetGraphNode, heuristicType);
            float endTime = Time.realtimeSinceStartup;

            if (currentAStarPath == null || currentAStarPath.Count == 0)
            {
              //  Debug.LogWarning("No path found in PathToTarget");
                isPreloadingNextPath = false;
                forceNewPath = true;
                isComputingPath = false;
                return;
            }
            bool reachedTarget = currentAStarPath.Last() == targetGraphNode;
            Vector3 finalPoint = reachedTarget ? goalPosition : currentAStarPath.Last().Center;

            currentWaypoint = 0;
            if (enableSmoothing)
            {
                if (enableRaycastSmoothing)
                {
                    
                    currentPath = BuildSmoothedPathPhysics(currentAStarPath, finalPoint);
                }
                else
                {
                    currentPath = BuildSmoothedPath(currentAStarPath, finalPoint);

                }
            }
            else
            {
                currentPath = new AgentPath();
                foreach (OctNavGraph.GraphNode node in currentAStarPath)
                {
                    currentPath.Add(node.Center);
                }
            }
            loopPath = false;
            if (circleTarget)
            {
                Vector3 ctr = currentPath.waypoints.Last();
                currentPath.AddCircle(currentPath.waypoints.Last(), circleRadius, circleSubdivsCount, circleClockwise, circleYOffset)  ;
                float tol = Mathf.Max(0.01f, circleRadius * 0.05f);
                int i = currentPath.Length - 1;
                while (i >= 0 && Mathf.Abs(Vector3.Distance(currentPath.waypoints[i], ctr) - circleRadius) < tol) i--;
                loopStartIndex = Mathf.Clamp(i + 1, 0, currentPath.Length - 1);
                loopPath = true;
            }
            OnPathUpdated?.Invoke(currentPath.waypoints);

            isComputingPath = false;
        }

        /// <summary>
        /// Stops the agent's movement and optionally resets its velocity.
        /// </summary>
        /// <param name="fullStop">If true, zeroes the velocity completely.</param>
        public void Stop(bool fullStop = false)
        {
            isMoving = false;
            isPaused = false;
            straightPath = false;
            /*manualDestination = null;
            /*manualDestination = null;
            target = null;*/
            // Stop NavMeshAgent immediately if walking
            if (walking && navMeshAgent != null && navMeshAgent.enabled)
            {
                navMeshAgent.isStopped = true;
                navMeshAgent.velocity = Vector3.zero;
                navMeshAgent.ResetPath();
            }

            ClearPath();

            if (fullStop)
            {
                ZeroVelocity();
            }
        }
        /// <summary>
        /// Resets the agent's movement velocity to zero, including rigidbody if present.
        /// </summary>

        private void ZeroVelocity()
        {
            currentVelocity = Vector3.zero;
     
            if (walking && navMeshAgent != null && navMeshAgent.enabled)
            {
                navMeshAgent.isStopped = true;
                navMeshAgent.velocity = Vector3.zero;
            } 
            if (rb != null)
            {
#if UNITY_6000_0_OR_NEWER
                if(!rb.isKinematic) rb.linearVelocity = Vector3.zero;
#else
                if(!rb.isKinematic) rb.velocity = Vector3.zero;
#endif
                if(!rb.isKinematic) rb.angularVelocity = Vector3.zero;

                rb.isKinematic = true;
                rb.Sleep();
            }
        }

        /// <summary>
        /// Pauses movement and stores current velocity and angular velocity.
        /// </summary>
        public void Pause()
        {
            if (!isMoving) return;
            isPaused = true;
            cashedVelocity = currentVelocity;
            cashedAngularVelocity = rb.angularVelocity;
            ZeroVelocity();
        }

        /// <summary>
        /// Resumes movement using previously cached velocity and angular velocity.
        /// </summary>
        public void Resume()
        {
            if (!isPaused) return;
            isPaused = false;
            currentVelocity = cashedVelocity;
            rb.angularVelocity = cashedAngularVelocity;
#if UNITY_6000_0_OR_NEWER
            if (rb != null)
            {
                rb.linearVelocity = cashedVelocity;
            }
#else
            if (rb != null)
            {
                rb.velocity = cashedVelocity;
            }
#endif
        }

        public class PathSubscription : IDisposable
        {
            readonly OctAgent eventAgent;
            readonly Action destitantionReachedAction; //theos dyslexia LOOOL
            public event Action OnReached;

            internal PathSubscription(OctAgent agent)
            {
                eventAgent = agent;
                destitantionReachedAction = () =>
                {
                    OnReached?.Invoke();
                };
                eventAgent.OnDestinationReached += destitantionReachedAction;
            }

            public void Dispose()
            {
                eventAgent.OnDestinationReached -= destitantionReachedAction;
            }
        }

        /// <summary>
        /// Begins movement toward the current goal. Returns a path subscription for external tracking.
        /// </summary>
        /// <param name="slowDown">If true, applies a slowdown effect when reaching the destination.</param>
        /// <returns>A <see cref="PathSubscription"/> object if goal is valid; otherwise, null.</returns>
        public PathSubscription BeginMovement(bool slowDown = true)
        {
            if(rb == null)
            {
                rb = GetComponent<Rigidbody>();
            }
            if (rb == null) return null;

            rb.isKinematic = false;
            slowdownOnFinish = slowDown;
            if (!currentGoal.HasValue)
            {
                Debug.LogWarning("Nno target or destination set");
                return null;
            }
            isPaused = false;
            isMoving = true;
            ForceRepath();
            return new PathSubscription(this);
        }

        /// <summary>
        /// Clears all current pathfinding data including raw and smoothed paths,
        /// portals, and resets the waypoint index.
        /// </summary>
        public void ClearPath()
        {
            loopStartIndex = 0;
            currentPath = new AgentPath();
            currentAStarPath = new List<OctNavGraph.GraphNode>();
            viaPoints.Clear();
            portals.Clear();
            if(navMeshAgent != null && navMeshAgent.isActiveAndEnabled && walking)
            {
                navMeshAgent.ResetPath();
            }
            currentWaypoint = 0;
        }

        /// <summary>
        /// Forces the agent to recalculate a new path immediately from scratch.
        /// Clears old data and triggers path update event.
        /// </summary>
        public void ForceRepath()
        {
            ClearPath();
            forceNewPath = true;
            isPreloadingNextPath = false;
            //GetNewPath();
        }   

        /// <summary>
        /// Builds a smoothed movement path using portal-based navigation and Catmull-Rom interpolation.
        /// Applies Y-offset correction if 'walking' is enabled.
        /// </summary>
        public AgentPath BuildSmoothedPath(List<OctNavGraph.GraphNode> rawPath, Vector3 finalTarget, float? circleRadius = null)
        {
            portals = OctUtils.ExtractPortals(rawPath);
            viaPoints = new List<Vector3>();

            for (int i = 0; i < portals.Count; i++)
            {
                List<Vector3> portal = portals[i];
                Vector3 from = (i == 0) ? transform.position : currentAStarPath[i].Center;
                Vector3 to = (i == portals.Count - 1) ? finalTarget : currentAStarPath[i + 1].Center;

                Vector3 normal = Vector3.Cross(portal[1] - portal[0], portal[2] - portal[1]).normalized;
                Plane portalPlane = new Plane(normal, portal[0]);
                Vector3 travelDir = (to - from).normalized;

                Vector3 intersection;
                if (portalPlane.Raycast(new Ray(from, travelDir), out float hitDist))
                {
                    intersection = from + travelDir * hitDist;
                }
                else
                {
                    intersection = portal.Aggregate(Vector3.zero, (acc, p) => acc + p) / portal.Count;
                }

                Bounds portalBounds = new Bounds(portal[0], Vector3.zero);
                foreach (Vector3 p in portal) portalBounds.Encapsulate(p);

                Vector3 clamped = portalBounds.ClosestPoint(intersection);
                viaPoints.Add(clamped);
            }

            viaPoints.Add(finalTarget);
            AgentPath path = SplineThrough(viaPoints, splineSubdivisionCount);

            // Remove redundant first point if coinciding with agent's position
            if (path.Length > 1 && Vector3.Distance(path[0], transform.position) < Mathf.Epsilon)
            {
                path.waypoints.RemoveAt(0);
            }

            // Align Y-position to octree height if walking
            if (walking)
            {
                for (int i = 0; i < path.Length; i++)
                {
                    float t = (path.Length == 1) ? 0f : (float)i / (path.Length - 1);
                    int rawIndex = Mathf.Clamp(Mathf.RoundToInt(t * (rawPath.Count - 1)), 0, rawPath.Count - 1);
                    float rawY = rawPath[rawIndex].octreeNode.bounds.center.y + rawPath[rawIndex].octreeNode.bounds.extents.y;

                    path.waypoints[i] = new Vector3(path.waypoints[i].x, rawY, path.waypoints[i].z);
                }
            }

            return path;
        }

        /// <summary>
        /// Builds a smoothed physics-aware path using raycasting to skip unnecessary waypoints.
        /// Uses Catmull-Rom to interpolate between collision-free segments.
        /// </summary>
        public AgentPath BuildSmoothedPathPhysics(List<OctNavGraph.GraphNode> rawPath, Vector3 finalTarget, int subdivs = 8)
        {
            List<OctNavGraph.GraphNode> pathNodes = rawPath.ToList();
            if (pathNodes.Count > 0 && pathNodes.Last().Bounds.Contains(finalTarget))
            {
                pathNodes.RemoveAt(pathNodes.Count - 1);
            }
            List<Vector3> points = new List<Vector3> { transform.position };
            AgentPath path = new AgentPath();
            
            points.AddRange(pathNodes.Skip(1).Select(n => n.Center));
            points.Add(finalTarget);

            if (points.Count < 2)
            {
                foreach (Vector3 p in points)
                {
                    path.Add(p);
                }
                return path;
            }


            viaPoints = new List<Vector3> { points[0] };
            int i = 0;
            RaycastHit[] hits = new RaycastHit[1];
            while (i < points.Count - 1)
            {
                int best = i + 1;
                for (int j = points.Count - 1; j > best; j--)
                {
                    Vector3 direction = (points[j] - points[i]).normalized;
                    float raySize = Vector3.Distance(points[i], points[j]);
                    int hitCount = Physics.SphereCastNonAlloc(points[i],agentRadius,direction, hits, raySize-agentRadius, layerMask, QueryTriggerInteraction.Ignore);
                    Color rayCol = (hitCount > 0) ? Color.red : new Color(0.4f, 0.8f, 1f, 1f);
                    
                  //  Debug.DrawRay(points[i], direction * raySize, rayCol, 10f);
                    if (hitCount == 0)
                    {
                        best = j;
                        break;
                    }
                }

                viaPoints.Add(points[best]);
                i = best;
            }

            // Interpolate between via points using Catmull-Rom
            for (int k = 0; k < viaPoints.Count - 1; k++)
            {
                Vector3 p0 = (k == 0) ? viaPoints[0] : viaPoints[k - 1];
                Vector3 p1 = viaPoints[k];
                Vector3 p2 = viaPoints[k + 1];
                Vector3 p3 = (k + 2 < viaPoints.Count) ? viaPoints[k + 2] : viaPoints[^1];  

                for (int step = 0; step < subdivs; step++)
                {
                    float t = step / (float)subdivs;
                    Vector3 point = OctUtils.CatmullRom(p0, p1, p2, p3, t);
                    path.Add(point);
                }
            }

            path.Add(viaPoints[^1]);

            if (path.Length > 1 && Vector3.Distance(path[0], transform.position) < Mathf.Epsilon)
            {
                path.waypoints.RemoveAt(0);
            }

            return path;
        }

        /// <summary>
        /// Builds a direct straight-line path from the agent to a target point, 
        /// stopping if a collision is detected along the way.
        /// </summary>
        public AgentPath BuildStraightPath(Vector3? target = null)
        {
            AgentPath path = new AgentPath();
            Vector3 start = transform.position;
            path.Add(start);

            Vector3? end = target ?? currentGoal ?? null;
            if (!end.HasValue)
            {
                return path; // Single-node path if no goal
            }

            if (Physics.Raycast(start, (end.Value - start).normalized, out RaycastHit hit, Vector3.Distance(start, end.Value), layerMask))
            {
                path.Add(hit.point);
            }
            else
            {
                path.Add(end.Value);
            }
            return path;
        }

        /// <summary>
        /// Attempts to preload a new A* path to the next goal and smoothly merge it
        /// with the existing path if applicable. Supports optional smoothing modes.
        /// </summary>
        private void PreloadAndMergePath()
        {
            OctNavGraph graph = OctManager.GetGraph(walking);
            OctNavGraph.GraphNode startNode = graph.GetClosestNode(transform.position);
            OctNavGraph.GraphNode endNode = graph.GetClosestNode(nextGoal.Value);
            List<OctNavGraph.GraphNode> newRaw = graph.AStar(startNode, endNode, heuristicType);

            if (newRaw == null || newRaw.Count == 0)
            {
                forceNewPath = true;
                isPreloadingNextPath = false;
                return;
            }

            List<OctNavGraph.GraphNode> remainingOldPath = currentAStarPath.Skip(Mathf.Clamp(GetCurrentRawIndex(), 0, currentAStarPath.Count - 1)).ToList();

            if (remainingOldPath.Count > 0 && remainingOldPath.Last().Equals(newRaw[0]))
            {
                newRaw.RemoveAt(0); // Prevent node duplication
            }

            currentAStarPath = remainingOldPath.Concat(newRaw).ToList();
            Vector3 finalPoint = (newRaw.Last() == endNode) ? currentGoal.Value : newRaw.Last().Center;

            if (enableSmoothing)
            {
                currentPath = enableRaycastSmoothing
                            ? BuildSmoothedPathPhysics(currentAStarPath, finalPoint)
                            : BuildSmoothedPath(currentAStarPath, finalPoint);
            }
            else
            {
                currentPath = new AgentPath();
                foreach (OctNavGraph.GraphNode node in currentAStarPath)
                {
                    currentPath.Add(node.Center);
                }
            }
       
            nextGoal = null;
            currentWaypoint = 0;
            OnPathUpdated?.Invoke(currentPath.waypoints);
            isPreloadingNextPath = false;
        }

        /// <summary>
        /// Returns the index in the raw A* path closest to the agent's current position or waypoint.
        /// </summary>
      
        private int GetCurrentRawIndex()
        {
            if (currentAStarPath == null || currentAStarPath.Count == 0) return 0;

            Vector3 probe = (currentWaypoint < currentPath.Length) ? currentPath[currentWaypoint] : transform.position;

            float bestDist = float.MaxValue;
            int bestIndex = 0;

            for (int i = 0; i < currentAStarPath.Count; i++)
            {
                float dist = Vector3.Distance(probe, currentAStarPath[i].Center);
                if (dist < bestDist)
                {
                    bestDist = dist;
                    bestIndex = i;
                }
            }

            return bestIndex;
        }
        /// <summary>
        /// Returns the ghost point in the list of points
        /// </summary>
        Vector3 GetGhostPoint(List<Vector3> pts, int i)
        {
            if (i < 0) return pts[0];
            else if (i >= pts.Count) return pts[^1];
            else return pts[i];
        }
        private AgentPath SplineThrough(List<Vector3> pts, int subdivs = 8, Vector3? circleCenter = null)
        {
            AgentPath path = new AgentPath();
            if (pts.Count < 2)
            {
                foreach (Vector3 p in pts) path.Add(p);
                return path;
            }


            // build segments
            for (int i = 0; i < pts.Count - 1; i++)
            {
                 Vector3 p0 = GetGhostPoint(pts, i - 1);
                 Vector3 p1 = GetGhostPoint(pts, i);
                 Vector3 p2 = GetGhostPoint(pts, i + 1);
                 Vector3 p3 = GetGhostPoint(pts, i + 2);
                 /*
                 if (i == pts.Count - 2 && circleCenter.HasValue)
                 {
                     p3 = OctUtils.ComputeGhostPoint(p1, p2, circleCenter.Value);
                 }
                 else
                 {
                    
                 }*/

                 for (int step = 0; step < subdivs; step++)
                 {
                     float t = step / (float)subdivs;
                     Vector3 point = OctUtils.CatmullRom(p0,p1,p2,p3,t);
                     path.Add(point);
                 }
            }
            path.Add(pts[^1]);

           return path;
        }
        private bool HasLineOfSight(Vector3 from, Vector3 to)
        {
            Vector3 direction = to - from;
            float dist = direction.magnitude;
            if (dist <= 0.01f)  return true; 

            return !Physics.SphereCast(from, agentRadius, direction.normalized, out RaycastHit _, dist, layerMask, QueryTriggerInteraction.Ignore);
        }
        
        
        private OctNavGraph.GraphNode lastGraphNode;
        private bool ClampGraphSeeded()
        {
            return false;
            //if (circleTarget)
            //{
            //    return false;
            //}
//
            //const float leashDistance = 2.0f;
            //const float skinDistance = 0.05f;
//
            //OctNavGraph graph = OctManager.GetGraph(walking);
            //if (graph == null)
            //{
            //    return false;
            //}
//
            //Vector3 currentPosition = transform.position;
//
            //if (lastGraphNode == null)
            //{
            //    lastGraphNode = graph.GetClosestNode(currentPosition);
            //    if (lastGraphNode == null)
            //    {
            //        return false;
            //    }
            //}
//
            //if (!lastGraphNode.Bounds.Contains(currentPosition))
            //{
            //    lastGraphNode = graph.GetClosestNode(currentPosition);
            //    if (lastGraphNode == null)
            //    {
            //        return false;
            //    }
            //}
//
            //Vector3 safePoint = lastGraphNode.Bounds.ClosestPoint(currentPosition);
            //float distanceSquaredToSafePoint = (currentPosition - safePoint).sqrMagnitude;
//
            //if (distanceSquaredToSafePoint <= leashDistance * leashDistance)
            //{
            //    return false;
            //}
//
            //Vector3 clampedInside = safePoint + (lastGraphNode.Center - safePoint).normalized * skinDistance;
//
            //if (walking && navMeshAgent != null && navMeshAgent.enabled)
            //{
            //    bool warped = navMeshAgent.Warp(clampedInside);
            //    if (!warped)
            //    {
            //        transform.position = clampedInside;
            //    }
            //}
            //else
            //{
            //    transform.position = clampedInside;
            //}
//
            //if (rb != null)
            //{
//#if UNITY_6000_0_OR_NEWER
            //    rb.linearVelocity = Vector3.zero;
//#else
            //rb.velocity = Vector3.zero;
//#endif
            //    rb.angularVelocity = Vector3.zero;
            //}

            //ForceRepath();

            //return true;
        }
        private bool TryFindLosVantage(Vector3 targetPos, int maxDepth, out Vector3 vantage)
        {
            vantage = Vector3.zero;
            OctNav.OctNavGraph graph = OctNav.OctManager.GetGraph(walking);
            if (graph == null)  return false; 

            OctNav.OctNavGraph.GraphNode start = graph.GetClosestNode(targetPos);
            
            if (start == null)
            {
                return false;
            }
            
            Queue<OctNav.OctNavGraph.GraphNode> queue = new Queue<OctNav.OctNavGraph.GraphNode>();
            HashSet<OctNav.OctNavGraph.GraphNode> seen = new HashSet<OctNav.OctNavGraph.GraphNode>();
            Dictionary<OctNav.OctNavGraph.GraphNode, int> depth = new Dictionary<OctNav.OctNavGraph.GraphNode, int>();

            queue.Enqueue(start);
            seen.Add(start);
            depth[start] = 0;

            while (queue.Count > 0)
            {
                OctNav.OctNavGraph.GraphNode n = queue.Dequeue();
                if (HasLineOfSight(n.Center, targetPos))
                {
                    vantage = n.Center;
                    return true;
                }

                int currentDepth = depth[n];
                if (currentDepth >= maxDepth) { continue; }

                for (int i = 0; i < n.edges.Count; i++)
                {
                    OctNav.OctNavGraph.GraphEdge edge = n.edges[i];
                    OctNav.OctNavGraph.GraphNode neighbor = (edge.a == n) ? edge.b : edge.a;
                    if (neighbor == null)
                    {
                        continue;
                    }

                    if (seen.Add(neighbor))
                    {
                        depth[neighbor] = currentDepth + 1;
                        queue.Enqueue(neighbor);
                    }
                }
            }
            return false;
        }
        private void OnDrawGizmosSelected()
        {

            if (!drawDebug) return;
            float radius =  agentRadius;

            Gizmos.color = Color.yellow;
            Gizmos.DrawWireSphere(new Vector3(transform.position.x, transform.position.y, transform.position.z), radius);
            if (currentGoal.HasValue) 
            { 
                if (straightPath)
                {
                    Gizmos.color = Color.yellow;
                    Gizmos.DrawLine(transform.position, currentGoal.Value);
                }
                Gizmos.color = OctColour.BrightBlue.Color();
                Gizmos.DrawSphere(currentGoal.Value, 1f);
            }
            Gizmos.color = OctColour.Chartreuse.Color();
            Gizmos.DrawWireSphere(transform.position, accuracy);

            if (walking && navMeshAgent != null && navMeshAgent.hasPath)
            {
                Vector3[] corners = navMeshAgent.path.corners;
                for (int i = 0; i < corners.Length - 1; i++)
                {
                    
                    Gizmos.color = Color.cyan;
                    Gizmos.DrawLine(corners[i], corners[i + 1]);
                    Gizmos.color = Color.blue;
                    Gizmos.DrawSphere(corners[i], 0.1f);
                }
                if (corners.Length > 0)
                {
                    Gizmos.color = Color.red;
                    Gizmos.DrawSphere(corners[corners.Length - 1], 0.15f); 
                }
                return;
            }

            if (OctManager.GetGraph(walking) != null && GetAStarPathLength() > 0)
            {
                Gizmos.color = Color.blue;
                for (int i = 0; i < GetAStarPathLength(); i++)
                {
                    Gizmos.DrawWireSphere(GetPathNode(i).bounds.center, 0.5f);
                    if (i < GetAStarPathLength() - 1)
                    {   
                        Gizmos.DrawLine(GetPathNode(i).bounds.center, GetPathNode(i + 1).bounds.center);
                    }
                }

                Gizmos.color = OctColour.Teal.Color();
                Gizmos.DrawWireSphere(GetPathNode(0).bounds.center, 0.5f);

                Gizmos.color = Color.red;
                Gizmos.DrawWireSphere(GetPathNode(GetAStarPathLength() - 1).bounds.center, 0.5f);
            }

            if (currentEndGraphNode != null)
            {
                Gizmos.color = Color.magenta;
                Gizmos.DrawWireSphere(currentEndGraphNode.Center, 1f);
            }
       /*         if (currentGoal != null)
                {
                    Gizmos.color = Color.magenta;
                    Gizmos.DrawLine(transform.position, currentGoal.Value);
                }
    */
            if (viaPoints != null)
            {
                Gizmos.color = Color.cyan;
                foreach (Vector3 p in viaPoints)
                {
                    Gizmos.DrawSphere(p, 0.1f);
                }
            }

            if (currentPath.Length > 0)
            {
               
                for (int i = 0; i < currentPath.Length; i++)
                {
                    if(i == currentPath.Length - 1)
                    {
                        Gizmos.color = Color.red;
                    }
                    else if (i == currentWaypoint)
                    {
                        Gizmos.color = Color.green;
                    }
                    else
                    {
                        Gizmos.color = Color.white;
                    }
                    Vector3 wp = currentPath[i];
                    Gizmos.DrawSphere(wp, 0.05f);

                    if (i < currentPath.Length - 1)
                    {
                        Vector3 nextWp = currentPath[i + 1];
                        Gizmos.DrawLine(wp, nextWp);
                    }
                }
            }

            if (OctManager.GetGraph(walking) == null) return;

            foreach (List<Vector3> p in portals)
            {
                for (int i = 0; i < 4; i++)
                {
                    Gizmos.color = Color.magenta;
                    Gizmos.DrawLine(p[i], p[(i + 1) % 4]);
                }
            }
        }

 
    }
}