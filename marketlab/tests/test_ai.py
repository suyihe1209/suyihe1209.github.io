"""Offline tests. The model provider is injected and never contacts a real account."""
from datetime import date, timedelta
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location("marketlab_server", Path(__file__).resolve().parents[1] / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class AnalystTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.db = Path(self.folder.name) / "test.sqlite3"
        days = [(date(2022, 1, 1) + timedelta(days=i)).isoformat() for i in range(34)]
        self.data = {"market":{"id":"testing"}, "bars":[{"date": day, "close": i+1} for i, day in enumerate(days)]}
        self.params = {"marketId":"testing", "cutoff": days[-3]}
        self.config = ("test-only", "example-model", "https://example.invalid/v1")
        self.answer = {"probability":0.6, "reasoning":"测试", "bullishFactors":["A"],
                       "bearishFactors":["B"], "uncertainties":["C"]}

    def test_cutoff_excludes_future_and_identity(self):
        result = server.make_summary(self.data, **dict(market_id="testing", cutoff=self.params["cutoff"]))
        self.data["bars"][-1]["close"] = 999999
        self.assertEqual(result, server.make_summary(self.data, "testing", self.params["cutoff"]))
        self.assertNotIn("date", result["bars"][-1])
        self.assertEqual(result["bars"][-1]["close"],32)
        with self.assertRaises(server.ApiError):
            server.make_summary(self.data,"testing","2099-01-01")

    def test_missing_key_fails_without_invocation(self):
        provider = MagicMock(side_effect=AssertionError)
        with self.assertRaisesRegex(server.ApiError, "未配置"):
            server.analyze(self.data,self.params,("", "m","https://example.invalid"),self.db,provider)
        provider.assert_not_called()

    def test_response_contract(self):
        self.assertEqual(server.check_forecast(self.answer),self.answer)
        for bad in [True, float("nan"), 1.1, "0.5", -0.1]:
            with self.assertRaises(ValueError):
                server.check_forecast(dict(self.answer,probability=bad))
        for bad in [[], [34], ["  "], ["ok"]*6]:
            with self.assertRaises(ValueError):
                server.check_forecast(dict(self.answer,bullishFactors=bad))
        with self.assertRaises(ValueError):
            server.check_forecast(dict(self.answer,reasoning=None))

    def test_cache_rate_limit_and_market_validation(self):
        def provider(summary, config):
            return dict(self.answer,model=config[1],version="frozen")
        mock = MagicMock(side_effect=provider)
        first = server.analyze(self.data,self.params,self.config,self.db,mock,now=lambda:100)
        self.assertEqual(first,server.analyze(self.data,self.params,self.config,self.db,mock,now=lambda:101))
        self.assertEqual(mock.call_count,1)
        with self.assertRaises(server.ApiError) as err:
            server.analyze(self.data,dict(self.params,cutoff=self.data["bars"][-4]["date"]),self.config,self.db,mock,now=lambda:101)
        self.assertEqual(err.exception.status,429)
        with self.assertRaises(server.ApiError):
            server.analyze(self.data,dict(self.params,marketId="other"),self.config,self.db,mock)
        with self.assertRaises(server.ApiError):
            server.analyze(self.data,dict(self.params,url="http://other.invalid"),self.config,self.db,mock)

    def test_upstream_errors_and_bad_content_excluded(self):
        with patch.object(server.http.client, "HTTPSConnection") as connection:
            response = connection.return_value.getresponse.return_value
            for status, payload in [(401,b""),(429,b""),(200,b"{}"),(200,b"<html>")]:
                response.status = status
                response.read.return_value = payload
                with self.assertRaises(server.ApiError):
                    server.request_model({}, self.config)
            response.status = 200
            response.read.return_value = server.json.dumps({"model":"model-123","choices":[{"message":{"content":server.json.dumps(self.answer)}}]}).encode()
            self.assertEqual(server.request_model({},self.config)["version"],"model-123")

    def test_no_plaintext_remote_endpoint(self):
        with self.assertRaises(server.ApiError):
            server.safe_endpoint("http://example.invalid/v1")


if __name__=="__main__":
    unittest.main()
