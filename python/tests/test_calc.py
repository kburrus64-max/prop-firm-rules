"""Run: python -m unittest discover -s python/tests   (no dependencies). Expectations mirror js/test/calc.test.mjs."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import prop_firm_rules as pfr  # noqa: E402

R = pfr.load_rules()
P = lambda i: pfr.get_program(i, R)  # noqa: E731


class Calc(unittest.TestCase):
    def test_ftmo_2step(self):
        r = pfr.evaluate(P("ftmo_2step"), 100000, current_balance=102000, current_equity=102000)
        self.assertAlmostEqual(r["daily"]["floor"], 97000)
        self.assertAlmostEqual(r["drawdown"]["floor"], 90000)
        self.assertEqual(r["status"], pfr.GREEN)

    def test_ftmo_1step_trailing_eod(self):
        r = pfr.evaluate(P("ftmo_1step"), 100000, current_balance=103000, current_equity=103000, high_water_mark=104000)
        self.assertAlmostEqual(r["drawdown"]["floor"], 94000)

    def test_max_of_balance_and_equity(self):
        kw = dict(current_balance=105000, current_equity=107000, day_start_balance=105000, day_start_equity=107000)
        expected = {"ftmo_2step": 100000, "fundednext_stellar_2step": 100000, "the5ers_high_stakes": 101650,
                    "fundingpips_2step_5": 101650, "alpha_pro_10": 99750, "blue_guardian_2step": 103000}
        for pid, floor in expected.items():
            self.assertAlmostEqual(pfr.evaluate(P(pid), 100000, **kw)["daily"]["floor"], floor, msg=pid)

    def test_e8_dynamic_locks_at_initial(self):
        r = pfr.evaluate(P("e8_one"), 100000, current_balance=99000, current_equity=99000, high_water_mark=102000)
        self.assertAlmostEqual(r["drawdown"]["floor"], 96000)
        r = pfr.evaluate(P("e8_one"), 100000, current_balance=107000, current_equity=107000, high_water_mark=107000)
        self.assertAlmostEqual(r["drawdown"]["floor"], 100000)

    def test_topstep_mll(self):
        r = pfr.evaluate(P("topstep_combine"), 50000, high_water_mark=50500, stop_distance=10, value_per_unit=50,
                         lot_step=1, buffer_pct=10)
        self.assertIsNone(r["daily"])
        self.assertAlmostEqual(r["drawdown"]["floor"], 48500)
        self.assertEqual(r["maxLots"], 2)
        r = pfr.evaluate(P("topstep_combine"), 50000, current_balance=53000, current_equity=53000, high_water_mark=53000)
        self.assertAlmostEqual(r["drawdown"]["floor"], 50000)

    def test_apex(self):
        r = pfr.evaluate(P("apex_intraday_eval"), 50000, current_balance=50000, current_equity=50900, today_pnl=900)
        self.assertAlmostEqual(r["drawdown"]["floor"], 48900)
        r = pfr.evaluate(P("apex_eod_eval"), 50000, current_balance=49700, current_equity=49700, today_pnl=-300)
        self.assertAlmostEqual(r["daily"]["room"], 700)
        self.assertEqual(r["daily"]["kind"], "pause")
        self.assertAlmostEqual(r["drawdown"]["floor"], 48000)

    def test_max_lots_and_classify(self):
        self.assertEqual(pfr.max_lots(2000, 20, 10), 10)
        self.assertEqual(pfr.max_lots(1234, 15, 10), 8.22)
        self.assertEqual(pfr.max_lots(500, 10, 10, buffer_amount=600), 0)
        self.assertIsNone(pfr.max_lots(700, 0, 50))
        self.assertEqual(pfr.classify(2500, 5000), pfr.AMBER)
        self.assertEqual(pfr.classify(1000, 5000), pfr.RED)

    def test_dataset_integrity(self):
        for p in pfr.list_programs(R):
            self.assertTrue(p["sources"] and all(s.startswith("https://") for s in p["sources"]), p["id"])
            self.assertRegex(p["lastVerified"], r"^\d{4}-\d{2}-\d{2}$")
            for s in p["sizes"]:
                r = pfr.evaluate(p, s)
                self.assertGreater(r["drawdown"]["room"], 0, p["id"])

    def test_check_helper(self):
        self.assertAlmostEqual(pfr.check("ftmo_2step", R, size=100000)["daily"]["floor"], 95000)
        with self.assertRaises(KeyError):
            pfr.check("nope", R, size=1)


if __name__ == "__main__":
    unittest.main()
