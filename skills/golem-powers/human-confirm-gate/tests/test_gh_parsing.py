"""R2 N2/N3: `gh api` argv read with gh's own (pflag) rules, endpoints as gh requests them,
and GraphQL mutations denied unless they are routine review/comment traffic."""
import unittest
from test_commands import ROOT  # noqa: F401  (puts hooks/ on sys.path)
from test_false_positives import decide


def parsed(argv):
    from gh_policy import parse_api
    try:
        return parse_api(argv)
    except ValueError as exc:
        return 'refused: ' + str(exc)


class ApiArgv(unittest.TestCase):
    def test_short_flag_clusters_take_the_rest_or_the_next_word(self):
        from gh_policy import parse_api
        for argv, method in [(['-iX', 'DELETE', 'repos/o/r'], 'DELETE'), (['-iXDELETE', 'repos/o/r'], 'DELETE'),
                             (['-X=PATCH', 'repos/o/r'], 'PATCH'), (['--method=put', 'repos/o/r'], 'put'),
                             (['--method', 'POST', 'repos/o/r'], 'POST'), (['repos/o/r'], None)]:
            with self.subTest(argv=argv):
                self.assertEqual(parsed(argv)[:2], (method, ['repos/o/r']))
        self.assertEqual(parse_api(['-Fprivate=true', 'repos/o/r'])[2], [(True, 'private=true')])
        self.assertEqual(parse_api(['-if', 'body=x', 'repos/o/r'])[2], [(False, 'body=x')])
        self.assertEqual(parse_api(['repos/o/r', '--input', '-'])[3], '-')
        self.assertEqual(parse_api(['--', '-weird'])[1], ['-weird'])
        for argv in [['--bogus', 'repos/o/r'], ['-Z', 'repos/o/r'], ['repos/o/r', '-X'], ['-i']]:
            with self.subTest(argv=argv), self.assertRaises(ValueError):
                parse_api(argv)

    def test_clustered_methods_reach_the_settings_check(self):
        for command in ['gh api -iX DELETE repos/o/r', 'gh api -iXPATCH repos/o/r -F private=true',
                        'gh api -H "X-HTTP-Method-Override: DELETE" -X POST repos/o/r/git/refs/heads/topic']:
            with self.subTest(command=command):
                self.assertEqual(decide(command), 'deny')
        self.assertEqual(decide('gh api -iX GET repos/o/r'), 'allow')
        self.assertEqual(decide('gh api -X POST repos/o/r/git/refs -f ref=refs/heads/topic -f sha=1'), 'allow')

    def test_substitution_closer_ends_argv(self):
        for command in ['v=$(git push origin topic)', 'v=$(gh api -X POST repos/o/r/pulls/1/comments -f body=x)']:
            with self.subTest(command=command):
                self.assertEqual(decide(command), 'allow')

    def test_split_endpoint_denies_only_when_it_could_write(self):
        self.assertEqual(decide('gh api repos/o/r/pulls extra'), 'allow')
        self.assertEqual(decide('gh api -X POST repos/o/r/pulls extra'), 'deny')


class Endpoints(unittest.TestCase):
    def test_query_and_fragment_are_not_the_route(self):
        from gh_policy import endpoint_path
        self.assertEqual(endpoint_path('repos/o/r/branches/main/protection?x=1'), 'repos/o/r/branches/main/protection')
        self.assertEqual(endpoint_path('repos/o/r/transfer#x'), 'repos/o/r/transfer')
        self.assertEqual(endpoint_path('https://api.github.com/repos/o/r?x=1'), 'repos/o/r')
        for command in ["gh api -X DELETE 'repos/o/r/branches/main/protection?x=1'",
                        "gh api -X PUT 'repos/o/r/actions/permissions#x'"]:
            with self.subTest(command=command):
                self.assertEqual(decide(command), 'deny')

    def test_dot_segments_and_unknown_hosts_deny(self):
        from gh_policy import endpoint_path
        for value in ['repos/o/r/pulls/../hooks', 'repos/o/r/./hooks', 'repos/o/r/pulls/%2e%2e/keys',
                      'https://other.localhost/repos/o/r', 'https:///repos/o/r']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                endpoint_path(value)


class GraphQL(unittest.TestCase):
    def test_mutation_fields_read_the_top_level_selection(self):
        from gh_policy import mutation_fields
        self.assertEqual(mutation_fields('mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{id}}}'),
                         ['resolveReviewThread'])
        self.assertEqual(mutation_fields('mutation M { a: addComment(input:{body:"mutation{deleteRef}"}) { x } }'),
                         ['addComment'])
        self.assertEqual(mutation_fields('mutation @d { updateRefs(input:{}) { x } }'), ['updateRefs'])
        self.assertEqual(mutation_fields('query{viewer{login}} mutation{addReaction(input:{}){x} deleteRef(input:{}){x}}'),
                         ['addReaction', 'deleteRef'])
        self.assertEqual(mutation_fields('{repository(owner:"o",name:"r"){id}}'), [])
        for document in ['mutation{...F} fragment F on Mutation{x}', 'mutation{ ... on Mutation {x} }', 'mutation{a(']:
            with self.subTest(document=document):
                self.assertIsNone(mutation_fields(document))

    def test_mutations_deny_unless_routine_review_traffic(self):
        self.assertEqual(decide("gh api graphql -f query='mutation{addComment(input:{subjectId:1,body:2}){clientMutationId}}'"), 'allow')
        for command in ["gh api graphql -f query='mutation{updateRefs(input:{repositoryId:1,refUpdates:[]}){clientMutationId}}'",
                        "gh api graphql -f query='mutation{updateRepositoryWebCommitSignoffSetting(input:{}){clientMutationId}}'",
                        "gh api graphql -f query='mutation{createRef(input:{}){clientMutationId}}'",
                        "gh api graphql -f query='mutation{...F} fragment F on Mutation{addComment(input:{}){x}}'"]:
            with self.subTest(command=command):
                self.assertEqual(decide(command), 'deny')

    def test_documents_read_from_files_are_opaque(self):
        for command in ['gh api graphql -F query=@mutation.graphql', 'gh api graphql -F query=@-',
                        'gh api graphql -Fquery=@q.graphql', 'gh api graphql --field=query=@q.graphql',
                        'gh api graphql --input body.json']:
            with self.subTest(command=command):
                self.assertEqual(decide(command), 'deny')
        # -f sends the literal text "@x"; typed variables from files are values, not the document
        self.assertEqual(decide('gh api graphql -f query=@x'), 'allow')
        self.assertEqual(decide("gh api graphql -f query='query($b:String!){viewer{login}}' -F b=@body.md"), 'allow')


if __name__ == '__main__':
    unittest.main()
