export * as HubGithub from "./github.js"

import type { Entry } from "../types.js"

// GitHub through the gh CLI. gh signs in once and keeps the token itself, so
// these work where plain git fails on credentials over HTTPS; github.setup-git
// hands that login to git for push and pull. gh takes the same arguments in
// every shell, so bash and PowerShell share each template.
const gh = (command: string) => ({ bash: command, pwsh: command })

export const entries: Entry[] = [
  {
    id: "github.auth-status",
    title: "GitHub sign-in status",
    description: "Show which GitHub account gh is signed in to and the token's scopes",
    category: "github",
    requires: ["gh"],
    templates: gh("gh auth status"),
  },
  {
    id: "github.setup-git",
    title: "Let git use the gh login",
    description: "Make git push, pull and clone over HTTPS sign in with gh's GitHub account",
    category: "github",
    requires: ["gh", "git"],
    danger: true,
    templates: gh("gh auth setup-git"),
  },
  {
    id: "github.repo-view",
    title: "View repository",
    description: "Show a GitHub repository's description and README, the current one when none is named",
    category: "github",
    requires: ["gh"],
    templates: gh("gh repo view {repo?}"),
  },
  {
    id: "github.repo-clone",
    title: "Clone repository",
    description: "Clone a GitHub repository by owner/name through the gh login",
    category: "github",
    requires: ["gh", "git"],
    danger: true,
    templates: gh("gh repo clone {repo} {directory?}"),
  },
  {
    id: "github.pr-list",
    title: "List pull requests",
    description: "Open pull requests of the current repository",
    category: "github",
    requires: ["gh"],
    templates: gh("gh pr list --limit {limit}"),
  },
  {
    id: "github.pr-view",
    title: "View pull request",
    description: "Show a pull request with its comments, the current branch's when none is named",
    category: "github",
    requires: ["gh"],
    templates: gh("gh pr view {pr?} --comments"),
  },
  {
    id: "github.pr-diff",
    title: "Pull request diff",
    description: "Print the changes of a pull request",
    category: "github",
    requires: ["gh"],
    templates: gh("gh pr diff {pr}"),
  },
  {
    id: "github.pr-checks",
    title: "Pull request checks",
    description: "CI check results of a pull request, the current branch's when none is named",
    category: "github",
    requires: ["gh"],
    templates: gh("gh pr checks {pr?}"),
  },
  {
    id: "github.pr-create",
    title: "Create pull request",
    description: "Open a pull request from the current branch, titled and described from its commits",
    category: "github",
    requires: ["gh"],
    danger: true,
    templates: gh("gh pr create --fill {flags*}"),
  },
  {
    id: "github.pr-checkout",
    title: "Check out pull request",
    description: "Switch the working tree to a pull request's branch",
    category: "github",
    requires: ["gh", "git"],
    danger: true,
    templates: gh("gh pr checkout {pr}"),
  },
  {
    id: "github.issue-list",
    title: "List issues",
    description: "Open issues of the current repository",
    category: "github",
    requires: ["gh"],
    templates: gh("gh issue list --limit {limit}"),
  },
  {
    id: "github.issue-view",
    title: "View issue",
    description: "Show an issue with its comments",
    category: "github",
    requires: ["gh"],
    templates: gh("gh issue view {issue} --comments"),
  },
  {
    id: "github.run-list",
    title: "List workflow runs",
    description: "Recent GitHub Actions runs of the current repository",
    category: "github",
    requires: ["gh"],
    templates: gh("gh run list --limit {limit}"),
  },
  {
    id: "github.run-failed-log",
    title: "Failed run log",
    description: "Print the log of the failed steps of a GitHub Actions run",
    category: "github",
    requires: ["gh"],
    templates: gh("gh run view {run} --log-failed"),
  },
  {
    id: "github.api",
    title: "Call the GitHub API",
    description: "GET a GitHub REST endpoint such as repos/OWNER/REPO/releases with the gh login",
    category: "github",
    requires: ["gh"],
    templates: gh("gh api {endpoint}"),
  },
]
