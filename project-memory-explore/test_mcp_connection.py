import asyncio
import json
import os
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# Reads the token from the environment — a real PAT was committed here once and
# has been rotated. Never paste a token into this file again.
token = os.environ.get("GITHUB_PERSONAL_ACCESS_TOKEN")
if not token:
    raise SystemExit("Set GITHUB_PERSONAL_ACCESS_TOKEN in the environment first.")

async def test():
    server = StdioServerParameters(
        command="github-mcp-server",
        args=["stdio"],
        env={"GITHUB_PERSONAL_ACCESS_TOKEN": token}
    )
    
    async with stdio_client(server) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            print(f"Connected! Found {len(tools.tools)} tools:")
            for t in tools.tools:
                print(f"  - {t.name}")
            
            result = await session.call_tool(
                "list_commits",
                arguments={"owner": "apache", "repo": "kafka", "page": 1, "perPage": 3}
            )
            data = json.loads(result.content[0].text)
            print(f"\nGot {len(data)} commits")
            print(f"First: {data[0]['sha'][:7]} - {data[0]['commit']['message'][:60]}")

asyncio.run(test())