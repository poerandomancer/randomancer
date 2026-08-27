import importlib.util
import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "data/helperScripts"))
SPEC = importlib.util.spec_from_file_location(
    "enrich_passives", ROOT / "data/helperScripts/enrich_passives.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PassiveLocalityTest(unittest.TestCase):
    def test_live_classes_have_valid_starts(self):
        core = json.loads((ROOT / "data/core-data.json").read_text())
        self.assertEqual(set(core["Classes"]), {
            "Warrior", "Mercenary", "Ranger", "Huntress",
            "Witch", "Sorceress", "Monk", "Druid",
        })
        self.assertTrue(all(
            row["passiveTreeStart"] in MODULE.PASSIVE_TREE_STARTS
            for row in core["Classes"].values()
        ))

    def test_connections_are_undirected_and_invalid_nodes_do_not_route(self):
        rows = [
            {"PassiveSkillGraphId": 1, "SkillType": 0, "Ascendancy": None},
            {"PassiveSkillGraphId": 2, "SkillType": 0, "Ascendancy": None},
            {"PassiveSkillGraphId": 3, "SkillType": 0, "Ascendancy": None, "IsAnointmentOnly": True},
            {"PassiveSkillGraphId": 4, "SkillType": 0, "Ascendancy": None},
            {"PassiveSkillGraphId": 5, "SkillType": 0, "Ascendancy": None, "MasteryGroup": 7},
        ]
        tree = {"groups": [{"passives": [
            {"hash": 1, "connections": [2]},
            {"hash": 2, "connections": [3]},
            {"hash": 3, "connections": [4]},
        ]}]}
        graph = MODULE.build_passive_tree_adjacency(tree, rows)
        self.assertIn(1, graph[2])
        self.assertNotIn(3, graph)
        self.assertNotIn(5, graph)
        self.assertNotIn(4, MODULE.shortest_path_distances(graph, 1))

    def test_third_distance_cutoff_preserves_ties(self):
        distances = {
            "dex": {9: 12}, "dex_int": {9: 13}, "str_dex": {9: 15},
            "int": {9: 15}, "str": {9: 21}, "str_int": {9: 24},
        }
        self.assertEqual(
            MODULE.closest_passive_tree_starts(distances, 9),
            ["dex", "dex_int", "int", "str_dex"],
        )

    def test_generated_ordinary_notables_have_locality_or_are_reported(self):
        enriched = json.loads((ROOT / "data/enriched/passives_enriched.json").read_text())
        report = json.loads((ROOT / "data/enriched/passive_scrape_report.json").read_text())
        reported = {row["id"] for row in report["ordinaryNotablesMissingFromGraph"]}
        for node in enriched["nodes"]:
            if node["type"] == "notable":
                self.assertTrue(node.get("passiveTreeStarts") or node["id"] in reported, node["name"])
                self.assertLessEqual(len(node.get("passiveTreeStarts", [])), 6)


if __name__ == "__main__":
    unittest.main()
