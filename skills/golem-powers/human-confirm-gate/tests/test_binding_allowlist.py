"""Binding opt-in contract; all command names/arguments are synthetic data."""
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'skills/golem-powers/human-confirm-gate/hooks'))
import forwarding
from commands import shell as shell_parse, syntax, operations
import shlex
UNKNOWN_BODIES=(
 'builtin shift; "$@"', 'command shift; $@', 'eval shift; "$@"',
 'x=shift; $x; "$@"', 'alias s=shift\ns; "$@"',
 'builtin set -- $(cat fixture); "$@"', 'x=set; $x -- $(cat fixture); "$@"',
 '"${@:-1}"', '${@-1}', '${@:=value}', '${@?missing}', '${@+value}',
 '${@#prefix}', '${@%suffix}', '${@/a/b}', '${@^}', '${@,}', '${@@Q}',
 '${@: -1}', '${@:$OFFSET}', '${1:1}', '${1:0:3}', '${*:1}',
 '$argv', '"${argv[@]}"', '$@[1,-1]', '${=1}', '${(z)1}', '$~1', '$=1',
 'IFS=_; "$@"', 'read IFS; "$@"', 'getopts x y; "$@"',
 'declare x=1; "$@"', 'typeset x=1; "$@"', 'local x=1; "$@"',
 'export IFS=_; "$@"', 'printf -v IFS _; "$@"', 'for IFS in _; do $1; done',
 'exec "$@"', 'source fixture; "$@"', '. fixture; "$@"',
 'timeout 1 "$@"', 'echo shift; "$@"',
)
class BindingAllowlist(unittest.TestCase):pass
def make_unknown(body):
 def test(self):
  self.assertEqual(forwarding.bind(body,['fixture-tool','test'],shell_parse),body,
                   'unproved body must preserve base inspection input')
  self.assertFalse(forwarding.command_allowed('bash -c '+shlex.quote(body)+' _ fixture-tool test',shell_parse,syntax))
 return test
for i,body in enumerate(UNKNOWN_BODIES):setattr(BindingAllowlist,'test_unknown_'+str(i),make_unknown(body))
ALLOWED_BODIES=('$1', '${1}', '$9', '${10}', '$@', '"$@"', '${@}', '"${@}"',
                '$*', '${*}', '"$*"', '"${*}"', '${@:0}', '${@:1:2}', 'echo "$@"')
def make_allowed(body):
 def test(self):
  self.assertTrue(forwarding.code_allowed(body,shell_parse))
  self.assertTrue(forwarding.command_allowed('bash -c '+shlex.quote(body)+' _ fixture-tool test',shell_parse,syntax))
 return test
for i,body in enumerate(ALLOWED_BODIES):setattr(BindingAllowlist,'test_allowed_'+str(i),make_allowed(body))
def make_options(options):
 def test(self):
  self.assertFalse(forwarding.command_allowed('bash '+options+' '+shlex.quote('"$@"')+' _ fixture-tool test',shell_parse,syntax))
 return test
for i,options in enumerate(('-ec','--posix -c','-c -o pipefail','-c -e')):setattr(BindingAllowlist,'test_options_'+str(i),make_options(options))
def legacy_process_view(self):
 token=forwarding._mode.set(False)
 try:
  words,flags,segs,scopes=shell_parse._parse_bash('fixture-tool <(printf data)')
  args,redirects=syntax.argv_at(words,segs,scopes,0)
  self.assertEqual(redirects,[('<','(')])
  self.assertNotIn('${process-substitution}',args)
 finally:forwarding._mode.reset(token)
BindingAllowlist.test_legacy_process_view=legacy_process_view

def legacy_shell_options(self):
 token=forwarding._mode.set(False)
 try:self.assertEqual(syntax.shell_payload('bash',['-c','-o','pipefail','fixture data']),'-o')
 finally:forwarding._mode.reset(token)
BindingAllowlist.test_legacy_shell_options=legacy_shell_options

def context_reset(self):
 self.assertIsNone(forwarding._mode.get())
 self.assertFalse(operations('bash -c '+shlex.quote('"$@"')+' _ fixture-tool test',str(ROOT),alias_lookup=lambda *_:None))
 self.assertIsNone(forwarding._mode.get())
 self.assertFalse(shell_parse._impl_module('tokens')._preserve_empty_words.get())
BindingAllowlist.test_context_reset=context_reset

if __name__=='__main__':unittest.main()
