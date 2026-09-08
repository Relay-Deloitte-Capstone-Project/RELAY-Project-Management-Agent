"""
GitHub MCP Explorer — Project Memory Capstone
This script connects to the official GitHub MCP server and pulls data
to understand what format GitHub returns via MCP tools.

Run this AFTER starting the GitHub MCP server (see instructions below).
"""

import asyncio
import json
import os
from datetime import datetime

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from dotenv import load_dotenv

load_dotenv()

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
if not GITHUB_TOKEN:
    raise ValueError("GITHUB_TOKEN not found in .env file. See Part 1 of the guide.")

# Where we save results
OUTPUT_DIR = "corpus"
os.makedirs(OUTPUT_DIR, exist_ok=True)


def _safe_parse(result, tool_name):
    """
    Defensively parse an MCP tool result.
    Returns (data_dict, error_string).
    """
    if not result.content:
        return None, f"{tool_name}: no content returned"
    
    first = result.content[0]
    raw_text = first.text if hasattr(first, 'text') else str(first)
    
    if not raw_text or not raw_text.strip():
        return None, f"{tool_name}: empty text response"
    
    try:
        return json.loads(raw_text), None
    except json.JSONDecodeError as e:
        return None, f"{tool_name}: JSON parse error — {e}. Raw: {raw_text[:300]}"


async def explore_github_mcp():
    """
    Connects to the GitHub MCP server via stdio and calls various tools
    to see what data format comes back.
    """
    
    # Configure the GitHub MCP server as a local subprocess
    server_params = StdioServerParameters(
        command="github-mcp-server",
        args=["stdio"],
        env={"GITHUB_PERSONAL_ACCESS_TOKEN": GITHUB_TOKEN}
    )
    
    print("=" * 60)
    print("STARTING GITHUB MCP EXPLORATION")
    print("=" * 60)
    
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            
            # Initialize the session
            await session.initialize()
            print("\n✅ Connected to GitHub MCP server")
            
            # --- TOOL 1: List available tools ---
            print("\n" + "=" * 60)
            print("TOOL 1: Available MCP Tools")
            print("=" * 60)
            tools_response = await session.list_tools()
            tool_names = [tool.name for tool in tools_response.tools]
            print(f"Found {len(tool_names)} tools:")
            for name in tool_names:
                print(f"  - {name}")
            
            # Save tool list
            with open(f"{OUTPUT_DIR}/github_tools.json", "w") as f:
                json.dump(tool_names, f, indent=2)
            
            # --- TOOL 2: List commits in apache/kafka ---
            print("\n" + "=" * 60)
            print("TOOL 2: list_commits (apache/kafka, page 1, 5 commits)")
            print("=" * 60)
            commits_result = await session.call_tool(
                "list_commits",
                arguments={
                    "owner": "apache",
                    "repo": "kafka",
                    "page": 1,
                    "perPage": 5
                }
            )
            commits_data, err = _safe_parse(commits_result, "list_commits")
            if err:
                print(f"⚠️  {err}")
                commits_data = []
            else:
                print(f"Retrieved {len(commits_data)} commits")
                print("\nSample commit structure:")
                if commits_data:
                    print(json.dumps(commits_data[0], indent=2)[:1500])
            save_json(commits_data, "github_commits_list.json")
            
            # --- TOOL 3: Get a single commit with full diff ---
            print("\n" + "=" * 60)
            print("TOOL 3: get_commit (with diff/patch)")
            print("=" * 60)
            if commits_data:
                first_sha = commits_data[0].get("sha", "")
                commit_detail_result = await session.call_tool(
                    "get_commit",
                    arguments={
                        "owner": "apache",
                        "repo": "kafka",
                        "sha": first_sha
                    }
                )
                commit_full, err = _safe_parse(commit_detail_result, "get_commit")
                if err:
                    print(f"⚠️  {err}")
                    commit_full = {}
                else:
                    print(f"Commit: {commit_full.get('sha', '')[:7]}")
                    print(f"Message: {commit_full.get('commit', {}).get('message', '')[:200]}")
                    print(f"Files changed: {len(commit_full.get('files', []))}")
                    stats = commit_full.get('stats', {})
                    print(f"Stats: +{stats.get('additions', 0)} / -{stats.get('deletions', 0)}")
                    print("\nFirst file changed (with patch):")
                    files = commit_full.get("files", [])
                    if files:
                        first_file = files[0]
                        print(f"  File: {first_file.get('filename')}")
                        print(f"  Status: {first_file.get('status')}")
                        print(f"  Patch (first 800 chars):\n{first_file.get('patch', '')[:800]}")
                save_json(commit_full, "github_commit_detail.json")
            
            # --- TOOL 4: Search commits by ticket ID ---
            print("\n" + "=" * 60)
            print("TOOL 4: search_commits (KAFKA-1234)")
            print("=" * 60)
            search_result = await session.call_tool(
                "search_commits",
                arguments={
                    "query": "repo:apache/kafka KAFKA-1234"
                }
            )
            search_data, err = _safe_parse(search_result, "search_commits")
            if err:
                print(f"⚠️  {err}")
                search_data = {"total_count": 0, "items": []}
            else:
                print(f"Found {search_data.get('total_count', 0)} commits matching KAFKA-1234")
                items = search_data.get("items", [])
                if items:
                    print(f"\nFirst result: {items[0].get('sha', '')[:7]}")
                    print(f"Message: {items[0].get('commit', {}).get('message', '')[:200]}")
            save_json(search_data, "github_search_commits.json")
            
            # --- TOOL 5: List pull requests ---
            print("\n" + "=" * 60)
            print("TOOL 5: list_pull_requests (open, page 1, 3 PRs)")
            print("=" * 60)
            prs_result = await session.call_tool(
                "list_pull_requests",
                arguments={
                    "owner": "apache",
                    "repo": "kafka",
                    "state": "open",
                    "page": 1,
                    "perPage": 3
                }
            )
            prs_data, err = _safe_parse(prs_result, "list_pull_requests")
            if err:
                print(f"⚠️  {err}")
                prs_data = []
            else:
                print(f"Retrieved {len(prs_data)} PRs")
                if prs_data:
                    pr = prs_data[0]
                    print(f"\nFirst PR: #{pr.get('number')} - {pr.get('title')}")
                    print(f"State: {pr.get('state')}")
                    print(f"Body (first 500 chars): {pr.get('body', '')[:500]}")
            save_json(prs_data, "github_prs_list.json")
            
            # --- TOOL 6 & 7: Inspect schemas first, then call with correct params ---
            print("\n" + "=" * 60)
            print("TOOL 6+7: Inspecting tool schemas for correct parameter names")
            print("=" * 60)

            try:
                # Get full tool info including schemas (pydantic uses snake_case)
                tool_schemas = {t.name: t.input_schema for t in tools_response.tools}

                # Print schema for pull_request_read
                if "pull_request_read" in tool_schemas:
                    print("\n--- pull_request_read schema ---")
                    print(json.dumps(tool_schemas["pull_request_read"], indent=2))

                # Print schema for issue_read
                if "issue_read" in tool_schemas:
                    print("\n--- issue_read schema ---")
                    print(json.dumps(tool_schemas["issue_read"], indent=2))

                def build_args(tool_name, number_value):
                    """Build arguments using the parameter names from the actual schema."""
                    schema = tool_schemas.get(tool_name, {})
                    props = schema.get("properties", {})
                    required = schema.get("required", [])
                    args = {}
                    for pname in props:
                        if pname == "owner":
                            args[pname] = "apache"
                        elif pname == "repo":
                            args[pname] = "kafka"
                        elif pname == "method":
                            args[pname] = "get"
                        elif pname in ("number", "pullNumber", "pull_number",
                                       "issue_number", "issueNumber"):
                            args[pname] = number_value
                    missing = [r for r in required if r not in args]
                    if missing:
                        print(f"⚠️  {tool_name}: no value known for required param(s) {missing}")
                    return args

                # Now call with parameters that match the schema exactly
                if prs_data:
                    pr_number = prs_data[0].get("number")

                    # pull_request_read
                    print("\n--- Calling pull_request_read with schema-derived args ---")
                    try:
                        pr_args = build_args("pull_request_read", pr_number)
                        print(f"Arguments: {pr_args}")
                        pr_result = await session.call_tool(
                            "pull_request_read", arguments=pr_args
                        )
                        pr_detail, err = _safe_parse(pr_result, "pull_request_read")
                        if err:
                            print(f"⚠️  {err}")
                        else:
                            print(f"Success! Keys: {list(pr_detail.keys())}")
                            save_json(pr_detail, "github_pr_detail.json")
                    except Exception as e:
                        print(f"⚠️  Exception: {e}")

                    # issue_read (PRs are also issues — same number)
                    print("\n--- Calling issue_read with schema-derived args ---")
                    try:
                        issue_args = build_args("issue_read", pr_number)
                        print(f"Arguments: {issue_args}")
                        issue_result = await session.call_tool(
                            "issue_read", arguments=issue_args
                        )
                        issue_detail, err = _safe_parse(issue_result, "issue_read")
                        if err:
                            print(f"⚠️  {err}")
                            issue_detail = {"note": err, "number": pr_number}
                        else:
                            print(f"Issue/PR #{pr_number} title: {issue_detail.get('title', 'N/A')}")
                            comments = issue_detail.get("comments", [])
                            print(f"Comments: {len(comments)}")
                            for c in comments[:2]:
                                user = c.get('user', {}) or {}
                                print(f"  {user.get('login', 'unknown')}: {c.get('body', '')[:200]}")
                        save_json(issue_detail, "github_issue_detail.json")
                    except Exception as e:
                        print(f"⚠️  issue_read threw exception: {e}")
                        save_json({"error": str(e), "number": pr_number},
                                  "github_issue_detail.json")
                else:
                    print("⚠️  No PRs available to read")
                    save_json({"note": "No PRs available to read"},
                              "github_issue_detail.json")
            except Exception as e:
                print(f"⚠️  Schema inspection failed: {e}")
            
            print("\n" + "=" * 60)
            print("EXPLORATION COMPLETE")
            print("=" * 60)
            print(f"\nAll data saved to ./{OUTPUT_DIR}/")
            print("Files created:")
            for f in sorted(os.listdir(OUTPUT_DIR)):
                if f.startswith("github_"):
                    size = os.path.getsize(f"{OUTPUT_DIR}/{f}")
                    print(f"  - {f} ({size:,} bytes)")


def save_json(data, filename):
    """Helper to save data as pretty-printed JSON."""
    filepath = f"{OUTPUT_DIR}/{filename}"
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2, default=str)
    print(f"  💾 Saved to {filepath}")


if __name__ == "__main__":
    asyncio.run(explore_github_mcp())