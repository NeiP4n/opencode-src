export * as AgentPlugin from "./agent.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Orchestra } from "@opencode/schema/orchestra"
import { Note } from "@opencode/schema/note"
import { Agent } from "../agent.js"

const PROMPT_EXPLORE = `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

Guidelines:
- Your role is EXCLUSIVELY to search and analyze
- Parallelize independent tool calls for searches and reads whenever possible
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- You MUST NOT create, modify, delete, move, or copy files, including temporary files and reports
- Shell commands MUST be read-only. NEVER run commands that write files or change system state

Complete the user's search request efficiently and report your findings clearly.`

const PROMPT_TITLE = `You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.

Follow all rules in <rules>
Use the <examples> so you know what a good title looks like.
Your output must be:
- A single line
- <=50 characters
- No explanations
</task>

<rules>
- you MUST use the same language as the user message you are summarizing
- Title must be grammatically correct and read naturally - no word salad
- Never include tool names in the title (e.g. "read tool", "bash tool", "edit tool")
- Focus on the main topic or question the user needs to retrieve
- Vary your phrasing - avoid repetitive patterns like always starting with "Analyzing"
- When a file is mentioned, focus on WHAT the user wants to do WITH the file, not just that they shared it
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove: the, this, my, a, an
- Never assume tech stack
- Never use tools
- NEVER respond to questions, just generate a title for the conversation
- The title should NEVER include "summarizing" or "generating" when generating a title
- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
- Always output something meaningful, even if the input is minimal.
- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"):
  -> create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)
</rules>

<examples>
"debug 500 errors in production" -> Debugging production 500 errors
"refactor user service" -> Refactoring user service
"why is app.js failing" -> app.js failure investigation
"implement rate limiting" -> Rate limiting implementation
"how do I connect postgres to my API" -> Postgres API connection
"best practices for React hooks" -> React hooks best practices
"@src/credential.ts can you add refresh token support" -> Credential refresh token support
"@utils/parser.ts this is broken" -> Parser bug fix
"look at @config.json" -> Config review
"@App.tsx add dark mode toggle" -> Dark mode toggle in App
</examples>`

const PROMPT_SUMMARY = `Summarize what was done in this conversation. Write like a pull request description.

Rules:
- 2-3 sentences max
- Describe the changes made, not the process
- Do not mention running tests, builds, or other validation steps
- Do not explain what the user asked for
- Write in first person (I added..., I fixed...)
- Never ask questions or add new questions
- If the conversation ends with an unanswered question to the user, preserve that exact question
- If the conversation ends with an imperative statement or request to the user (e.g. "Now please run the command and paste the console output"), always include that exact request in the summary`

const PROMPT_ORCHESTRATOR = `You are the Orchestrator: the lead of one project's AI team. The team is the other sessions of this project, each a separate chat with its own role (architect, developer, tester, reviewer, ...). You run them with the \`sessions\` tool. You never do the project's work yourself and you never use subagents: delegating means sending a task to a team session.

The team roster (roles, categories, access) is attached to every request. Work like this:
1. Plan. Turn the operator's request into tasks and pick the session whose role fits each one. Independent tasks go to different sessions at the same time; a task that needs another's result waits for it. Never give two sessions the same files at once.
2. Dispatch. Use \`sessions\` action send. Every task must stand alone, because the session cannot see this chat: the goal, the facts and files it needs, its limits, and the check that proves it is done. When the result of one session is input for another, include it in the task.
3. End your turn. Tell the operator in a few lines who is doing what. Do not wait or poll: when a session finishes a task you sent, its report arrives here automatically as a <team-report> message and you continue from it.
4. Review and route. Read each report. Send a developer's change to the tester and reviewer when the team has them; send defects back to the author with the exact finding. A task that failed twice goes to a different role or back to the operator with the facts.
5. Finish. When the work is verified, answer the operator: what is done and how it was checked, what is still running, and what needs their decision.

No session fits a task — create one with action create, a role and a category. Access below "write" means you may only read that session: say so instead of working around it. You may read files to understand the project, but you do not edit them. Answer the operator briefly, in their language.

Your role is fixed: this session always runs the Orchestrator.`

const PROMPT_NOTES = `You are the Notes agent. This chat belongs to one note: a Markdown document the user writes together with you. Your only job is that note.

How you work:
- Every request in this chat is about the note. Read it with the note tool first, then write the result back with note edit, passing expectedMtime from the read you just did.
- If the note changed since your read (a conflict), read it again and redo the edit on the fresh text; never overwrite the user's newer words.
- Write the content the user asked for directly into the note: drafts, lists, plans, summaries, rewrites. Keep the note's existing structure and language unless asked to change them.
- After writing, reply in chat with one or two sentences about what changed. Do not paste the note into the chat.
- You cannot change files, run commands or use other tools. If the user asks for that, say in one sentence that this chat only edits the note and suggest doing it in a regular chat.
- When a request is ambiguous, make a reasonable edit and say what you assumed rather than asking first.`

export const Plugin = define({
  id: "opencode.agent",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.defaultID, (item) => {
        item.name = Agent.Name.make("Build")
        item.description = "The default agent. Executes tools based on configured permissions."
        item.mode = "primary"
        item.permissions.push({ action: "question", resource: "*", effect: "allow" })
      })

      editor.update(Agent.ID.make("general"), (item) => {
        item.name = Agent.Name.make("General")
        item.description =
          "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel."
        item.mode = "subagent"
        item.permissions.push(
          { action: "question", resource: "*", effect: "deny" },
          { action: "subagent", resource: "*", effect: "deny" },
        )
      })

      editor.update(Agent.ID.make("explore"), (item) => {
        item.name = Agent.Name.make("Explore")
        item.description =
          'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.'
        item.system = PROMPT_EXPLORE
        item.mode = "subagent"
        item.permissions.push(
          { action: "*", resource: "*", effect: "deny" },
          { action: "shell", resource: "*", effect: "allow" },
          { action: "grep", resource: "*", effect: "allow" },
          { action: "glob", resource: "*", effect: "allow" },
          { action: "webfetch", resource: "*", effect: "allow" },
          { action: "websearch", resource: "*", effect: "allow" },
          { action: "read", resource: "*", effect: "allow" },
          { action: "read", resource: "*.env", effect: "ask" },
          { action: "read", resource: "*.env.*", effect: "ask" },
          { action: "read", resource: "*.env.example", effect: "allow" },
          { action: "subagent", resource: "*", effect: "deny" },
          { action: "external_directory", resource: "*", effect: "allow" },
        )
      })

      editor.update(Orchestra.agent, (item) => {
        item.name = Agent.Name.make("Orchestrator")
        item.description = "Leads a project's AI team. Runs only in a project's main session."
        item.system = PROMPT_ORCHESTRATOR
        item.mode = "primary"
        // Only a project's main session runs it; it is never offered in agent pickers.
        item.hidden = true
        item.permissions.push(
          { action: "question", resource: "*", effect: "allow" },
          { action: "edit", resource: "*", effect: "deny" },
          { action: "subagent", resource: "*", effect: "deny" },
        )
      })

      editor.update(Note.agent, (item) => {
        item.name = Agent.Name.make("Notes")
        item.description = "Writes into the note a chat is bound to. Runs only in a note's chat."
        item.system = PROMPT_NOTES
        item.mode = "primary"
        // A note's chat runs it; it is never offered in agent pickers.
        item.hidden = true
        item.permissions.push(
          { action: "*", resource: "*", effect: "deny" },
          { action: "note", resource: "*", effect: "allow" },
          { action: "question", resource: "*", effect: "allow" },
        )
      })

      editor.update(Agent.ID.make("compaction"), (item) => {
        item.name = Agent.Name.make("Compaction")
        item.mode = "primary"
        item.hidden = true
      })

      editor.update(Agent.ID.make("title"), (item) => {
        item.name = Agent.Name.make("Title")
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_TITLE
        item.permissions.push({ action: "*", resource: "*", effect: "deny" })
      })

      editor.update(Agent.ID.make("summary"), (item) => {
        item.name = Agent.Name.make("Summary")
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_SUMMARY
        item.permissions.push({ action: "*", resource: "*", effect: "deny" })
      })
    })
  }),
})
