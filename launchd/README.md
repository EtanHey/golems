# LaunchAgents

`./launchd/install-gui-path.sh` installs `com.golems.gui-path` for the current user. It renders HOME at install time and sets the GUI launchd PATH at each login so newly launched GUI apps can find provider CLIs. Restart existing apps after installation.

GUI apps opened at login can race the PATH update; if T3 auto-opens and still lacks CLIs, relaunch it once. Provider CLIs must be installed in the rendered PATH directories; cargo and nvm/fnm locations are not included.

Use `--dry-run` to preview without writing files or calling launchctl; use `--uninstall` to unload and remove the agent. Uninstall leaves the current session's PATH intact; the next login no longer reapplies it. Install separately on each Mac after merge.
