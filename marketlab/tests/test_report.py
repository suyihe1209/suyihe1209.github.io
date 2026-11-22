"""Report editorial selection tests. No credentials, network or paid service."""
from io import BytesIO
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
from test_ai import server


class ReportTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.db = Path(folder.name) / "cache.sqlite3"
        self.cfg = ("unused-test-key", "test-model", "https://model.example.invalid/v1")
        self.payload = {"title":"回合总结","facts":[{"id":"F1","text":"本金 1000 TWD"},{"id":"F2","text":"成交 1 笔"}],
                        "risks":[{"id":"R1","text":"样本量为一个回合。"}]}
        self.selected = {"summaryIds":["F2","F1"],"riskIds":["R1"]}

    def test_report_input_limits(self):
        self.assertEqual(server.normalize_report(self.payload),self.payload)
        for changes in [{"title":""},{"title":"x"*181},{"facts":[]},{"facts":self.payload["facts"]*2},
                        {"risks":[{"id":":","text":"x"*801}]},{"facts":[{"id":"x/y","text":"ok"}]},
                        {"risks":[{"id":str(i),"text":"x"} for i in range(21)]},{"url":"https://example.invalid"}]:
            with self.subTest(changes=changes),self.assertRaises(server.ApiError):
                server.normalize_report(dict(self.payload,**changes))

    def test_model_cannot_return_prose_or_out_of_scope_references(self):
        self.assertEqual(server.check_report_ids(self.selected,self.payload),self.selected)
        for changes in [{"summaryIds":["X"]},{"riskIds":["F1"]},{"riskIds":[]},{"summaryIds":[]},
                        {"summaryIds":["F1","F1"]},{"summaryIds":[{}]},{"conclusion":"invented"}]:
            with self.subTest(changes=changes),self.assertRaises(ValueError):
                server.check_report_ids(dict(self.selected,**changes),self.payload)
        self.assertEqual(server.check_report_ids({"summaryIds":["F1"],"riskIds":[]},dict(self.payload,risks=[]))["riskIds"],[])

    def test_missing_key_does_not_call_provider(self):
        mock = MagicMock(side_effect=AssertionError("unexpected external call"))
        with self.assertRaisesRegex(server.ApiError,"未配置"):
            server.compile_report(self.payload,("",self.cfg[1],self.cfg[2]),self.db,mock)
        mock.assert_not_called()

    def test_shared_budget_cache_and_response_shape(self):
        with patch.object(server.http.client,"HTTPSConnection") as connection:
            response=connection.return_value.getresponse.return_value
            response.status=200
            response.read.return_value=json.dumps({"model":"model-actual","choices":[{"message":{"content":json.dumps(self.selected)}}]}).encode()
            result=server.compile_report(self.payload,self.cfg,self.db,now=lambda:200.)
            self.assertEqual(set(result),{"summaryIds","riskIds","model","version","generatedAt"})
            self.assertEqual(result["version"],"model-actual")
            self.assertEqual(result["summaryIds"],["F2","F1"])
            self.assertEqual(server.compile_report(self.payload,self.cfg,self.db,now=lambda:201.),result)
            self.assertEqual(connection.call_count,1)
            report_prompt=json.loads(connection.return_value.request.call_args.kwargs["body"])
            self.assertEqual(json.loads(report_prompt["messages"][1]["content"]),self.payload)
            target={"market":{"id":"m"},"bars":[{"date":f"2024-03-{day:02}","close":10} for day in range(1,25)]}
            with self.assertRaises(server.ApiError) as limited:
                server.analyze(target,{"marketId":"m","cutoff":"2024-03-24"},self.cfg,self.db,now=lambda:202.)
            self.assertEqual(limited.exception.status,429)
            response.read.return_value=json.dumps({"model":"model-actual","choices":[{"message":{"content":'{"summaryIds":["X"],"riskIds":[]}'}}]}).encode()
            with self.assertRaises(server.ApiError) as bad:
                server.compile_report(dict(self.payload,title="新一轮"),self.cfg,self.db,now=lambda:206.)
            self.assertEqual(bad.exception.status,502)

    def handle(self, raw):
        class Socket:
            def makefile(self, mode, *args):return BytesIO(raw)
            def sendall(self, part):self.out.write(part)
        sock=Socket();sock.out=BytesIO()
        service=SimpleNamespace(server_port=8765,cache_path=self.db,snapshot_dir=server.MODULE/"data",snapshot_id="testing")
        with patch.object(server.Handler,"log_message",lambda *args:None):
            server.Handler(sock,("127.0.0.1",31234),service)
        return sock.out.getvalue()

    def test_http_report_and_markdown(self):
        def post(body):
            raw=(b"POST /api/marketlab/report HTTP/1.0\r\nHost: localhost:8765\r\nOrigin: http://localhost:8765\r\nContent-Type: application/json\r\nContent-Length: "
                 +str(len(body)).encode()+b"\r\n\r\n"+body)
            return self.handle(raw)
        with patch.object(server,"settings",return_value=("","","https://example.invalid")),patch.object(server.http.client,"HTTPSConnection") as external:
            self.assertIn(b" 503 ",post(json.dumps(self.payload).encode()).splitlines()[0])
            self.assertIn(b" 413 ",post(b"x"*65537).splitlines()[0])
            external.assert_not_called()
        response=self.handle(b"GET /marketlab/README.md HTTP/1.0\r\nHost: localhost:8765\r\n\r\n")
        self.assertIn(b" 200 ",response.splitlines()[0]);self.assertIn(b"text/plain; charset=utf-8",response)
        self.assertIn("金融市场实验室".encode(),response)
