#!/usr/bin/env bats
# Entry point: the original test names call mechanically moved bodies.
load 'test-repogolem-dispatch-parts/setup.bash'
load 'test-repogolem-dispatch-parts/cases-01.bash'
load 'test-repogolem-dispatch-parts/cases-02.bash'
load 'test-repogolem-dispatch-parts/cases-03.bash'
load 'test-repogolem-dispatch-parts/cases-04.bash'
load 'test-repogolem-dispatch-parts/cases-05.bash'
load 'test-repogolem-dispatch-parts/cases-06.bash'
load 'test-repogolem-dispatch-parts/cases-07.bash'
load 'test-repogolem-dispatch-parts/cases-08.bash'

@test "install helper installs tracked dispatcher inside HOME" {
    split_case_001
}

@test "install helper refuses targets outside HOME" {
    split_case_002
}

@test "installed dispatcher fixture and modules match the tracked source" {
    split_case_003
}

@test "two copied dispatchers load their own modules" {
    split_case_004
}

@test "symlink to a facade without its module directory fails loudly" {
    split_case_005
}

@test "symlinked facade resolves modules beside its real file" {
    split_case_006
}

@test "fresh installed dispatcher runs from unrelated cwd after source tree removal" {
    split_case_007
}

@test "installer refuses a missing required module before publishing facade" {
    split_case_008
}

@test "a missing late module leaves no wrappers and no partial definitions" {
    split_case_009
}

@test "a module directory from the cwd is never loaded" {
    split_case_010
}

@test "installer keeps the old facade when installing modules fails" {
    split_case_011
}

@test "golem-install validation enforces Codex safety defaults" {
    split_case_012
}

@test "tracked dispatcher source injects BrainLayer-first ambiguity gate through Gemini/agy" {
    split_case_013
}

@test "tracked dispatcher source keeps ambiguity gate on Gemini/agy continue prompts" {
    split_case_014
}

@test "tracked dispatcher source keeps ambiguity gate on Gemini/agy continue without prompt" {
    split_case_015
}

@test "tracked dispatcher source keeps ambiguity gate on Gemini/agy continue print prompts" {
    split_case_016
}

@test "tracked dispatcher source keeps ambiguity gate on Codex and Cursor continue prompts" {
    split_case_017
}

@test "tracked dispatcher source refuses Codex resume plus print while Cursor keeps print precedence" {
    split_case_018
}

@test "tracked dispatcher source run launcher prefers bun when bun.lockb exists" {
    split_case_019
}

@test "tracked dispatcher source keeps Cursor model refusal for interactive agent sessions" {
    split_case_020
}

@test "tracked dispatcher source accepts a bare Claude Opus model for a full pane" {
    split_case_021
}

@test "tracked dispatcher source resolves the fable alias to Fable 5.1 at 1M for a full pane" {
    split_case_022
}

@test "tracked dispatcher source refuses Sonnet-tier models for Claude full panes" {
    split_case_023
}

@test "tracked dispatcher source allows Sonnet-tier Claude headless runs" {
    split_case_024
}

@test "tracked dispatcher source propagates Claude exit status" {
    split_case_025
}

@test "tracked dispatcher source normalizes remote MCP URL keys for Antigravity" {
    split_case_026
}

@test "tracked dispatcher source syncs Antigravity MCP config from selected worktree" {
    split_case_027
}

@test "tracked dispatcher source maps alternate remote MCP URL keys for Codex" {
    split_case_028
}

@test "tracked dispatcher source keeps config effort for a bare fresh Codex boot and honors explicit high" {
    split_case_029
}

@test "tracked dispatcher source requires headless effort, keeps bare config and preserves continued effort" {
    split_case_030
}

@test "tracked dispatcher source pins fresh Codex launch modes to the current top Sol" {
    split_case_031
}

@test "tracked dispatcher source accepts a bare Codex model and effort override" {
    split_case_032
}

@test "tracked dispatcher source passes an unknown Codex model through verbatim" {
    split_case_033
}

@test "tracked dispatcher source restores the newest cwd-matching Codex model and effort on continue" {
    split_case_034
}

@test "tracked dispatcher source resolves Codex --last with one metadata parser process" {
    split_case_035
}

@test "tracked dispatcher source treats Codex skip permissions as a compatibility no-op" {
    split_case_036
}

@test "tracked dispatcher source restores the last model and effort for an explicit Codex session" {
    split_case_037
}

@test "tracked dispatcher source reuses the requested Codex session id with the real CLI" {
    split_case_038
}

@test "tracked dispatcher source restores raw --last and keeps explicit resume overrides authoritative" {
    split_case_039
}

@test "tracked dispatcher source skips rollout recovery when Codex resume model and effort are both explicit" {
    split_case_040
}

@test "tracked dispatcher source skips a malformed newest Codex --last rollout for the next usable session" {
    split_case_041
}

@test "tracked dispatcher source detects explicit Codex resume after root option prefixes" {
    split_case_042
}

@test "tracked dispatcher source refuses every Codex resume combined with a headless prompt" {
    split_case_043
}

@test "tracked dispatcher source refuses a resume picker it cannot honor" {
    split_case_044
}

@test "tracked dispatcher source fails loudly when resume rollout state is missing or malformed" {
    split_case_045
}

@test "tracked dispatcher source preserves cmuxlayer's canonical Codex recovery command" {
    split_case_046
}

@test "tracked dispatcher source accepts the full verified Codex effort ladder through both aliases" {
    split_case_047
}

@test "tracked dispatcher source rejects missing and invalid Codex efforts before launch" {
    split_case_048
}

@test "tracked dispatcher source exposes Codex effort launcher help without launching" {
    split_case_049
}

@test "tracked dispatcher source stops parsing Codex effort flags after double dash" {
    split_case_050
}

@test "tracked dispatcher source stops unified Codex flag parsing after double dash" {
    split_case_051
}

@test "tracked dispatcher source rejects missing model names before launch" {
    split_case_052
}

@test "tracked dispatcher source rejects missing project directories before launch" {
    split_case_053
}

@test "tracked dispatcher source passes Claude contexts by file path" {
    split_case_054
}

@test "tracked dispatcher source keeps CodexWorker launcher persona-free" {
    split_case_055
}

@test "cmuxlayerCodex --worker launches without a positional prompt" {
    split_case_056
}

@test "orcCodex --worker ignores registry agent when no prompt is supplied" {
    split_case_057
}

@test "mimirCodex --worker passes the user prompt through unchanged" {
    split_case_058
}

@test "orcCodex non-worker launch still injects its registry agent context" {
    split_case_059
}

@test "tracked dispatcher source honors GOLEM_ROLE worker mode without persona injection" {
    split_case_060
}

@test "tracked dispatcher source honors the long --worker flag without persona injection" {
    split_case_061
}

@test "tracked dispatcher source keeps Cursor --worker boot payload persona-free" {
    split_case_062
}

@test "tracked dispatcher source keeps Gemini --worker boot payload persona-free" {
    split_case_063
}

@test "tracked dispatcher source adds no worker prompt to raw Codex arguments" {
    split_case_064
}

@test "tracked dispatcher source keeps default Codex output byte-stable" {
    split_case_065
}

@test "testrepoCodex consumes -w and launches from the requested worktree" {
    split_case_066
}

@test "testrepoCodex without -w still launches from the project path" {
    split_case_067
}

@test "testrepoGemini injects BrainLayer-first ambiguity gate for named people and private voices" {
    split_case_068
}

@test "testrepoClaude defaults to Opus 5.5 1M-context (no manual /model flip)" {
    split_case_069
}

@test "testrepoClaude -S refuses Sonnet for a full pane" {
    split_case_070
}

@test "testrepoClaude -m accepts an explicit Opus model for a full pane" {
    split_case_071
}

@test "testrepoClaude --model accepts an explicit Opus model for a full pane" {
    split_case_072
}

@test "testrepoClaude -m is allowed for scripted one-shots" {
    split_case_073
}

@test "testrepoClaude -m does not require the legacy model escape hatch" {
    split_case_074
}

@test "testrepoCodex -m accepts an explicit model for a full pane" {
    split_case_075
}

@test "testrepoCursor -m refuses agent sessions" {
    split_case_076
}

@test "tracked dispatcher source keeps Codex MCP config and secrets off argv" {
    split_case_077
}

@test "tracked dispatcher source honors an explicit Codex profile instead of appending a second one" {
    split_case_078
}

@test "tracked dispatcher source scopes the Codex profile per launch directory" {
    split_case_079
}

@test "concurrency stub release wait exits on a deadline naming the sentinel instead of spinning" {
    split_case_080
}

@test "tracked dispatcher source isolates concurrent Codex profiles for the same project" {
    split_case_081
}

@test "tracked dispatcher source refuses a Codex profile when launch id generation fails" {
    split_case_082
}

@test "tracked dispatcher source renders valid TOML for a non-numeric MCP timeout" {
    split_case_083
}

@test "tracked dispatcher source renders valid TOML for non-string MCP args" {
    split_case_084
}

@test "tracked dispatcher source strips supabase --access-token args from the Codex profile" {
    split_case_085
}

@test "tracked dispatcher source strips supabase --access-token args from Antigravity MCP config" {
    split_case_086
}

@test "tracked dispatcher source strips each supabase --access-token shape from the Codex profile" {
    split_case_087
}

@test "tracked dispatcher source strips each supabase --access-token shape from Antigravity MCP config" {
    split_case_088
}

@test "tracked dispatcher source removes the Codex MCP profile once the session exits" {
    split_case_089
}

@test "tracked dispatcher source detects an attached Codex -p<profile> short flag" {
    split_case_090
}

@test "tracked dispatcher source preserves a multi-line MCP env value" {
    split_case_091
}

@test "tracked dispatcher source keeps lead personas for Cursor and Gemini" {
    split_case_092
}

@test "tracked dispatcher source keeps inherited GOLEM_ROLE=worker launches persona-free for Cursor and Gemini" {
    split_case_093
}

@test "tracked dispatcher source defines no Kiro launchers (Q-E)" {
    split_case_094
}

@test "tracked dispatcher source sets claude --effort by seat: lead high, worker medium, -E wins" {
    split_case_095
}

@test "tracked dispatcher source stages Claude launches outside /tmp" {
    split_case_096
}

@test "tracked dispatcher source stages persona and agy merges outside /tmp" {
    split_case_097
}

@test "tracked dispatcher source hardcodes no /tmp staging paths" {
    split_case_098
}

@test "tracked dispatcher source honors XDG_RUNTIME_DIR for staging" {
    split_case_099
}

@test "tracked dispatcher source keeps the notify cleanup quiet under nounset" {
    split_case_100
}

@test "tracked dispatcher source removes the notify config when a launch is interrupted" {
    split_case_101
}

@test "agy flash aliases resolve to a Flash model agy 1.2.9 accepts" {
    split_case_102
}

@test "tracked dispatcher source: concurrent agy workspace syncs for one project do not collide on BSD mktemp" {
    split_case_103
}

@test "tracked dispatcher source ends every mktemp template in X's" {
    split_case_104
}

@test "--worker exports GOLEM_ROLE=worker to the launched Codex, Cursor and Gemini CLI" {
    split_case_105
}

@test "the CodexWorker launcher exports GOLEM_ROLE=worker like codex --worker" {
    split_case_106
}

@test "--worker does not leak GOLEM_ROLE into the caller's shell after the launch returns" {
    split_case_107
}

@test "--worker restores the caller's own GOLEM_ROLE after the launch returns" {
    split_case_108
}

@test "an explicit GOLEM_ROLE=worker still reaches every launched CLI unchanged" {
    split_case_109
}

@test "a lead launch without --worker exports no GOLEM_ROLE" {
    split_case_110
}

@test "a --worker passed through after Codex -- is not the launcher flag" {
    split_case_111
}

@test "Claude --worker keeps the lead effort and exports no GOLEM_ROLE (cmuxlayer contract)" {
    split_case_112
}

@test "prelaunch commands run in order and their exports and ulimit reach the agent process" {
    split_case_113
}

@test "prelaunch effects never leak into the caller's shell" {
    split_case_114
}

@test "a failing prelaunch command warns by index, never by text, and the launch continues" {
    split_case_115
}

@test "return in a prelaunch command is contained: it warns and the launch continues" {
    split_case_116
}

@test "exit in a prelaunch command is unsupported but says so by index" {
    split_case_117
}

@test "an absent or empty prelaunch calls the agent directly, with no extra frame and no prelaunch jq" {
    split_case_118
}

@test "a prelaunch key spelled with a JSON unicode escape still runs its commands" {
    split_case_119
}

@test "a literal prelaunch key runs its commands" {
    split_case_120
}

@test "no prelaunch key, or the word only inside unrelated values, takes the direct path without jq" {
    split_case_121
}

@test "a precheck false positive still gives the direct call after the jq read" {
    split_case_122
}

@test "an absent or empty prelaunch launches exactly as before: no subshell, no output" {
    split_case_123
}

@test "with prelaunch the agent keeps its parent, exit status and signal status" {
    split_case_124
}

@test "Gemini explicit -m pro preserves Pro High while bare gathers default to Flash High" {
    split_case_125
}

@test "Gemini gatherer agent is selected only for workers when globally installed" {
    split_case_126
}

@test "Gemini missing global gatherer keeps the worker launch with a warning" {
    split_case_127
}

@test "registry CLI persona mapping selects Gemini lead without changing other leads or workers" {
    split_case_128
}

@test "Codex refuses prompted and worker boots without explicit effort" {
    split_case_129
}

@test "Codex accepts prompted boots with flag or environment effort" {
    split_case_130
}

@test "Codex help ignores invalid environment effort and explicit flag wins" {
    split_case_131
}

@test "Codex resume ignores ambient effort and keeps rollout high" {
    split_case_132
}

@test "Codex continue ignores ambient effort and keeps rollout high" {
    split_case_133
}

@test "bare Codex ignores valid and invalid ambient effort" {
    split_case_134
}

@test "prompted Codex refuses invalid ambient effort before launch" {
    split_case_135
}


@test "every guarded Codex launch shape disables computer-use, browser and computer-history" {
    split_case_136
}

@test "Codex app-driver overrides survive a caller-supplied --profile" {
    split_case_137
}

@test "GOLEM_CODEX_COMPUTER_USE=1 keeps app drivers on a bare interactive Codex launch (no args, TTY, no agent markers)" {
    split_case_138
}

@test "GOLEM_CODEX_COMPUTER_USE=1 is ignored with one stderr line on every launch with launcher args, incl. cmuxlayer spawn argv" {
    split_case_139
}

@test "only GOLEM_CODEX_COMPUTER_USE=1 opens the Codex app-driver hatch" {
    split_case_140
}

@test "a zero-arg Codex launch with an agent marker or no TTY keeps app drivers off" {
    split_case_141
}

@test "a caller -c/--config that re-enables a Codex app driver is refused" {
    split_case_142
}

@test "a Codex worker launch carries the app-driver overrides in a fixed order" {
    split_case_143
}
