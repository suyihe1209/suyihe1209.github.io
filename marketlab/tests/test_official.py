"""Local formal-round tests. Uses a separate temporary SQLite database and a controlled server clock."""
import concurrent.futures
import copy
import datetime as dt
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from test_ai import server

o = server.official
tz = o.CHINA


def when(s):
    return dt.datetime.fromisoformat(s).replace(tzinfo=tz)


def fixture(days, imported_at):
    return {"market":{"id":o.MARKET,"timezone":"Asia/Shanghai"}, "horizon":5,
            "source":{"name":"fixture","url":"https://example.invalid","license":"local educational test","sha256":"a"*64,
                      "originalSha256":"b"*64,"asOf":days[-1],"updatedAt":imported_at.isoformat(),"demo":True},
            "experiment":{"modelVersion":"model-original","snapshotSha256":"c"*64},
            "bars":[{"date":day,"close":100+i} for i,day in enumerate(days)],
            "forecasts":[{"date":days[-1],"baseline":.4,"logistic":.6,"trainCount":80,"trainEnd":"2023-12-20"}]}


class FormalRoundTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.db = Path(folder.name) / "official.sqlite3"
        self.today = when("2024-01-04T15:10")
        self.days=["2024-01-04","2024-01-05","2024-01-08","2024-01-09","2024-01-10","2024-01-11"]
        self.data=fixture(self.days[:1],when("2024-01-04T15:02"))
        self.params={"marketId":o.MARKET,"cutoff":self.days[0],"probability":1,"reason":"test","confirmedReal":True}
        self.clock=lambda:self.today

    def test_window_uses_exchange_time_and_external_provenance(self):
        gate=lambda t:o.eligibility(self.data,True,when(t))["eligible"]
        self.assertFalse(gate("2024-01-04T14:59"))
        self.assertTrue(gate("2024-01-04T15:10"))
        self.assertTrue(gate("2024-01-05T09:14:59"))
        self.assertFalse(gate("2024-01-05T09:15"))
        self.assertFalse(gate("2026-09-01T15:10"))
        self.assertFalse(o.eligibility(self.data,False,self.today)["eligible"])
        weekly=fixture(["2024-01-06"],when("2024-01-06T15:01"))
        self.assertFalse(o.eligibility(weekly,True,when("2024-01-06T15:02"))["eligible"])
        bad=copy.deepcopy(self.data);bad["source"].pop("originalSha256")
        self.assertFalse(o.eligibility(bad,True,self.today)["eligible"])
        bad=copy.deepcopy(self.data);bad["market"]["id"]="TWSE:006207"
        self.assertFalse(o.eligibility(bad,True,self.today)["eligible"])

    def test_single_server_receipt_and_rejected_client_fields(self):
        for changes in [{"probability":True},{"probability":1.2},{"probability":float("nan")},{"confirmedReal":False},
                        {"reason":"x"*801},{"submittedAt":"2024-01-01"},{"cutoff":"2024-01-03"}]:
            with self.subTest(c=list(changes)),self.assertRaises(o.Denied):
                o.submit(self.data,dict(self.params,**changes),True,self.db,self.clock)
        def submit(_):
            try:o.submit(self.data,self.params,True,self.db,self.clock);return 200
            except o.Denied as e:return e.status
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(sorted(pool.map(submit,range(4))),[200,409,409,409])
        self.data["forecasts"][0]["baseline"]=.9
        r=o.state(self.data,True,self.db,self.clock)["records"][0]
        self.assertEqual(r["baseline"],.4);self.assertEqual(r["submittedAt"],self.today.isoformat())
        self.assertIsNone(r["settlement"])

    def test_maturation_fifth_real_row_market_and_time_and_idempotence(self):
        o.submit(self.data,self.params,True,self.db,self.clock)
        future=fixture(self.days,when("2024-01-11T15:02"));future["experiment"]["snapshotSha256"]="d"*64
        for snapshot,external,clock in [(future,False,when("2024-01-12T15:01")),(future,True,when("2024-01-11T14:59"))]:
            self.assertIsNone(o.state(snapshot,external,self.db,lambda:clock)["records"][0]["settlement"])
        revised=copy.deepcopy(future);revised["bars"][0]["close"]=101
        self.assertIsNone(o.state(revised,True,self.db,lambda:when("2024-01-12T12:00"))["records"][0]["settlement"])
        final=o.state(future,True,self.db,lambda:when("2024-01-12T12:00"))
        result=final["records"][0]["settlement"];self.assertEqual(result["date"],"2024-01-11")
        self.assertEqual(result["days"],self.days[1:]);self.assertEqual(result["actual"],1)
        self.assertEqual({r["model"]:r["n"] for r in final["ranking"]},{"user":1,"baseline":1,"logistic":1})
        self.assertEqual(final["ranking"][0]["brier"],0)
        future["bars"][-1]["close"]=1
        self.assertEqual(o.state(future,True,self.db,lambda:when("2024-01-15T17:00"))["records"][0]["settlement"],result)

    def test_optional_ai_is_window_bound_and_immutable(self):
        params={"marketId":o.MARKET,"cutoff":"2024-01-04"}
        answer=dict(params,probability=.65,model="testing",version="snapshot",predictedAt=self.today.isoformat())
        with self.assertRaises(o.Denied):o.attach_ai(self.data,params,True,self.db,lambda:answer,self.clock)
        o.submit(self.data,self.params,True,self.db,self.clock)
        with self.assertRaises(o.Denied):
            o.attach_ai(self.data,params,True,self.db,lambda:dict(answer,predictedAt=when("2024-01-04T10:00").isoformat()),self.clock)
        times=iter([when("2024-01-05T09:14:58"),when("2024-01-05T09:15")])
        with self.assertRaises(o.Denied):
            o.attach_ai(self.data,params,True,self.db,lambda:answer,lambda:next(times))
        self.assertEqual(o.attach_ai(self.data,params,True,self.db,lambda:answer,self.clock),answer)
        unused=Mock(side_effect=AssertionError)
        self.assertEqual(o.attach_ai(self.data,params,True,self.db,unused,self.clock),answer)
        unused.assert_not_called()
        final=o.state(fixture(self.days,when("2024-01-11T16:01")),True,self.db,lambda:when("2024-01-12T12:00"))
        self.assertIn("ai",{r["model"] for r in final["ranking"]})

    def test_http_gates_and_signed_round_trip(self):
        from io import BytesIO
        import json
        from types import SimpleNamespace
        from unittest.mock import patch
        folder=self.db.parent/"snapshot"
        folder.mkdir()
        (folder/"market.json").write_text(json.dumps(self.data))
        service=SimpleNamespace(server_port=8765,cache_path=self.db.parent/"ai.sqlite3",snapshot_dir=folder)
        def send(method,path,body=None,same=True):
            payload=json.dumps(body).encode() if body else b""
            origin="http://localhost:8765" if same else "https://remote.invalid"
            raw=(f"{method} {path} HTTP/1.0\r\nHost: localhost:8765\r\nOrigin: {origin}\r\nContent-Type: application/json\r\nContent-Length: {len(payload)}\r\n\r\n").encode()+payload
            class Socket:
                def makefile(self,mode,*args):return BytesIO(raw)
                def sendall(self,b):self.out.write(b)
            sock=Socket();sock.out=BytesIO()
            with patch.object(server.Handler,"log_message",lambda *args:None):
                server.Handler(sock,("127.0.0.1",1234),service)
            head,body=sock.out.getvalue().split(b"\r\n\r\n",1)
            return int(head.splitlines()[0].split()[1]),json.loads(body)
        url="/api/marketlab/official"
        submit,state=o.submit,o.state
        with patch.object(o,"submit",side_effect=lambda *a:submit(*a,clock=self.clock)),patch.object(o,"state",side_effect=lambda *a:state(*a,clock=self.clock)),patch.object(server,"settings",return_value=("","","https://example.invalid")):
            self.assertEqual(send("POST",url,self.params,False)[0],403)
            self.assertEqual(send("GET",url)[1]["records"],[])
            code,receipt=send("POST",url,self.params)
            self.assertEqual(code,200);self.assertEqual(receipt["user"],1)
            self.assertEqual(send("POST",url,self.params)[0],409)
            self.assertEqual(len(send("GET",url)[1]["records"]),1)
