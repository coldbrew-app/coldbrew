# Independent video queues with one queue per video

Streamers need separate viewing queues, for example for different broadcast platforms. Each video
belongs to exactly one named video queue; tags and multiple memberships would make queue selection
ambiguous. Priority thresholds remain user-wide so changing one price policy consistently affects
every queue.

Queue assignment is stored independently of priority assignment so videos awaiting metadata still
belong to a queue. Moving a video preserves its priority, identity, amount, timing and
watched/bookmarked state. Currency and public visibility settings remain user-wide.
