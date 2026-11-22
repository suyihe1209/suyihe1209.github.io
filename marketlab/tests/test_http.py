"""Local HTTP integration tests. These do not contact external providers."""
import http.client
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from test_ai import server


class PreviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.httpd = server.ThreadingHTTPServer(("127.0.0.1",0),server.Handler)
        cls.httpd.cache_path = Path(cls.temp.name) / "cache.sqlite3"
        cls.httpd.snapshot_dir = server.MODULE / "data"
        cls.httpd.snapshot_id = "test-preview"
        cls.port = cls.httpd.server_port
        cls.origin = f"http://127.0.0.1:{cls.port}"
        cls.thread = threading.Thread(target=cls.httpd.serve_forever,daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def request(self,method,path,body=None,headers=None):
        conn = http.client.HTTPConnection("127.0.0.1",self.port,timeout=5)
        try:
            conn.request(method,path,body,headers or {})
            response = conn.getresponse()
            return response.status, response.read()
        finally:
            conn.close()

    def test_static_and_metadata(self):
        code, text = self.request("GET","/index.html")
        self.assertEqual(code,200)
        self.assertIn(b"marketlab/index.html",text)
        for path in ["/.git/HEAD","/marketlab/server.py","/api/missing"]:
            self.assertEqual(self.request("GET",path)[0],404)
        self.assertEqual(self.request("GET","/index.html",headers={"Host":"outside.invalid"})[0],403)

    def test_no_configuration(self):
        with patch.dict(os.environ,{"MARKETLAB_AI_KEY":"","MARKETLAB_AI_MODEL":""}):
            status, body = self.request("GET","/api/marketlab/status")
            self.assertEqual(status,200)
            self.assertEqual(json.loads(body),{"service":"marketlab","snapshotId":"test-preview","configured":False})
            headers = {"Content-Type":"application/json","Origin":self.origin}
            with patch.object(server,"request_model",side_effect=AssertionError):
                status, body = self.request("POST","/api/marketlab/analyze",'{"marketId":"test","cutoff":"2024-03-01"}',headers)
                self.assertEqual(status,503)
                self.assertEqual(json.loads(body)["error"],"AI 服务未配置")

    def test_origin_content_type_and_size(self):
        url="/api/marketlab/analyze"
        self.assertEqual(self.request("POST",url,"{}",{"Origin":"https://external.invalid","Content-Type":"application/json"})[0],403)
        self.assertEqual(self.request("POST",url,"{}",{"Origin":self.origin,"Content-Type":"text/plain"})[0],415)
        self.assertEqual(self.request("POST",url,"x"*2050,{"Origin":self.origin,"Content-Type":"application/json"})[0],413)
