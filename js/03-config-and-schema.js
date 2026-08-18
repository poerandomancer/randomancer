import { Selectors, firstText } from './01-meta-and-domready.js';

// ===== Schema guard =====
const Schema = (() => {
  function okKeys(obj, keys){ return obj && typeof obj === 'object' && keys.every(k => Object.prototype.hasOwnProperty.call(obj, k)); }
  function validateData(data){
    const requiredTop = ["Version","Classes","Weapons","Defense","Ailments","Tactics","DefensiveStrategies"];
    const topOk = okKeys(data, requiredTop);
    return { ok: !!topOk, missing: topOk ? [] : requiredTop.filter(k => !(k in (data||{}))) };
  }
  return { validateData };
})();

export { Schema, Config, RulesEngine };

// ===== Config =====
const Config = (() => {
  const defaults = Object.freeze({
    synergy: {
      tacticsWeight: 1.0,
      ailmentsWeight: 1.0,
      attributesWeight: 1.0,
      normalization: "legacy",
      useNewScorer: true, // enabled by default in 0.7.2_beta
    },
    rules: {
      strictEnforcement: true,
      capsAgnostic: true,
      useEnginePostValidator: false,
      enableDeflectionDefenseRule: true,
      deflectionRequiresEvasion: ["Evasion", "Armour & Evasion", "Evasion & Energy Shield"],
      enableMinionsWeaponRule: false,
      minionsRequiresWeapon: ["Sceptre"],
      enableBlockOffhandRule: true,
      blockRequiresOffhand: ["Shield","Buckler"],
      enableOneHandedOffhandCombos: true,
      twoHandedWeapons: ["Bow","Staff","Spear","Two-Handed Axe","Two-Handed Sword","Two-Handed Mace"],
      allowedOffhandsForOneHanded: ["Shield","Buckler"],
      blockedOffhandsForTwoHanded: ["Shield","Buckler"],
    },
  });
  function resolve(data){
    try {
      const fromData = (data && data.Config) ? data.Config : {};
      const merged = JSON.parse(JSON.stringify(defaults));
      if (fromData.synergy) Object.assign(merged.synergy, fromData.synergy);
      if (fromData.rules) Object.assign(merged.rules, fromData.rules);
      return Object.freeze(merged);
    } catch (e) {
      console.warn("[Config.resolve] Using defaults due to error:", e);
      return defaults;
    }
  }
  return { resolve };
})();

// ===== RulesEngine (parity scaffold) =====
const RulesEngine = (() => {
  const lc = (s) => (s||"").toLowerCase();
  function snapshot() {
    
    return {
      defense: firstText(Selectors.defense),
      defstrat: firstText(Selectors.defstrat),
      weapons: firstText(Selectors.weapon),
      offhand: firstText(Selectors.offhands),
      tactics: firstText(Selectors.tactics),
      ailments: firstText(Selectors.ailments)
    };
  }
  function evaluate(cfg, s) {
    const v = [];
    if (cfg.rules.enableDeflectionDefenseRule && lc(s.defstrat)==='deflection'){
      const ok = (cfg.rules.deflectionRequiresEvasion||[]).map(lc).includes(lc(s.defense));
      if (!ok) v.push('Deflection requires evasion-based defense');
    }
    if (cfg.rules.enableMinionsWeaponRule && lc(s.tactics).includes('minions')){
      const ok = (cfg.rules.minionsRequiresWeapon||[]).map(lc).includes(lc(s.weapons));
      if (!ok) v.push('Minions requires Sceptre');
    }
    if (cfg.rules.enableBlockOffhandRule && lc(s.defstrat)==='block'){
      const ok = (cfg.rules.blockRequiresOffhand||[]).map(lc).includes(lc(s.offhand));
      if (!ok) v.push('Block requires Shield/Buckler');
    }
    if (cfg.rules.enableOneHandedOffhandCombos){
      const twoHands = (cfg.rules.twoHandedWeapons||[]).map(lc);
      const is2H = twoHands.includes(lc(s.weapons)) || lc(s.weapons).includes('two-handed');
      const allowed1H = (cfg.rules.allowedOffhandsForOneHanded||[]).map(lc);
      const blocked2H = (cfg.rules.blockedOffhandsForTwoHanded||[]).map(lc);
      if (is2H){
        if (blocked2H.includes(lc(s.offhand))) v.push('Two-handed cannot equip this off-hand');
      } else {
        if (allowed1H.length && !allowed1H.includes(lc(s.offhand))) v.push('One-handed requires allowed off-hand');
      }
    }
    return v;
  }
  function enforce(cfg, maxAttempts=25){
    let i=0;
    while (i<maxAttempts){
      const v = evaluate(cfg, snapshot());
      if (v.length===0) return true;
      i++;
      if (typeof window.rollBuild === 'function') window.rollBuild(window.App?.state?.DATA || window.DATA);
      else { const btn = document.querySelector('#roll'); if (btn) btn.click(); }
    }
    console.warn('[RulesEngine.enforce] attempts exhausted');
    return false;
  }
  return { snapshot, evaluate, enforce };
})();

// ===== App API =====
