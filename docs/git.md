# Git workflow

## Merging a completed task into `master`

When the user asks an agent to merge changes into `master`, the agent must
complete this workflow in order:

1. Rebase the task branch onto the current local `master`.
2. Resolve every rebase conflict and verify the resulting code, rather than
   abandoning the rebase or leaving conflict markers behind.
3. Combine all commits belonging to the task into one coherent commit.
4. Run `just check` and ensure it passes.
5. Merge that single commit into `master`, using a fast-forward merge whenever
   possible.
6. Switch the working context to the primary checkout with `master` checked
   out. If `master` is already checked out there, continue subsequent Git
   commands from that checkout instead of trying to check it out in the linked
   worktree.

Removing a task worktree does not require cleaning its PostgreSQL database or
NATS namespace immediately. Those resources are removed periodically by
running `just dev-cleanup` manually from the primary checkout.

Pushing `master` to a remote is a separate operation and should only be done
when the user requests it.
