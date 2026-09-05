from time_windows import recent_clause


RECENT_ENRICHMENT = f"SELECT * FROM chunks WHERE {recent_clause('enriched_at')}"
