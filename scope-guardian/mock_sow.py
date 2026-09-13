"""
Mock SOW (Statement of Work) for the KPD / Relay project.
Standing in until a real signed SOW document exists to parse.
"""

SOW_DELIVERABLES = {
    "D1": {
        "title": "Ingestion Pipeline (Jira + GitHub connectors)",
        "clauses": {
            "D1.1": "Ingestion may only use official Jira and GitHub REST APIs. "
                    "Scraping, unofficial endpoints, or browser automation are out of scope.",
            "D1.2": "Ingestion is limited to issues, comments, commits, and pull requests. "
                    "Wiki pages, boards configuration, and admin settings are out of scope.",
        },
    },
    "D2": {
        "title": "Hybrid Retrieval and Cited Q&A",
        "clauses": {
            "D2.1": "Every generated answer must cite its source ticket or commit. "
                    "Uncited or unsourced generation is out of scope.",
            "D2.2": "Retrieval is limited to indexed project data. "
                    "Real-time web search or external knowledge is out of scope.",
        },
    },
    "D3": {
        "title": "Provenance, Permissions, and Secrets Scanning",
        "clauses": {
            "D3.1": "Security work is limited to READ-time permission evaluation and "
                    "secrets scanning of committed code. Modifying Jira/GitHub permission "
                    "structures themselves is out of scope.",
            "D3.2": "Canary token detection is limited to seeded test content. "
                    "Detecting real client secrets requires separate legal sign-off, out of scope here.",
        },
    },
    "D4": {
        "title": "Scope Guardian (SOW parsing and classification)",
        "clauses": {
            "D4.1": "Auto-generated change orders must remain in DRAFT state. "
                    "Automatically sending a change order to a client is out of scope.",
            "D4.2": "Classification covers tickets under D1-D3 only. "
                    "Retroactively reclassifying already-closed engagements is out of scope.",
        },
    },
}

EPIC_TO_DELIVERABLE = {
    "KPD-1": "D1",
    "KPD-2": "D2",
    "KPD-3": "D2",
    "KPD-4": "D2",
    "KPD-5": "D4",
    "KPD-6": "D3",
    "KPD-7": "D3",
    "KPD-8": "D2",
}
