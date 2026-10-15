"""Explicit policy delta on pinned pre-throttle goldens; never normalize actuals."""
import json


def with_background_policy(value):
    if isinstance(value, list):
        return [with_background_policy(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: with_background_policy(item) for key, item in value.items()}
    if result.get("command") == "ffmpeg":
        args = result["argv"]
        # Older frame/audio commands put the global overwrite flag last.
        if args[-1] == "-y":
            args = args[:-2] + ["-y", args[-2]]
        bounded = ["-filter_threads", "4", "-filter_complex_threads", "4"]
        for arg in args[:-1]:
            if arg == "-i":
                bounded += ["-threads", "4"]
            bounded.append(arg)
        result["argv"] = bounded + ["-threads", "4", args[-1]]
    # The shared-helper contract preserves the trace as raw file bytes.
    if "commands.jsonl" in result:
        result["commands.jsonl"] = "".join(
            json.dumps(with_background_policy(json.loads(line))) + "\n"
            for line in result["commands.jsonl"].splitlines()
        )
    return result
