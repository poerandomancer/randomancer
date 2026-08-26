import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "data" / "helperScripts"))

from lib.recommendation_semantics import (  # noqa: E402
    fact_matches,
    parse_evidence,
    semantic_completeness_warnings,
)


class AilmentApplicationGrammarTests(unittest.TestCase):
    def assert_capability(self, text, mechanic, relation=None):
        facts = parse_evidence("skill_description", text, "skill")
        self.assertTrue(any(
            f.get("mechanic") == mechanic
            and f.get("relation") in ({relation} if relation else {"inflicts", "provides"})
            for f in facts
        ), facts)

    def test_generalized_positive_forms(self):
        cases = [
            ("Enemies Hit by this Skill are inflicted with Bleeding.", "bleed"),
            ("Inflicts Bleeding on Hit.", "bleed"),
            ("Poisons enemies.", "poison"),
            ("Poisons enemies as though Hitting them.", "poison"),
            ("The cloud Poisons enemies.", "poison"),
            ("Electrocuting enemies caught inside.", "electrocute"),
            ("Lightning Damage contributes to Electrocution Buildup.", "electrocute"),
            ("Causes Lightning Hits to contribute to Electrocution Buildup.", "electrocute"),
        ]
        for text, mechanic in cases:
            with self.subTest(text=text):
                self.assert_capability(text, mechanic)

    def test_affinity_and_context_are_not_capability(self):
        cases = [
            "50% increased Bleeding Magnitude.", "100% more Poison Duration.",
            "50% increased chance to Shock.", "Consumes Shock.",
            "Deals more damage to Poisoned enemies.", "Spreads Freeze from Frozen enemies.",
            "Maximum 6 Poison Clouds.", "Enemies have reduced Electrocution Threshold.",
            "Conjures spirits from Shocked enemies.",
        ]
        for text in cases:
            facts = parse_evidence("skill_description", text, "skill")
            self.assertFalse(any(f.get("relation") in {"inflicts", "provides"} and f.get("mechanic") in {
                "bleed", "poison", "shock", "freeze", "electrocute"
            } for f in facts), (text, facts))

    def test_structured_application_stats(self):
        for stat, mechanic in [
            ("global_bleed_on_hit", "bleed"),
            ("display_skill_poisons_without_hit", "poison"),
            ("base_lightning_damage_can_electrocute", "electrocute"),
        ]:
            facts = parse_evidence("stat_id", stat, "skill")
            self.assertTrue(any(f.get("mechanic") == mechanic and f.get("relation") in {"inflicts", "provides"} for f in facts), facts)
        consumed = parse_evidence("stat_id", "base_consume_enemy_shock_on_hit", "skill")
        self.assertFalse(any(f.get("relation") == "inflicts" and f.get("mechanic") == "shock" for f in consumed), consumed)

    def test_completeness_warning_is_conservative_and_deterministic(self):
        sources = [{"kind": "description", "component": "Poison Cloud", "value": "Poisons enemies."}]
        expected = semantic_completeness_warnings(entity_id="skill:test", sources=sources, facts=[])
        self.assertEqual(expected, semantic_completeness_warnings(entity_id="skill:test", sources=sources, facts=[]))
        self.assertEqual(expected[0]["category"], "COMPONENT_APPLICATION_NOT_PROMOTED")
        fact = parse_evidence("description", "Poisons enemies.", "skill")
        self.assertEqual([], semantic_completeness_warnings(entity_id="skill:test", sources=sources, facts=fact))
        for text in ("100% more Poison Duration.", "Deals more damage to Poisoned enemies.", "Cannot Poison enemies."):
            self.assertEqual([], semantic_completeness_warnings(
                entity_id="skill:test", sources=[{"kind": "description", "value": text}], facts=[]
            ))


class GeneratedComponentPromotionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import sys
        helpers = Path(__file__).parents[1] / "data/helperScripts"
        sys.path.insert(0, str(helpers))
        from generate_recommendation_catalog_v3 import SourceContext, build_catalog, compact_catalog
        full, _, _, _ = build_catalog(SourceContext(Path(__file__).parents[1]))
        runtime = compact_catalog(full)
        cls.full = full
        cls.runtime = runtime
        cls.by_name = {entity.get("name"): entity for entity in full["entities"]}

    def capability(self, name, mechanic):
        return [fact for fact in self.by_name[name]["facts"] if fact.get("mechanic") == mechanic and fact.get("relation") in {"inflicts", "provides"}]

    def test_cloud_wall_and_structured_stat_promote_to_parent(self):
        gas = self.capability("Gas Arrow", "poison")
        barrier = self.capability("Voltaic Barrier", "electrocute")
        bleed = self.capability("Exsanguinate", "bleed")
        self.assertEqual(1, len(gas), gas)
        self.assertEqual(2, len(barrier), barrier)
        self.assertEqual(1, len(bleed), bleed)
        self.assertTrue(any(e.get("component") == "Gas Arrow" for e in gas[0]["evidence"]))
        self.assertTrue(any(
            e.get("component", "").startswith("statset:")
            for fact in barrier for e in fact["evidence"]
        ))
        self.assertTrue(any(e.get("kind") == "stat_id" for e in bleed[0]["evidence"]))
        for fact in gas + barrier + bleed:
            self.assertTrue(all(e.get("parent_entity_id") for e in fact["evidence"]))
        semantic_keys = [(fact["relation"], fact.get("mechanic"), fact.get("subject"), fact.get("scope")) for fact in gas + barrier + bleed]
        self.assertEqual(len(semantic_keys), len(set(semantic_keys)))

    def test_runtime_projection_preserves_normalized_semantics(self):
        semantic = lambda catalog: [(entity["id"], [{k: v for k, v in fact.items() if k != "evidence"} for fact in entity.get("facts") or []]) for entity in catalog["entities"]]
        self.assertEqual(semantic(self.full), semantic(self.runtime))
        self.assertEqual(2964, len(self.runtime["entities"]))
        self.assertEqual(5128, sum(len(entity.get("facts") or []) for entity in self.runtime["entities"]))
        for entity in self.runtime["entities"]:
            for fact in entity.get("facts") or []:
                self.assertTrue(all(set(proof) <= {"kind", "value"} for proof in fact["evidence"]))

    def test_non_applicators_stay_excluded(self):
        self.assertFalse(self.capability("Shockchain Arrow", "shock"))
        self.assertFalse(self.capability("Primal Strikes", "shock"))
        self.assertFalse(self.capability("Acidic Concoction", "poison"))
        self.assertTrue(self.capability("Poisonburst Arrow", "poison"))
        self.assertTrue(self.capability("Electrocuting Arrow", "electrocute"))


if __name__ == "__main__":
    unittest.main()
