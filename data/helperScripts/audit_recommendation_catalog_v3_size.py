#!/usr/bin/env python3
"""Measure the full and runtime recommendation catalogs from generated JSON."""
from __future__ import annotations
import argparse, gzip, json
from collections import Counter
from pathlib import Path
from typing import Any

ROOT=Path(__file__).resolve().parents[2]

def encoded(value: Any) -> int:
    return len(json.dumps(value,ensure_ascii=False,separators=(',',':')).encode())

def compressed(raw: bytes) -> dict[str, int|None]:
    result={"raw_bytes":len(raw),"gzip_bytes":len(gzip.compress(raw,compresslevel=9)),"brotli_bytes":None}
    try:
        import brotli # type: ignore
        result["brotli_bytes"]=len(brotli.compress(raw,quality=11))
    except ImportError: pass
    return result

def classify(entity: dict[str,Any]) -> dict[str,int]:
    facts=entity.get('facts') or []
    source=entity.get('source_evidence') or {}; prov=entity.get('provenance') or {}
    identity={k:entity[k] for k in ('id','content_type','source_id','name','candidate_roles','retrieval_terms','support_family') if k in entity}
    evidence=[proof for fact in facts for proof in fact.get('evidence') or []]
    bare=[{k:v for k,v in fact.items() if k!='evidence'} for fact in facts]
    component=[{k:p[k] for k in ('parent_entity_id','component','pattern_category') if k in p} for p in evidence]
    structured={k:v for k,v in source.items() if k in ('stats','explicit_mods','implicit_mods','granted_effects')}
    descriptions={k:v for k,v in source.items() if k in ('description','lines')}
    return {
      'entity_identity_roles_tags':encoded(identity),'compatibility_access_metadata':encoded(entity.get('compatibility') or {}),
      'semantic_facts_excluding_evidence':encoded(bare),'semantic_evidence_arrays':encoded(evidence),
      'raw_intermediate_source_evidence':encoded(source),'descriptions':encoded(descriptions),
      'component_provenance':encoded(component),'entity_provenance':encoded(prov),
      'structured_stat_provenance':encoded(structured),
      'repeated_object_metadata':encoded(entity.get('links') or {})+encoded(entity.get('semantic_completeness_warnings') or []),
    }

def analyze(path: Path) -> dict[str,Any]:
    raw=path.read_bytes(); payload=json.loads(raw); entities=payload['entities']; categories=Counter()
    snippets=[]; evidence_count=0; arrays=[]
    for e in entities:
      categories.update(classify(e)); ev=sum(len(f.get('evidence') or []) for f in e.get('facts') or []); evidence_count+=ev
      arrays.append((ev,e['id']))
      for f in e.get('facts') or []:
       for proof in f.get('evidence') or []:
        value=proof.get('value');
        if isinstance(value,str): snippets.append(value)
    counts=Counter(snippets)
    largest=sorted(((encoded(e),e['id'],len(e.get('facts') or [])) for e in entities),reverse=True)[:10]
    repeats=sorted(((len(s.encode())*(n-1),n,s[:120]) for s,n in counts.items() if n>1),reverse=True)[:10]
    facts=sum(len(e.get('facts') or []) for e in entities)
    return {**compressed(raw),'entity_count':len(entities),'semantic_fact_count':facts,'evidence_record_count':evidence_count,
      'average_fact_bytes':round(sum(encoded(f) for e in entities for f in e.get('facts') or [])/facts,2),
      'source_snippets':{'occurrences':len(snippets),'unique':len(counts),'repeated_occurrences':len(snippets)-len(counts)},
      'approximate_category_bytes':dict(categories),'largest_entities':[{'bytes':b,'id':i,'facts':f} for b,i,f in largest],
      'largest_evidence_arrays':[{'records':n,'id':i} for n,i in sorted(arrays,reverse=True)[:10]],
      'largest_repeated_strings':[{'duplicate_bytes':b,'occurrences':n,'sample':s} for b,n,s in repeats]}

def main():
 p=argparse.ArgumentParser();p.add_argument('--before',required=True);p.add_argument('--after',default='data/enriched/recommendation_catalog_v3.json');p.add_argument('--out',default='data/enriched/recommendation_catalog_v3_size_audit.json');a=p.parse_args()
 before=analyze(Path(a.before));after=analyze(ROOT/a.after)
 out={'schema_version':'recommendation-catalog-v3-size-audit.1.0.0','before':before,'after':after,
 'reduction':{'raw_bytes':before['raw_bytes']-after['raw_bytes'],'percent':round(100*(before['raw_bytes']-after['raw_bytes'])/before['raw_bytes'],2)},
 'runtime_field_classification':{
  'RUNTIME_REQUIRED':['identity/name/roles/retrieval_terms/support_family','compatibility','typed semantic fact fields','evidence.kind/value','source_evidence.description/active_skill_types/cannot_be_supported','provenance.source_tags'],
  'GENERATION_REQUIRED':['component/stat-set/parser provenance','complete source evidence','semantic completeness warnings'],
  'DIAGNOSTIC_ONLY':['entity dataset/schema provenance','evidence parent/component/pattern_category','structured raw stats','passive lines','unique modifiers/source metadata','taxonomy metadata','full granted effects','links'],
  'REDUNDANT':['evidence.parent_entity_id'], 'UNKNOWN':[]}}
 Path(a.out).write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n')
main()
