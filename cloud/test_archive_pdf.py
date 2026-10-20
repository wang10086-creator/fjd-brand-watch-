"""Regression of the retired interface: even old callers cannot create new files."""
import importlib.util,pathlib,unittest,subprocess,sys,json
spec=importlib.util.spec_from_file_location('archive_pdf',pathlib.Path(__file__).with_name('archive-pdf.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class RetiredPDFTests(unittest.TestCase):
    def test_programmatic_renderer_is_disabled(self):self.assertIsNone(m.render({'text':'Public content '*100}))
    def test_cli_does_not_generate_pdf_even_with_sufficient_body(self):
        r=subprocess.run([sys.executable,str(pathlib.Path(m.__file__))],input=json.dumps([{'text':'Public content '*100}]),text=True,capture_output=True,check=True)
        self.assertEqual(json.loads(r.stdout),[])
    def test_worker_contains_no_browser_print_or_pdf_dependencies(self):
        source=pathlib.Path(m.__file__).read_text();self.assertNotIn('playwright',source);self.assertNotIn('.pdf(',source)
