# @agent-harness/demo

Interactive terminal demo for `@agent-harness/core`.

## Quick Start

```bash
# Set your OpenAI API key
export OPENAI_API_KEY=sk-...

# Run the demo
pnpm start
```

## Configuration

| Environment Variable | Description | Default |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API key (required) | — |
| `DEMO_MODEL` | Model ID | `gpt-4.1` |
| `DEMO_AGENT_NAME` | Agent name in system prompt | `Core Demo Agent` |
| `DEMO_MAX_TURNS` | Maximum conversation turns | `60` |

## Controls

- **Type** your message and press **Enter** to send
- **Ctrl+C** to interrupt the current turn and exit
