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
6. Create a pull request targeting `master` and return its URL to the user.

Merging the pull request is a separate operation and requires an explicit user
request.
