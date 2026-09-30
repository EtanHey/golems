// Deliberately recognize two complete shell shapes, not arbitrary shell code.
// Whole-command matching prevents a harmless watch fragment from excusing a
// second poller, write, network command, shell expansion, or agent launch.
const gap = String.raw`\s*`;
const sep = String.raw`\s*[;\n]\s*`;
const file = String.raw`f=(?:[\w~./-]+|"[\w~./ -]+"|'[\w~./ -]+')`;
const deadline = String.raw`end=\$\(\(\s*\$\(date \+%s\)\s*\+\s*\d+\s*\)\)`;
const condition = String.raw`(?:true|\[\s*"?\$\(date \+%s\)"?\s+-lt\s+"?\$end"?\s*\])`;
const start = `${file}${sep}(?:${deadline}${sep})?while\\s+${condition}${sep}do\\s+sleep\\s+\\d+${sep}`;
const finish = `${sep}done${gap};?${gap}`;
// Fixed-pattern grep/rg file tests; double-quoted patterns cannot contain shell
// substitutions or expansions. File selection is the same literal $f binding.
const pattern = String.raw`(?:'[^-'\n][^'\n]*'|"[^-"\n\x24\x60\\][^"\n\x24\x60\\]*")`;
const eventTest = String.raw`(?:grep|rg)\s+-q\s+${pattern}\s+"\$f"(?:\s*>\s*/dev/null)?`;
const simple = new RegExp(`^${gap}${start}if\\s+${eventTest}${sep}then\\s+(?:exit\\s+0|break)${sep}fi${finish}$`);
const awkMatch = String.raw`!?/[^/'\n]+/`;
const headerFilter = String.raw`/\^### /(?:\s*&&\s*${awkMatch})*\s*\{print(?:\s+substr\(\$0,\d+,\d+\))?\}`;
// Orc's canonical line-count watch: read only the newly appended lines, match
// a collab header, and exit only when that match produced a nonempty hit.
const counted = new RegExp(
  `^${gap}${file}${sep}n=\\$\\(wc -l < "\\$f"\\)${sep}` +
  `(?:${deadline}${sep})?while\\s+${condition}${sep}do\\s+sleep\\s+\\d+${sep}` +
  `m=\\$\\(wc -l < "\\$f"\\)${sep}` +
  `if \\[ "\\$m" -gt "\\$n" \\]${sep}then\\s+` +
  `hit=\\$\\(sed -n "\\$\\(\\(n\\+1\\)\\),\\$\\{m\\}p" "\\$f" \\| ` +
  `awk '${headerFilter}'\\)${sep}` +
  `if \\[ -n "\\$hit" \\]${sep}then\\s+echo "\\$hit"${sep}` +
  `(?:exit\\s+0|break)${sep}fi${sep}fi${sep}n=\\$m${finish}$`,
);

export function isReadOnlyEventWatch(input) {
  const command = input?.command;
  return input?.run_in_background === true && typeof command === "string" &&
    command.length <= 8192 && (simple.test(command) || counted.test(command));
}
