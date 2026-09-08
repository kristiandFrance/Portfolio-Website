---
title: Sparse Voxel Octree Navigation
meta: 'UNITY PLUGIN · C# · SOLO'
blurb: >-
  OctNav: a Unity plugin that carves navigable space out of arbitrary
  geometry at runtime, then runs A* through it for ground and airborne
  agents alike. The object at the top of this page is the same idea.
detail:
  - Runtime generation
  - Partial rebuilds
  - 'A* — ground + air'
  - 'Raycast + spline smoothing'
  - Sparse by design
  - JSON save / load
order: 1
card: true
caseStudy: true
media:
  - src: '/media/octnav-window.webp'
    alt: 'The OctNav editor window in Unity, Build tab, with the OctNav crosshair logo'
    caption: 'Fig. A — The OctNav window: volumes, builds, gizmos'
    width: 603
    height: 693
  - src: '/media/octnav-volume.webp'
    alt: 'The OctVolume component inspector with geometry mask, max depth, culling and gizmo options'
    caption: 'Fig. B — OctVolume: bounds, masks, per-volume depth'
    width: 603
    height: 738
  - src: '/media/octnav-agent.webp'
    alt: 'The OctAgent component inspector showing locomotion, path recalculation, dynamic repathing and heuristic settings'
    caption: 'Fig. C — OctAgent: locomotion curves, repathing, heuristics'
    width: 603
    height: 1022
---

## The problem

Most pathfinding ships on a navmesh, and a navmesh is a surface. The moment
an agent leaves the ground — a drone, a flying enemy, anything with a jump
worth the name — a surface stops describing where it can go. A uniform 3D
grid describes volume, but it pays for every cubic metre of empty air at the
same rate it pays for the geometry that matters.

## Why an octree

A sparse voxel octree only spends memory where there is detail. Space starts
as one cell; cells that intersect geometry subdivide, recursively; cells that
don't stay whole and cheap. The result is a lattice that hugs the surface of
the world — dense where the world is dense, almost free where it's empty.

That trade is the entire point, and it's visible: the object on this site's
front page is a real sparse octree built over a mesh in your browser, and the
node count in the corner of the hero is the actual count. Empty cells never
subdivide.

## What the plugin does

I built it as a Unity package, **OctNav**, with an editor window, scene
gizmos and two components — a volume and an agent:

- **Runtime octree generation** over arbitrary geometry (`BuildChildren()`),
  with a **geometry mask** and per-volume **max depth**. No baking step
  required — and the built tree can be **saved and loaded as JSON** so a
  shipped scene skips the build entirely.
- **Two graphs from one tree**: empty leaves and their face links form the
  volumetric A\* graph for airborne agents; collision cells with clear space
  above them form the **grounded graph**, with steps and edges handled, for
  walkers.
- **Partial rebuilds** (`BuildSection(bounds)`): when the world changes,
  only the cells inside the changed bounds are re-subdivided and re-linked —
  not the whole tree.
- **A\* solved off the main thread**: a `ThreadedPathfinding` service runs
  each solve as a task over a snapshot of the graph, so agents never stall
  the frame while thinking.
- **Selectable heuristics** — Manhattan and Euclidean, plus a set of
  in-house ones (`Morrisium`, `Goober`, `Andradian`, and up-biased variants
  for agents that prefer altitude) — with **dynamic repathing** when the
  path is invalidated or the target moves.
- **Path smoothing**: raycast smoothing to cut redundant corners, and
  spline subdivision so agents don't hug voxel centres — with locomotion
  tuned by acceleration and turn-rate curves, velocity-dependent turning
  and snap turns for large angles.

## Status

Solo project, built as a Unity plugin in C#. It exists because I wanted to
understand the structure properly — not read about it, build it. If you'd
like to see it running, [email me](mailto:kris@kdfr.nz) and I'll
show you.
