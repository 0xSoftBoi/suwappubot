# Integrating using AI - Relay

Source: https://docs.relay.link/resources/developing-with-ai

On this page
LLM-Optimized Documentation
llms.txt Files
Copy a Single Page
Using Cursor
MCP Server
Cursor @Docs
Cursor Rules
Using Claude
Claude Projects
Claude Code
Prompting Tips
Resources
Integrating using AI
Copy page

Use AI coding assistants to build with Relay faster

Relay documentation is optimized for AI coding assistants. Whether you’re using Claude, ChatGPT, Cursor, GitHub Copilot, or other AI tools, you can reference our docs directly to get accurate, up-to-date information about the Relay API and SDK.
​
LLM-Optimized Documentation
​
llms.txt Files
Relay docs support the llms.txt standard, making our documentation easily accessible to AI tools:
File	URL	Description
llms.txt	https://docs.relay.link/llms.txt	Navigation structure with page summaries
llms-full.txt	https://docs.relay.link/llms-full.txt	Complete documentation content in plain text
These files are automatically kept in sync with our documentation and provide a clean, token-efficient format for LLMs.
​
Copy a Single Page
Copy the content of any documentation page in a clean, AI-friendly format. Click the Copy page button at the top of any docs page to copy its contents, then paste it directly into your AI assistant’s context window.
This is useful when you need focused context about a specific API endpoint or feature without providing the entire documentation.
​
Using Cursor
Provide Relay documentation directly to your AI coding assistant for more accurate, context-aware code generation.
​
MCP Server
Install the Relay docs MCP server for rich, queryable access to our documentation directly from Cursor, Claude Desktop, Windsurf, or any MCP-compatible client.
One-click install for Cursor:
Manual install via CLI:
npx @mintlify/mcp add docs.relay.link

Start the server after installation:
npm --prefix ~/.mcp/docs.relay.link start

The MCP server gives your AI assistant queryable access to the full Relay documentation, including API references and SDK guides.
​
Cursor @Docs
Add Relay’s documentation as a context source in Cursor:
Open Cursor Settings → Features → Docs
Add a new documentation source with the URL https://docs.relay.link
Reference Relay docs in any Cursor chat by typing @Docs and selecting Relay
This keeps your AI assistant up to date with the latest Relay APIs without manually copying documentation.
​
Cursor Rules
Set up Relay-specific rules in your project to ensure consistent AI-generated code. Create a .cursor/rules/relay.mdc file in your project root:
---
description: Rules for building with Relay Protocol
globs:
---

- Use `@relayprotocol/relay-sdk` for server-side integrations
- Use `@relayprotocol/relay-kit-ui` for React UI components
- Always wrap components in `RelayKitProvider`, `WagmiProvider`, and `QueryClientProvider`
- Use `MAINNET_RELAY_API` or `TESTNET_RELAY_API` for the base API URL
- Only use API keys (`x-api-key` header) in server-side code, never expose them client-side
- Use TypeScript for all Relay integrations
- Refer to the Relay docs at https://docs.relay.link for the latest API reference

​
Using Claude
Claude works well with Relay documentation out of the box. Here are a few ways to get the most out of it.
​
Claude Projects
Create a dedicated Claude Project for Relay development. Add https://docs.relay.link/llms-full.txt as project knowledge so Claude has the full documentation available in every conversation.
Create a new project in Claude
Add the llms-full.txt URL as a knowledge source
Set custom instructions like “Use the Relay documentation to answer questions about the Relay SDK and API”
​
Claude Code
Use Claude Code with the Relay MCP server for context-aware assistance directly in your terminal. Add the following to your .mcp.json:
{
  "mcpServers": {
    "relay-docs": {
      "url": "https://docs.relay.link/mcp"
    }
  }
}

​
Prompting Tips
When prompting Claude (or any LLM) about Relay, keep these tips in mind:
Specify the package — Tell the model whether you’re using the SDK (@relayprotocol/relay-sdk), UI Kit (@relayprotocol/relay-kit-ui), or Hooks (@relayprotocol/relay-kit-hooks) so it generates the right imports and patterns.
Include chain context — Mention the origin and destination chains (e.g. “bridge from Ethereum to Base”) to get accurate chainId values and currency addresses.
Reference the action — Be explicit about whether you’re getting a quote, executing a bridge, or checking status. Each uses a different SDK method and endpoint.
Paste the relevant doc page — Use the Copy page button on the specific docs page you’re working with and paste it into the conversation for the most accurate results.

Was this page helpful?

Yes
No
Supported Chains
Support
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform