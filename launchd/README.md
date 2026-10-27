# LaunchAgents

`./launchd/install-gui-path.sh` installs `com.golems.gui-path` for the current user. It renders HOME at install time and sets the GUI launchd PATH at each login so newly launched GUI apps can find provider CLIs. Restart existing apps after installation.

Use `--dry-run` to preview without writing files or calling launchctl; use `--uninstall` to unload and remove the agent. Uninstall leaves the current session's PATH intact; the next login no longer reapplies it. Install separately on each Mac after merge.
