# Soviet V4 Rocket Launcher V1

Status: integrated · content key: `soviet_v4` · created 2026-08-30

The four-view ImageGen sheet fixes one elevated hexagonal launch box above a five-road-wheel tracked
chassis. Meshy geometry task `01a05038-c165-75b5-8942-d5c51712dd16` consumed 20 credits and returned
1,931,168 raw triangles. The accepted local source is 24,077 triangles split into `Hull` and
`Launcher` at Y=-0.05. Meshy PBR task `01a05043-84e7-713a-a8f3-78e5aa9ef674` consumed 10 credits.

The articulation cut is sealed and samples a verified dark atlas swatch, so yaw never exposes a
white cap or daylight. Direct colour simplification stopped above 99% and was rejected; the runtime
therefore ships LOD0 plus a 1,728-triangle shadow proxy instead of publishing fake LODs. The
procedural V4 remains the fail-closed fallback.
