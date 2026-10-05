from test_gate import Gate
from test_commands import ROOT
import json


class Surfaces(Gate):
    def test_r1_policy_surface(self):
        for command in ['echo fake >> ~/.config/golems/human-confirm.allowed_signers',
                        'echo fake | tee -a "$HOME/.config/golems/human-confirm.allowed_signers"',
                        'cp fake ~/.config/golems/human-confirm.allowed_signers',
                        'rm ~/.config/golems/human-confirm/*.spent',
                        'export ROOT=~/.config/golems; rm "$ROOT/human-confirm/a.spent"']:
            with self.subTest(command=command): self.assertEqual(self.run_hook(command)[0], 2)
        self.assertEqual(self.run_hook('P=~/.config/golems/human-confirm.allowed_signers; echo fake | tee "$P"')[0], 2)
        for command in ['timeout 30 rm ~/.config/golems/human-confirm/*.spent',
                        'watch -d rm ~/.config/golems/human-confirm/*.spent',
                        "watch -d 'rm ~/.config/golems/human-confirm/*.spent'",
                        'find . -exec rm ~/.config/golems/human-confirm/*.spent \\;']:
            with self.subTest(command=command): self.assertEqual(self.run_hook(command)[0], 2)
        self.assertEqual(self.run_hook('cat ~/.config/golems/human-confirm.allowed_signers')[0], 0)
        for tool in ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']:
            key = 'notebook_path' if tool == 'NotebookEdit' else 'file_path'
            self.assertEqual(self.run_hook(tool=tool, tool_input={key: str(self.home / '.CONFIG/Golems/fake')})[0], 2)
        self.assertEqual(self.run_hook(tool='Monitor', tool_input={'command': 'git push -f origin topic'})[0], 2)
        self.assertEqual(self.run_hook('cd "$UNKNOWN"; git push -f origin topic')[0], 2)

    def test_manifest_covers_alternate_surfaces(self):
        manifest = json.loads((ROOT.parents[2] / 'scripts/hooks/manifest.json').read_text())
        for entries in manifest['hosts'].values():
            entry = next(h for h in entries if h['id'] == 'human-confirm-gate')
            self.assertEqual(set(entry['matcher'].split('|')), {'Bash', 'Monitor', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'})
