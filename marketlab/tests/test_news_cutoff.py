"""An announcement after a market close only becomes usable on a later session."""
import unittest
from test_ai import server


class NewsCutoff(unittest.TestCase):
    def test_archived_fomc_decision(self):
        book = server.policy_news()
        for market in ({"id":"TWSE:006207","timezone":"Asia/Taipei"},
                       {"id":"CSI:000300","timezone":"Asia/Shanghai"}):
            previous = server.known_news(market, "2024-09-18", book)
            available = server.known_news(market, "2024-09-19", book)
            self.assertFalse(any("4.75%–5%" in n["summary"] for n in previous))
            self.assertEqual(available[0]["tone"], "偏松")
            self.assertTrue("4.75%" in available[0]["summary"])
            self.assertNotEqual(previous[0]["summary"],available[0]["summary"])
            self.assertEqual(available[0]["ageDays"],0)
            self.assertEqual(server.known_news(market, "2022-01-05", book),[])


    def test_november_2026_minutes_on_actual_market_clocks(self):
        book = server.policy_news()
        self.assertEqual(len({n["id"] for n in book}), len(book))
        minutes = [n for n in book if n["id"] == "FOMC:MINUTES:20261118"]
        self.assertEqual(len(minutes), 1)
        for identifier in ("SP:SPX", "NASDAQ:IXIC"):
            market = {"id": identifier, "timezone": "America/New_York"}
            self.assertEqual(server.known_news(market, "2026-11-17", minutes), [])
            self.assertEqual(server.known_news(market, "2026-11-18", minutes)[0]["tone"], "会议纪要")
        market = {"id": "CSI:000300", "timezone": "Asia/Shanghai"}
        self.assertEqual(server.known_news(market, "2026-11-18", minutes), [])
