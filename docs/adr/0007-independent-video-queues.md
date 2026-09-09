# Independent video queues with one queue per video

Streamers need separate viewing queues with independent thresholds, for example for different
broadcast platforms. Each video belongs to exactly one named video queue; tags cannot own the
thresholds, and multiple memberships would introduce ambiguous viewing and payment semantics.

Queue assignment is stored independently of priority assignment so videos awaiting metadata still
belong to a queue. Moving a video recalculates its priority while preserving its identity, amount,
timing and watched/bookmarked state. Currency and public visibility settings remain user-wide.
