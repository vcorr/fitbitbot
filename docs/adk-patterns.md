# Google ADK Patterns & Conventions

Reference for building the fitness coach agent with [Google ADK for TypeScript](https://google.github.io/adk-docs/).

## FunctionTool Definition

```typescript
import { FunctionTool } from "@google/adk";
import { z } from "zod";

const tool = new FunctionTool({
  name: "get_something",           // action-oriented, snake_case
  description: "Detailed description — this is what the LLM reads to decide when to invoke",
  parameters: z.object({
    days: z.number().min(7).max(30).describe("Number of days of history"),
  }),
  execute: async ({ days }) => {
    return { success: true, data: result };
  },
});
```

### Tool Design Rules

| Rule | Why |
|---|---|
| Minimize parameters (1-3) | Reduces LLM cognitive load |
| Use primitive types (string, number) | Better LLM compatibility |
| No default values on params | LLM should explicitly decide |
| Single responsibility per tool | Easier for LLM to choose correctly |
| Meaningful names | Name heavily influences invocation |
| `.describe()` every Zod field | LLM needs to understand each param |

### Return Convention

All tools in this project return:
```typescript
{ success: boolean; data?: unknown; error?: string }
```

## Agent Architecture

Single `LlmAgent` with tools — no multi-agent needed for this use case.

```typescript
import { LlmAgent } from "@google/adk";

export const rootAgent = new LlmAgent({
  name: "fitness_coach",
  model: "gemini-3-flash-preview",
  instruction: COACH_INSTRUCTION,
  tools: allTools,
});
```

### Available Multi-Agent Patterns (for future)

- **SequentialAgent** — run sub-agents in order, shared context
- **ParallelAgent** — concurrent execution, isolated branches
- **LoopAgent** — repeat until condition or max iterations
- **AgentTool** — wrap an agent as a callable tool
- State sharing via `session.state` and `outputKey`

## Development Commands

```bash
# Interactive dev UI (recommended for testing)
npx adk web

# CLI mode
npx adk run src/index.ts

# REST API with Swagger
npx adk api_server

# Evaluation datasets
npx adk eval

# Fixture mode (no live API calls)
USE_FIXTURES=true npx adk web
```

## Fixture Mode

Set `USE_FIXTURES=true` to read from `fixtures/` instead of calling the live Fitbit API. This avoids burning the 150 req/hour rate limit during development.

Refresh fixtures with:
```bash
FITBIT_API_KEY=<key> node scripts/snapshot-api.js
```

## Resources

- [ADK TypeScript Docs](https://google.github.io/adk-docs/get-started/typescript/)
- [FunctionTool Guide](https://google.github.io/adk-docs/tools-custom/function-tools/)
- [Multi-Agent Systems](https://google.github.io/adk-docs/agents/multi-agents/)
- [ADK JS Source](https://github.com/google/adk-js)
- [ADK Samples](https://github.com/google/adk-samples)
