# Issue tracker: GitHub

Issues and specs for this repo live in [GitHub Issues for khaoxkongz/ncd-api](https://github.com/khaoxkongz/ncd-api/issues). Use the `gh` CLI for tracker operations.

## Conventions

Run commands inside this clone so `gh` infers the repo from `git remote -v`, or pass `--repo khaoxkongz/ncd-api` explicitly.

- **Create an issue**: `gh issue create --title "..." --body-file <path>`. Write multiline bodies to a file first.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments`, with appropriate `--label`, `--state`, and `--limit` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards. If sub-issues are unavailable, add `Part of #<parent>` at the top of the child body and a task-list link in the parent.
- **Comment on an issue**: `gh issue comment <number> --body-file <path>`.
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`. Use the role mapping in `triage-labels.md`.
- **Close an issue**: `gh issue close <number>`. If a resolution needs a multiline comment, post it with `--body-file` before closing.

## Pull requests as a triage surface

**PRs as a request surface: no.**

If this flag is changed to `yes`, triage external PRs through the same labels and states using `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>`.
- **List external PRs**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment, label, or close**: `gh pr comment --body-file <path>`, `gh pr edit --add-label` or `--remove-label`, and `gh pr close`.

GitHub shares one number space across issues and PRs. Resolve a bare `#42` with `gh pr view 42`, falling back to `gh issue view 42`.

## Skill operations

- **Publish to the issue tracker**: create a GitHub issue.
- **Fetch the relevant ticket**: read the referenced GitHub issue.

## Wayfinding operations

Used by `/wayfinder`. A map is a single issue with child issues as decision tickets.

- **Map**: an issue labelled `wayfinder:map`, holding Notes, Decisions so far, and Fog. Create it with `gh issue create --label wayfinder:map --title "..." --body-file <path>`.
- **Child ticket**: link it to the map as a sub-issue. If sub-issues are unavailable, use a task list in the map body and `Part of #<map>` in each child. Apply `wayfinder:<type>` for `research`, `prototype`, `grilling`, or `task`; assign the driving developer when claimed.
- **Blocking**: use GitHub's native issue dependencies. Add an edge with `gh issue edit <child> --add-blocked-by <blocker>`. If the CLI lacks this flag, use `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`. Fetch the numeric database ID with `gh api repos/<owner>/<repo>/issues/<blocker> --jq .id`; it is not the issue number or `node_id`. If dependencies are unavailable, put `Blocked by: #<n>, #<n>` at the top of the child body.
- **Frontier**: list the map's open children in map order. Exclude assigned children and those with open blockers, using `issue_dependencies_summary.blocked_by` or the fallback `Blocked by` references. The first remaining child wins.
- **Claim**: `gh issue edit <number> --add-assignee @me`, before starting ticket work.
- **Resolve**: post the answer with `gh issue comment <number> --body-file <path>`, close the ticket, then append a summary and ticket link to the map's Decisions so far.

## Patients performance map

[Plan Patients performance with the same results](https://github.com/khaoxkongz/ncd-api/issues/2) is the canonical map for this effort. Its nine decision tickets are native GitHub sub-issues, with native blocking relationships.

Before continuing the effort, read the map's Notes for its session procedure and standing work limits. Execution work remains stopped until the user starts the relevant task.

The original `.scratch/patients-performance/` documents are a local archive. Read and update live ticket state on GitHub. Reference documents are linked from the map and tickets.
