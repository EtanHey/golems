def recent_clause(column: str) -> str:
    if not column.replace("_", "").isalnum():
        raise ValueError("column must be an identifier")
    return f"datetime({column}) >= datetime('now', ?)"
