"""
Converts raw compliance/doc/completion percentages into a status label,
a priority flag, and a plain-English description — matching what a
manager actually needs to see: not just a number, but "is this urgent?"
"""


def get_status_and_priority(compliance_pct, doc_pct, completion_pct):
    # --- Status label, based on scope compliance ---
    if compliance_pct >= 95:
        status = "On track"
    elif compliance_pct >= 80:
        status = "At risk"
    else:
        status = "Scope creep"

    # --- Priority: should someone act on this RIGHT NOW? ---
    if status == "Scope creep":
        priority = "urgent"
        priority_label = "Fix now"
    elif status == "At risk":
        priority = "high"
        priority_label = "Address this week"
    else:
        priority = "low"
        priority_label = "No action needed"

    # --- Plain-English description, explaining WHY ---
    if status == "On track":
        description = f"{compliance_pct}% of tickets are in scope — no significant deviation."
    elif status == "At risk":
        description = f"Only {compliance_pct}% of tickets are in scope — some flagged as out-of-scope or ambiguous. Review before this drifts further."
    else:
        description = f"Just {compliance_pct}% of tickets are in scope — this deliverable has significantly deviated from the signed SOW. Immediate review recommended."

    # --- Extra risk callout: built fast but undocumented ---
    if doc_pct < 40 and completion_pct > 70:
        description += (
            f" Also: {completion_pct}% built but only {doc_pct}% documented — "
            f"risk of knowledge loss if the assignee rotates off the project."
        )
        if priority == "low":
            priority = "high"
            priority_label = "Address this week"

    return {
        "status": status,
        "priority": priority,
        "priority_label": priority_label,
        "description": description,
    }


if __name__ == "__main__":
    # Quick test with a few example scenarios
    examples = [
        {"compliance_pct": 96.4, "doc_pct": 62.5, "completion_pct": 0},
        {"compliance_pct": 88, "doc_pct": 28, "completion_pct": 81},
        {"compliance_pct": 62, "doc_pct": 45, "completion_pct": 50},
    ]
    for e in examples:
        result = get_status_and_priority(**e)
        print(f"\nInput: {e}")
        print(f"  Status: {result['status']}")
        print(f"  Priority: {result['priority']} ({result['priority_label']})")
        print(f"  Description: {result['description']}")
