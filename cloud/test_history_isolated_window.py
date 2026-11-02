import hashlib,unittest
from history_isolated_window import validate_scope,raw_gate,rendered_text_gate
URL='https://example.com/item'
SCOPE={'historyId':'20261102-999','recordId':'recFixture999','sourceId':'lead-'+hashlib.sha256(URL.encode()).hexdigest()}
class IsolatedWindowTests(unittest.TestCase):
    def test_exact_tuple_and_source_only(self):
        self.assertEqual(validate_scope({'url':URL,'scope':SCOPE},[SCOPE]),SCOPE)
        for request in [{'url':URL+'/new','scope':SCOPE},{'url':URL,'scope':dict(SCOPE,recordId='recOther')},{'url':URL,'scope':dict(SCOPE,extra=True)}]:
            with self.assertRaisesRegex(ValueError,'recovery-scope-unconfirmed'):validate_scope(request,[SCOPE])
    def test_only_public_html_shell_may_defer_content_gate(self):
        raw_gate(URL,[{'url':URL}],{'status':200,'headers':{'content-type':'text/html'}},b'<script>render()</script>')
        for status,kind,body,final in [(403,'text/html',b'',URL),(200,'application/json',b'{}',URL),(200,'text/html',b'<title>Just a moment</title>',URL),(200,'text/html',b'<title>Log in</title>',URL),(200,'text/html',b'',URL+'/new')]:
            with self.assertRaises(ValueError):raw_gate(URL,[{'url':final}],{'status':status,'headers':{'content-type':kind}},body)
    def test_rendered_shell_challenge_login_and_noarchive_rejected(self):
        rendered_text_gate('Product details','Public product specification and seller information. '*5,URL)
        for title,text in [('Product','short'),('Just a moment','Verify you are human. '*20),('Product','Log in to continue. '*20),('Product','noarchive '+'public product '*20)]:
            with self.assertRaises(ValueError):rendered_text_gate(title,text,URL)
