import asyncio
import json
import os
from dotenv import load_dotenv
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

load_dotenv()

server_params = StdioServerParameters(
    command="uvx",
    args=["mcp-atlassian"],
    env={
        **os.environ,
        "JIRA_URL": os.environ["JIRA_BASE_URL"],
        "JIRA_USERNAME": os.environ["JIRA_EMAIL"],
        "JIRA_API_TOKEN": os.environ["JIRA_API_TOKEN"],
    },
)


async def fetch_via_mcp():
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            print("Calling jira_search for project=KPD...")
            result = await session.call_tool(
                "jira_search",
                arguments={"jql": "project=KPD ORDER BY created DESC", "limit": 50},
            )

            # result.content is a list of TextContent blocks — the actual
            # JSON string lives in .text on the first one
            raw_text = result.content[0].text
            parsed = json.loads(raw_text)

            os.makedirs("corpus", exist_ok=True)
            with open("corpus/kpd_mcp_tickets.json", "w") as f:
                json.dump(parsed, f, indent=2)

            print(f"Saved {len(parsed['issues'])} tickets to corpus/kpd_mcp_tickets.json (clean JSON)")


if __name__ == "__main__":
    asyncio.run(fetch_via_mcp())
