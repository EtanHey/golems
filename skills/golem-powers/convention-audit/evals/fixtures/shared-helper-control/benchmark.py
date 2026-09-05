from time_windows import recent_clause


RECENT_BENCHMARK_ROWS = f"SELECT * FROM chunks WHERE {recent_clause('created_at')}"
