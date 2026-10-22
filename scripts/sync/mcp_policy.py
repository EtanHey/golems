"""Default MCP deny policy shared by config generation."""


def apply_default_mcp_blocks(config):
    """Normalize every profile in memory; never modify the user's source file."""
    for profile in (config.get('contextProfiles') or {}).values():
        mcps = profile.setdefault('mcps', {})
        # Leave malformed values for sync-config's existing validation.
        if not isinstance(mcps, dict):
            continue
        allow, block = mcps.get('allow', []), mcps.get('block', [])
        if isinstance(allow, list):
            mcps['allow'] = [name for name in allow if name != 'cmuxlayer']
        if isinstance(block, list):
            mcps['block'] = list(dict.fromkeys([*block, 'cmuxlayer']))
