# Git workflow

## Creating a pull request

When the user asks an agent to create a pull request, the agent must complete
this workflow in order:

1. Rebase the task branch onto the current local `master`.
2. Resolve every rebase conflict and verify the resulting code, rather than
   abandoning the rebase or leaving conflict markers behind.
3. Combine all commits belonging to the task into one coherent commit.
4. Run `just check` and ensure it passes.
5. Push the task branch to `origin`.
6. Create a pull request targeting `master` and open it.
7. Approve the pull request for merging into `master` through the merge queue.
8. Monitor the pull request once per minute until it is merged. If a check,
   conflict, merge-queue requirement, or other problem blocks the merge, fix
   the problem, run `just check`, push the fix, and return the pull request to
   the merge queue when needed. Repeat this cycle until the pull request is
   merged.
9. Return the pull request URL and report that it was merged.

The workflow is complete only when the pull request has been merged into
`master`.

## Issue tracking

Open issues in the `streambrew` repository are automatically added to the
`StreamBrew` GitHub Project with the `Backlog` status. This behavior is managed
by the project's `Auto-add to project` and `Item added to project` workflows.
