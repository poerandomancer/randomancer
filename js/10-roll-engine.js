import { renderOathAwareText, renderSecondaryWeaponLine, setActiveSkillsTab, setSkillsTabsAvailability } from './01-meta-and-domready.js';
import { renderSummaryFromSnapshot } from './02-summary-view.js';
import { getLockState, syncLockUIFromState } from './00-locks-and-snapshots.js';
import { getBindFatesFromApp } from './04-app-state.js';
import { sample } from './05-tags-and-scorer.js';
import { COHESION_MODES, applyHardRestrictions, buildBuildContext, cohesionThreshold, currentMode, lookupAscendancyIdByName, pickByCohesion, resolveCohesionMode, validOffhands } from './06-cohesion.js';
import { renderPassiveRecommendations, rollRecommendedSkills } from './07-skills-render.js';
import { dataReady, ensureDataPreload } from './08-data-load.js';
import { pickRecommendedAscendancyNodes, pickRecommendedKeystones, pickRecommendedNotables } from '../passivesEngine.js';

// ---------- overlay + ascendancy art ----------
function updateAscArt(asc){
  const el = document.getElementById('asc-art');
  if (!el) return;
  const path = `/images/ascendancies/${asc.toLowerCase().replace(/\s+/g,'-')}.webp`;

  // Avoid redundant work if we're already showing this art
  if (el.dataset.ascPath === path && el.classList.contains('show')) return;
  el.dataset.ascPath = path;

  // Fade out current art
  el.classList.remove('show');

  // Preload the new image before fading it in
  const img = new Image();
  img.onload = () => {
    // If another roll changed the target meanwhile, bail
    if (el.dataset.ascPath !== path) return;
    el.style.setProperty('--asc-img', `url('${path}')`);
    // Next frame, fade in the new art
    requestAnimationFrame(() => {
      el.classList.add('show');
    });
  };
  img.src = path;
}

try { window.rollBuild = rollBuild; } catch {}
const showBindFatesError = (msg) => {
  if (typeof window !== 'undefined' && typeof window.showBindFatesError === 'function') {
    window.showBindFatesError(msg);
  }
};
const AIL_COLORS = {
  ignite:"rgba(255, 80, 0, 0.08)",
  freeze:"rgba(90, 160, 255, 0.08)",
  shock:"rgba(220, 220, 80, 0.07)",
  poison:"rgba(90, 255, 120, 0.08)",
  bleed:"rgba(255, 60, 60, 0.08)"
};
function updateAilmentOverlay(ailments){
  const panel=document.querySelector('.panel'); if(!panel) return;
  const names = (Array.isArray(ailments) ? ailments.map(a => String(a.name||a).toLowerCase()) : []);
  if(names.length===0){
    panel.style.setProperty('--overlay-gradient','linear-gradient(135deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.85) 100%)'); return;
  }
  const c1 = AIL_COLORS[names[0]] || 'rgba(255,255,255,0.0)';
  if(names.length>1){
    const c2 = AIL_COLORS[names[1]] || 'rgba(255,255,255,0.0)';
    panel.style.setProperty('--overlay-gradient', `linear-gradient(135deg, ${c1} 0%, ${c2} 70%, rgba(0,0,0,0.85) 100%)`);
  }else{
    panel.style.setProperty('--overlay-gradient', `linear-gradient(135deg, ${c1} 0%, rgba(0,0,0,0.85) 100%)`);
  }
}


// ---------- dictionary builders (TRUE Map) ----------
function buildGemDictionary(gems){
  const m = new Map();
  const put = (k,v) => {
    if (k == null || v == null) return;
    const key = String(k);
    if (!m.has(key)) m.set(key, v);
  };
  (gems||[]).forEach(g => {
    try{
      // ids
      if (g && typeof g === 'object') {
        put(g.id, g);
        if (g.base_item && typeof g.base_item === 'object') {
          put(g.base_item.id, g);
          const disp = g.base_item.display_name || g.name || g.skill_name || g.support_name;
          if (disp) {
            put(disp, g);
            put(String(disp).toLowerCase(), g);
            put(normalizeTag(disp), g);
          }
        } else {
          const disp = g.name || g.skill_name || g.support_name;
          if (disp) {
            put(disp, g);
            put(String(disp).toLowerCase(), g);
            put(normalizeTag(disp), g);
          }
        }
        // also skill/support name keys
        if (g.skill_name) put(String(g.skill_name).toLowerCase(), g);
        if (g.support_name) put(String(g.support_name).toLowerCase(), g);
      }
    }catch(e){ /* skip malformed */ }
  });
  return m;
}
// Robust resolver for support/active gem references (ids, paths, names, objects)
function lookupGem(dict, raw){
  if (!dict) return null;
  if (raw && typeof raw === 'object') return raw;
  const key = String(raw||'').trim();
  if (!key) return null;
  const lower = key.toLowerCase();
  const normK = normalizeTag(key);
  const last = lower.includes('/') ? lower.split('/').pop() : lower;
  const lastSan = last.replace(/[^a-z0-9]+/g,'');
  const tries = [key, lower, normK, last, lastSan];
  for (const k of tries){
    const g = dict.get && dict.get(k);
    if (g) return g;
  }
  // Fallback scan by normalized display name
  if (dict instanceof Map) {
    for (const [k,g] of dict) {
      const disp = g?.base_item?.display_name || g?.name || g?.skill_name || g?.support_name;
      if (!disp) continue;
      const nd = normalizeTag(disp);
      if (nd === normK || nd === lastSan) return g;
    }
  }
  return null;
}

// ---------- helpers ----------
function dominantAttr(attrs){ const e=Object.entries(attrs||{}).sort((a,b)=>b[1]-a[1]); const k=(e[0]?.[0]||'int'); return {strength:'str',dexterity:'dex',intelligence:'int'}[k]||k.slice(0,3); }
// ===== Build Name Generation (v0.8.2+) =====

// ===== Build Name Generation (v0.8.2+) =====
// New approach:
// - NAME_DESCRIPTORS (x): per-ascendancy adjectives/epithets
// - NAME_TITLES (y): per-ascendancy noun-y titles
// - NAME_TENDENCIES (z): ailment/tactic themed nouns for "of z", "z-bound", etc.
// - NAME_TENDENCY_FORMS: -ing / adjective-friendly forms for "The z-ing y"
const NAME_DESCRIPTORS = {
  // Warrior
  "Titan": ["Titanic","Stonebound","Mountain-Born","Earthshaking","Atlas-Broad","Ironclad"],
  "Warbringer": ["Warworn","Blooded","Banner-Sworn","Battle-Hymned","Drum-Hearted","Iron-Sworn"],
  "Smith of Kitava": ["Forgebound","Cinderhand","Soot-Crowned","Brandmarked","Chain-Forged","Ashen"],

  // Mercenary
  "Tactician": ["Measured","Battlewise","Steel-Sighted","Cold-Calculating","Drill-Hardened","Formation-Born"],
  "Witchhunter": ["Hexbane","Lantern-Lit","Oath-Sworn","Relentless","Ash-Creed","Sanctified"],
  "Gemling Legionnaire": ["Gem-Forged","Faceted","Prism-Blooded","Runed","Crystalline","Lattice-Bound"],

  // Ranger
  "Deadeye": ["Unerring","Hawk-Eyed","Silent","Longshot","Pinpoint","Shadow-Drawn"],
  "Pathfinder": ["Trailwise","Horizon-Bound","Mire-Walking","Thorn-Run","Wayfinding","Wild-Tracked"],

  // Huntress
  "Amazon": ["Bronze-Crowned","Lionhearted","Spear-Blessed","Sunforged","Steel-Sister","Storm-Stride"],
  "Ritualist": ["Circle-Drawn","Bone-Scribed","Masked","Ritebound","Blood-Binding","Totem-Kissed"],

  // Witch
  "Blood Mage": ["Sanguine","Veinbound","Crimson","Hemocrafted","Bloodletter","Thrice-Bled"],
  "Lich": ["Deathless","Sepulchral","Graveborn","Soul-Tethered","Ossuary","Pale"],
  "Infernalist": ["Cinder-Crowned","Furnace-Hearted","Hellbound","Ash-Tongued","Blazing","Coal-Black"],
  "Abyssal Lich": ["Abyss-Touched","Depthborn","Starless","Void-Drinking","Umbral","Blackened"],

  // Sorceress
  "Chronomancer": ["Clockwork","Hourglass-Bound","Fatespun","Moment-Sundered","Echoing","Timeworn"],
  "Stormweaver": ["Storm-Wreathed","Tempest-Lashed","Skybound","Lightning-Kissed","Thunder-Born","Rain-Soaked"],
  "Disciple of Varashta": ["Rune-Taught","Oathbound","Star-Studied","Vigilant","Ward-Scribed","Varashtan"],

  // Monk
  "Invoker": ["Tranquil","Spirit-Forged","Palm-Scribed","Mantra-Bound","Quiet Thunder","Inner-Flamed"],
  "Acolyte of Chayula": ["Shadow-Devout","Void-Kissed","Nightbound","Spiral-Eyed","Breach-Touched","Umbral"],

  // Druid
  "Shaman": ["Spirit-Talked","Ancestor-Blessed","Totem-Bound","Wild-Voiced","Storm-Calling","Groveborn"],
  "Oracle": ["Omen-Touched","Fate-Seen","Star-Read","Vision-Blessed","Augural","Foretold"]
};

const NAME_TITLES = {
  // Warrior
  "Titan": ["Colossus","Vanguard","Juggernaut","Worldshaker","Bastion"],
  "Warbringer": ["War Herald","Harbinger","Bloodcaller","Standard-Bearer","Warchanter"],
  "Smith of Kitava": ["Forgehand","Anvil-Keeper","Brandwright","Cindersmith","Chainforger"],

  // Mercenary
  "Tactician": ["Field Marshal","Commandant","War Planner","Siege Captain","Stratagem"],
  "Witchhunter": ["Inquisitor","Purifier","Hexbreaker","Cinder Judge","Witchhunter"],
  "Gemling Legionnaire": ["Legionnaire","Facet Veteran","Prism Soldier","Jewel Ward","Gemling"],

  // Ranger
  "Deadeye": ["Sharpshooter","Marksman","Sniper","Arrow-Sage","Deadeye"],
  "Pathfinder": ["Wayfinder","Trailseer","Trackmaster","Wildguide","Pathfinder"],

  // Huntress
  "Amazon": ["War-Maiden","Spearqueen","Sunlancer","Shield-Sister","Amazon"],
  "Ritualist": ["Ritecaller","Circleweaver","Bloodbinder","Hex-Dancer","Ritualist"],

  // Witch
  "Blood Mage": ["Hemomancer","Crimson Saint","Veincaller","Red Magus","Blood Savant"],
  "Lich": ["Deathlord","Bone Regent","Tomb-King","Grave Sovereign","Lich"],
  "Infernalist": ["Emberlord","Flame Apostle","Pit-Speaker","Hellwright","Infernalist"],
  "Abyssal Lich": ["Void Regent","Deep Lich","Nether Sovereign","Dreadwight","Abyssal Lich"],

  // Sorceress
  "Chronomancer": ["Timebinder","Hourkeeper","Epoch Sage","Clockwright","Chronomancer"],
  "Stormweaver": ["Tempest","Galeweaver","Skybrand","Thunder-Palm","Stormweaver"],
  "Disciple of Varashta": ["Adept","Disciple","Wardbearer","Oathkeeper","Varashta's Hand"],

  // Monk
  "Invoker": ["Ascetic","Kata-Sage","Temple Adept","Chi Warden","Invoker"],
  "Acolyte of Chayula": ["Void Disciple","Breach Monk","Dark Acolyte","Chayula's Hand","Acolyte"],

  // Druid
  "Shaman": ["Spiritcaller","Totem-Sage","Ancestor Seer","Wildspeaker","Shaman"],
  "Oracle": ["Seer","Augur","Omenweaver","Prophecy-Scribe","Oracle"]
};

// Thematic nouns (z) drawn from ailments/tactics rolled this build.
const NAME_TENDENCIES = {
  // Ailments
  "Freeze": ["Rime","Winter","Frost","Hoarfrost","Ice","Glacier"],
  "Ignite": ["Ember","Cinder","Wildfire","Pyre","Flame","Ash"],
  "Shock": ["Tempest","Storm","Lightning","Thunder","Arc","Static"],
  "Poison": ["Venom","Toxin","Blight","Rot","Nightshade","Viper"],
  "Bleed": ["Hemorrhage","Blood","Rend","Gash","Scar","Sanguine"],

  // Tactics
  "Heavy Stun": ["Concussion","Stagger","Skullcrack","Quake","Sunder","Stun"],
  "Armour Break": ["Fracture","Rendsteel","Shatter","Sundered Plate","Ruin","Crack"],
  "Critical Hit": ["Precision","Execution","Fatal Point","Keen Edge","Perfect Strike","Deadly Aim"],
  "Totems": ["Idols","Effigies","Wards","Pillars","Runes","Totemcraft"],
  "Warcry": ["Battlecry","Roar","Oathcall","War Chant","Howl","Shout"],
  "Marks": ["Brand","Sigil","Lock-On","Hunter's Mark","Aim","Marksmanship"],
  "Curses": ["Hex","Malison","Doom","Bane","Witchsign","Cursecraft"],
  "Minions": ["Thralls","Servitors","Legion","Swarm","Retinue","Gravebound"],
  "Companions": ["Pack","Familiar","Beastbond","Hunt Pack","Allies","Bond"],
  "Thorns": ["Barbs","Spines","Briar","Needles","Thornwall","Razors"],
  "Culling Strike": ["Cull","Last Rites","Final Cut","Reaping","Mercy","Execution"],
  "Slow/Maim/Hinder": ["Maim","Snare","Hamstring","Drag","Quagmire","Hinder"],
  "Chaos Damage": ["Entropy","Ruin","Blight","Abyss","Chaos","Void"]
};

const NAME_TENDENCY_FORMS = {
  // Ailments
  "Freeze": ["Freezing","Frostbitten","Rimebound"],
  "Ignite": ["Burning","Smoldering","Flame-Kissed"],
  "Shock": ["Crackling","Storming","Thunderstruck"],
  "Poison": ["Venomous","Toxic","Blighted"],
  "Bleed": ["Bleeding","Rending","Bloodied"],

  // Tactics
  "Heavy Stun": ["Staggering","Concussive","Skullcracking"],
  "Armour Break": ["Shattering","Rending","Fracturing"],
  "Critical Hit": ["Precise","Lethal","Keen-Edged"],
  "Totems": ["Totemic","Ward-Set","Idolbound"],
  "Warcry": ["Roaring","Howling","Battle-Chanting"],
  "Marks": ["Marked","Locking-On","Branding"],
  "Curses": ["Hexing","Cursing","Doomcalling"],
  "Minions": ["Swarming","Gravecalling","Thrall-Summoning"],
  "Companions": ["Packbound","Beastbonded","Familiar-Led"],
  "Thorns": ["Barbed","Spined","Briar-Clad"],
  "Culling Strike": ["Reaping","Executing","Merciless"],
  "Slow/Maim/Hinder": ["Snaring","Maiming","Hamstringing"],
  "Chaos Damage": ["Entropic","Blighting","Abyss-Touched"]
};

// Optional class seasoning for occasional extra variation
const NAME_CLASS_SPICE = {
  "Warrior": ["Iron","War","Steel","Siege","Valor"],
  "Mercenary": ["Coin","Contract","Black Banner","Gallows","Oath"],
  "Ranger": ["Hunt","Grove","Arrow","Shadow","Trail"],
  "Huntress": ["Moon","Wild","Fang","Thorn","Stag"],
  "Witch": ["Hex","Grave","Blood","Bone","Night"],
  "Sorceress": ["Star","Aether","Storm","Sigil","Glass"],
  "Monk": ["Temple","Palm","Mantra","Kata","Stillness"],
  "Druid": ["Root","Grove","Spirit","Briar","Verdant"]
};

const NAME_GENERIC_DESCRIPTORS = ["Fate-Touched","Oathbound","Doomlit","Wayward","Wandering"];
const NAME_GENERIC_TITLES = ["Wanderer","Outcast","Harbinger","Adept","Revenant"];

function _asHyphen(s){
  return String(s||'').trim().replace(/[^\w]+/g,'-').replace(/-+/g,'-').replace(/(^-|-$)/g,'');
}

function _wordCount(s){
  return String(s || '').trim().split(/\s+/).filter(Boolean).length;
}
function _pickFromPool(pool, maxWords){
  if (!Array.isArray(pool) || !pool.length) return "";
  const short = (typeof maxWords === 'number')
    ? pool.filter(v => _wordCount(v) <= maxWords)
    : pool;
  return sample((short && short.length) ? short : pool);
}
function _nameSetToList(set){
  if (!Array.isArray(set)) return [];
  return set.map(x => (typeof x === 'string' ? x : (x && typeof x === 'object' ? x.name : null))).filter(Boolean);
}
function _pickTendencyKey(ailments, tactics){
  const ail = _nameSetToList(ailments);
  const tac = _nameSetToList(tactics);
  if (!ail.length && !tac.length) return null;
  if (ail.length && tac.length) return (Math.random() < 0.6) ? sample(ail) : sample(tac);
  return ail.length ? sample(ail) : sample(tac);
}

const BUILD_NAME_TEMPLATES = [
  // Keep names punchy + readable (weighted by repetition)
  ({x,y}) => `The ${x} ${y}`,
  ({x,y}) => `The ${x} ${y}`,
  ({x,y}) => `The ${x} ${y}`,

  ({x,y,z}) => `The ${x} ${y} of ${z}`,
  ({y,z}) => `The ${y} of ${z}`,
  ({zForm,y}) => `The ${zForm} ${y}`
];

// New generator (pass ailments/tactics for z)
function generateBuildName(cls, asc, ailments, tactics){
  const descPool = NAME_DESCRIPTORS[asc] || NAME_GENERIC_DESCRIPTORS;
  const titlePool = NAME_TITLES[asc] || NAME_GENERIC_TITLES;
  const cPool = NAME_CLASS_SPICE[cls] || ["Fate"];

  const x = sample(descPool);
  const y = sample(titlePool);

  const tendencyKey = _pickTendencyKey(ailments, tactics);
  const zPool = (tendencyKey && NAME_TENDENCIES[tendencyKey]) ? NAME_TENDENCIES[tendencyKey] : ["Fate"];
  const zFormPool = (tendencyKey && NAME_TENDENCY_FORMS[tendencyKey]) ? NAME_TENDENCY_FORMS[tendencyKey] : ["Fated"];

  const z = _pickFromPool(zPool, 2);
  const zForm = _pickFromPool(zFormPool, 2);
  const zH = _asHyphen(z);
  const c = sample(cPool);

  const history = (typeof window !== 'undefined')
    ? (window.__BUILD_NAME_HISTORY__ || (window.__BUILD_NAME_HISTORY__ = []))
    : [];

  let out = `The ${x} ${y}`;

  for (let i=0; i<16; i++){
    const tpl = sample(BUILD_NAME_TEMPLATES);
    const candidate = tpl({ x, y, z, zH, zForm, c });

    // Keep it from getting too tongue-twistery
    if (!candidate) continue;
    if (_wordCount(candidate) > 7) continue;

    // avoid immediate repeats (within last ~24 names)
    if (!history.includes(candidate)) {
      out = candidate;
      break;
    }
  }

  if (history) {
    history.unshift(out);
    if (history.length > 24) history.length = 24;
  }
  return out;
}

// Flavor lines (still mostly class-driven, but with full class coverage)
const FLAVOR = {
  Warrior:["Born of war, bound by honor.","Strength tempered by flame.","Steel answers steel."],
  Ranger:["Swift as shadow, silent as dusk.","The hunt never ends.","An arrow is a promise."],
  Witch:["Wisdom is a double-edged curse.","Power whispers, and she listens.","A pact is still a blade."],
  Sorceress:["Lightning is a prayer with teeth.","Stars remember those who dare.","Time bends for the bold."],
  Monk:["Every strike, a meditation.","Balance through battle.","Stillness is a weapon."],
  Huntress:["The wild answers in kind.","Footfalls like falling leaves.","Fangs bared to fate."],
  Mercenary:["Gold buys blades, not mercy.","No banner, only resolve.","Contracts are written in scars."],
  Druid:["Roots remember. Storms obey.","The grove speaks; the world listens.","Fate is read in bark and bone."]
};

const FLAVOR_ASC = {
  "Titan":["A mountain with a heartbeat.","Unmoved. Unbroken."],
  "Warbringer":["The drums of war follow close.","A banner is a blade."],
  "Smith of Kitava":["Forge-fire in the veins.","Hammered into legend."],
  "Tactician":["Victory is a calculation.","The battlefield is a board."],
  "Witchhunter":["No hex goes unanswered.","Purity by fire."],
  "Gemling Legionnaire":["Facets catch every fate.","A legion in crystal."],
  "Deadeye":["One shot. One verdict.","Distance is mercy."],
  "Pathfinder":["Every trail has teeth.","The wild is a map of scars."],
  "Amazon":["Steel-sister of the sun.","Spearpoint prophecy."],
  "Ritualist":["Circles close. Blood binds.","Rites carved in night."],
  "Blood Mage":["Crimson is currency.","Life traded for power."],
  "Lich":["Death is a door left open.","A crown of bone and silence."],
  "Infernalist":["Flame speaks first.","Ash writes the epilogue."],
  "Abyssal Lich":["Starless depths answer back.","The void keeps its promises."],
  "Chronomancer":["Seconds are weapons.","Time, broken to purpose."],
  "Stormweaver":["Thunder in the lungs.","The sky is a spellbook."],
  "Disciple of Varashta":["Wards within wards.","Oaths etched in starlight."],
  "Invoker":["Breath, stance, strike.","A mantra with teeth."],
  "Acolyte of Chayula":["The Breach watches.","Shadow is devotion."],
  "Shaman":["Ancestors at your shoulder.","Spirits carry the strike."],
  "Oracle":["Omens do not lie.","The future already blinked."]
};

function generateFlavorLine(cls, asc, ailments, tactics){
  const pool = [];
  if (FLAVOR[cls]) pool.push(...FLAVOR[cls]);
  if (FLAVOR_ASC[asc]) pool.push(...FLAVOR_ASC[asc]);

  // Small chance to echo the rolled mechanics
  const tKey = _pickTendencyKey(ailments, tactics);
  if (tKey && Math.random() < 0.25) {
    pool.push(`Marked by ${tKey}.`);
  }

  if (!pool.length) pool.push("Conjure the impossible. Defy the meta.");
  return sample(pool);
}


function resetSecondaryWeaponSetUI(showButton){

  const weapons2El = document.getElementById('weapons-set2');
  if (weapons2El) {
    weapons2El.textContent = '';
    weapons2El.hidden = true;
  }
  const grid2 = document.getElementById('skills-grid-2');
  if (grid2) grid2.innerHTML = '';
  const btn = document.getElementById('weapon-set2-btn');
  if (btn) {
    btn.textContent = 'Add Weapon Set II';
    btn.hidden = !showButton;
  }
  setSkillsTabsAvailability(false);
  setActiveSkillsTab('1');
}

function resolveCoreData(dataWrap){
  if (dataWrap && dataWrap.core) return dataWrap.core;
  if (dataWrap && dataWrap.Weapons) return dataWrap;
  return window.DATA || {};
}

function rollSecondaryWeaponSet(dataWrap){
  const data = resolveCoreData(dataWrap);
  const current = window.App?.state?.currentRoll || window.CURRENT_ROLL || {};
  if (!data || !current.className || current.weapon2) return null;

  const base = data.Classes?.[current.className]?.attributes || {};
  const th = (typeof cohesionThreshold === 'number')
    ? cohesionThreshold
    : (COHESION_MODES[currentMode] ?? COHESION_MODES.cohesive);

  const bind = getBindFatesFromApp();
  const weaponCfg = bind.weapon || { oaths: [], abominations: [] };
  const combatCfg = bind.combat || { oaths: [], abominations: [] };
  const wOaths = new Set(weaponCfg.oaths || []);
  const wAboms = new Set(weaponCfg.abominations || []);
  const cOaths = new Set(combatCfg.oaths || []);

  const minionsOath = cOaths.has('Minions');
  const sceptreAbomination = wAboms.has('Sceptre');

  if (minionsOath && sceptreAbomination) {
    console.warn('[secondary weapons] Minions oath requires Sceptre, but Sceptre is an abomination.');
    return null;
  }

  const weaponPool = (data.Weapons['Two-Handed'] || []).concat(data.Weapons['One-Handed'] || []);
  let filteredWeaponPool = weaponPool.filter((w) => !wAboms.has(w.name) && w.name !== current.weapon);
  if (wOaths.size > 0) {
    const fromOath = filteredWeaponPool.filter((w) => wOaths.has(w.name));
    if (fromOath.length > 0) filteredWeaponPool = fromOath;
  }

  if (minionsOath) {
    const sceptreOption = filteredWeaponPool.find((w) => w?.name === 'Sceptre');
    if (!sceptreOption) {
      console.warn('[secondary weapons] Minions oath requires a Sceptre, but none are available.');
      return null;
    }
    filteredWeaponPool = [sceptreOption];
  }

  if (!filteredWeaponPool.length) {
    console.warn('[secondary weapons] No valid weapons available for secondary set.');
    return null;
  }

  const weapon = pickByCohesion(filteredWeaponPool, base, th);
  let offhand = null;
  if (weapon && Object.keys(validOffhands).includes(weapon.name)) {
    const offPool = (data.Weapons['Off-Hand'] || []).filter((o) => validOffhands[weapon.name].includes(o.name));
    offhand = pickByCohesion(offPool, base, th);
  }

  return { weapon, offhand, wOaths };
}

async function handleSecondaryWeaponSetSelection(){
  const data = await ensureDataPreload();
  const coreData = resolveCoreData(data);
  const current = window.App?.state?.currentRoll || window.CURRENT_ROLL || {};
  if (!current.weapon || current.weapon2) return;

  const result = rollSecondaryWeaponSet(coreData);
  if (!result) return;

  const { weapon, offhand, wOaths } = result;
  const weaponName = weapon?.name || '';
  let offhandName = offhand?.name || '';
  if (weaponName && /^bow$/i.test(weaponName) && !offhandName) offhandName = 'Quiver';

  renderSecondaryWeaponLine([weaponName, offhandName].filter(Boolean), wOaths);
  const weapons2El = document.getElementById('weapons-set2');
  if (weapons2El) weapons2El.hidden = false;
  const avoidSkills = new Set(
    (current.recommendedSkills || [])
      .map(s => s?.id || s?.name || '')
      .filter(Boolean)
      .map(s => String(s).toLowerCase())
  );

  const skillSnapshot = rollRecommendedSkills(
    coreData,
    coreData.Classes?.[current.className]?.attributes || {},
    { weapon, offhand },
    window.CURRENT_ROLL,
    {
      gridId: 'skills-grid-2',
      includePersistentBuff: false,
      avoidSkills,
      assignTagProfile: false
    }
  ) || {};

  if (window.App && typeof window.App.mergeCurrentRoll === 'function') {
    window.App.mergeCurrentRoll({
      weapon2: weaponName,
      offhand2: offhandName,
      recommendedSkills2: skillSnapshot.skills || []
    });
  }

  if (window.CURRENT_ROLL && typeof window.CURRENT_ROLL === 'object') {
    window.CURRENT_ROLL.weapon2 = weaponName;
    window.CURRENT_ROLL.offhand2 = offhandName;
  }

  const set2Btn = document.getElementById('weapon-set2-btn');
  if (set2Btn) set2Btn.hidden = true;
  setSkillsTabsAvailability(true);
  setActiveSkillsTab('1');
}

function rollBuild(dataWrap){
  // Accept either the { core, gems } wrapper or fall back to global DATA
  let data = null;

  if (dataWrap && typeof dataWrap === 'object' && dataWrap.core) {
    // Canonical path: called from ensureDataPreload() -> { core, gems }
    data = dataWrap.core;
  } else if (typeof window !== 'undefined' && window.DATA) {
    // Fallback: use globally-initialized DATA (set by loadData / App.bootstrap)
    data = window.DATA;
  }

  if (!data) {
    console.error('[rollBuild] No data available for roll');
    return;
  }

  showBindFatesError('');

    const th = (typeof cohesionThreshold === 'number')
    ? cohesionThreshold
    : (COHESION_MODES[currentMode] ?? COHESION_MODES.cohesive);

  const bind = getBindFatesFromApp();

  const classes = Object.entries(data.Classes || {});

  const combatCfg = bind.combat || { oaths: [], abominations: [] };
  const cOaths = new Set(combatCfg.oaths || []);
  const cAboms = new Set(combatCfg.abominations || []);

  // --- Archetype ---
  const ascCfg = bind.ascendancy || { oaths: [], abominations: [] };
  const ascOaths = new Set(ascCfg.oaths || []);
  const ascAboms = new Set(ascCfg.abominations || []);

  const ascCandidates = [];
  for (const [clsName, clsData] of classes) {
    const ascList = Array.isArray(clsData?.ascendancies) ? clsData.ascendancies : [];
    let filtered = ascList.filter((name) => !ascAboms.has(name));
    if (ascOaths.size > 0) {
      filtered = filtered.filter((name) => ascOaths.has(name));
    }

    if (filtered.length > 0) {
      ascCandidates.push({ clsName, clsData, ascList: filtered });
    }
  }

  if (!ascCandidates.length) {
    showBindFatesError('No valid ascendancies with your current Oaths & Abominations.');
    return;
  }

  const pickedAsc = ascCandidates[Math.floor(Math.random() * ascCandidates.length)];
  const clsName = pickedAsc.clsName;
  const clsData = pickedAsc.clsData;
  const base = clsData?.attributes || {};

  const asc = pickedAsc.ascList[Math.floor(Math.random() * pickedAsc.ascList.length)];

  const ascendancyId = lookupAscendancyIdByName(asc);

  const weaponPool = (data.Weapons['Two-Handed'] || []).concat(data.Weapons['One-Handed'] || []);
  const weaponCfg = bind.weapon || { oaths: [], abominations: [] };
  const wOaths = new Set(weaponCfg.oaths || []);
  const wAboms = new Set(weaponCfg.abominations || []);

  const minionsOath = cOaths.has('Minions');
  const sceptreAbomination = wAboms.has('Sceptre');

  if (minionsOath && sceptreAbomination) {
    showBindFatesError('Minions combat mechanic is not a valid Oath while Sceptre is an Abomination.');
    return;
  }

  let filteredWeaponPool = weaponPool.filter((w) => !wAboms.has(w.name));
  if (wOaths.size > 0) {
    const fromOath = filteredWeaponPool.filter((w) => wOaths.has(w.name));
    if (fromOath.length > 0) filteredWeaponPool = fromOath;
  }

  if (minionsOath) {
    const sceptreOption = filteredWeaponPool.find((w) => w?.name === 'Sceptre');
    if (!sceptreOption) {
      showBindFatesError('Minions combat mechanic requires a Sceptre, but no Sceptre is available with your current Oaths & Abominations.');
      return;
    }
    filteredWeaponPool = [sceptreOption];
  }

  if (!filteredWeaponPool.length) {
    showBindFatesError('No valid weapons with your current Oaths & Abominations.');
    return;
  }

  const pickWeapon = () => pickByCohesion(filteredWeaponPool, base, th);
  const weapon = pickWeapon();

  let offhand = null;
  if (weapon && Object.keys(validOffhands).includes(weapon.name)) {
    const offPool = (data.Weapons['Off-Hand'] || []).filter((o) => validOffhands[weapon.name].includes(o.name));
    offhand = pickByCohesion(offPool, base, th);
  }

  // --- Survivability ---
  const pickedDefense = pickByCohesion(data.Defense, base, th);

  const dsPool = data.DefensiveStrategies.filter(ds => applyHardRestrictions(ds, { defense: pickedDefense?.name || '', weapon: weapon?.name || '', offhand: offhand?.name || '' }));
  const pickedDefStrat = pickByCohesion(dsPool, base, th);

  function filterTacticsByStrictRules(allTactics, weapon, offhand){
  const w = String(weapon?.name||'').toLowerCase();
  const o = String(offhand?.name||'').toLowerCase();
  const hasSceptre = (w.includes('sceptre') || o.includes('sceptre'));
  return allTactics.filter(t => {
    const tn = String(t?.name||'').toLowerCase();
    if(tn==='minions' && !hasSceptre) return false;
    return true;
  });
}

// Ailments/Tactics roll (with duplicate prevention + cohesion bias)
  let ailmentSet = [];
  let tacticSet  = [];
  const r = Math.random();

  const allAil = data.Ailments || [];
  const allTac = filterTacticsByStrictRules(data.Tactics || [], weapon, offhand);

  const validAil = allAil.filter((a) => !cAboms.has(a.name));
  const validTac = allTac.filter((t) => !cAboms.has(t.name));

  const mechanics = [
    ...validAil.map((a) => ({ kind: 'ailment', ref: a })),
    ...validTac.map((t) => ({ kind: 'tactic', ref: t }))
  ];

  const pickMechanic = (pool, excludeNames = []) => {
    const filtered = pool.filter((m) => m && !excludeNames.includes(m.ref?.name));
    if (!filtered.length) return null;
    const picked = pickByCohesion(filtered.map((m) => m.ref), base, th) || filtered[Math.floor(Math.random() * filtered.length)].ref;
    return filtered.find((m) => m.ref === picked || m.ref?.name === picked?.name) || filtered[0];
  };

  const oathMech = mechanics.filter((m) => cOaths.has(m.ref?.name));
  const neutralMech = mechanics.filter((m) => !cOaths.has(m.ref?.name));

  const picks = [];

  if (oathMech.length >= 2) {
    const first = pickMechanic(oathMech);
    const second = pickMechanic(oathMech, [first?.ref?.name]);
    picks.push(first, second);
  } else if (oathMech.length === 1) {
    const first = oathMech[0];
    const second = pickMechanic(neutralMech, [first?.ref?.name]);
    if (first) picks.push(first);
    if (second) picks.push(second);
  } else {
    const thLocal = th;
    const pickAilmentFrom = (pool, excludeNames = []) => {
      const filtered = pool.filter(a => a && !excludeNames.includes(a.name));
      if (!filtered.length) return null;
      return (
        pickByCohesion(filtered, base, thLocal) ||
        filtered[Math.floor(Math.random() * filtered.length)]
      );
    };

    const pickTacticFrom = (pool, excludeNames = []) => {
      const filtered = pool.filter(t => t && !excludeNames.includes(t.name));
      if (!filtered.length) return null;
      return (
        pickByCohesion(filtered, base, thLocal) ||
        filtered[Math.floor(Math.random() * filtered.length)]
      );
    };

    if (r < 0.6) {
      const a1 = pickAilmentFrom(validAil);
      const tPool = validTac;
      const t1 = pickTacticFrom(tPool);
      if (a1) picks.push({ kind: 'ailment', ref: a1 });
      if (t1) picks.push({ kind: 'tactic', ref: t1 });
    } else if (r < 0.8) {
      const a1 = pickAilmentFrom(validAil);
      const a2 = a1
        ? pickAilmentFrom(validAil, [a1.name])
        : pickAilmentFrom(validAil);

      if (a1) picks.push({ kind: 'ailment', ref: a1 });
      if (a2) picks.push({ kind: 'ailment', ref: a2 });
    } else {
      const tPool = validTac;
      const t1 = pickTacticFrom(tPool);
      const t2 = t1
        ? pickTacticFrom(tPool, [t1.name])
        : pickTacticFrom(tPool);

      if (t1) picks.push({ kind: 'tactic', ref: t1 });
      if (t2) picks.push({ kind: 'tactic', ref: t2 });
    }
  }

  const cleanPicks = picks.filter(Boolean).slice(0, 2);

  if (cleanPicks.length < 2) {
    showBindFatesError('No valid combat mechanics with your current Oaths & Abominations.');
    return;
  }

  ailmentSet = cleanPicks.filter(m => m.kind === 'ailment').map(m => m.ref);
  tacticSet  = cleanPicks.filter(m => m.kind === 'tactic').map(m => m.ref);

  document.getElementById('class')?.replaceChildren(document.createTextNode(clsName || ''));
  renderOathAwareText(document.getElementById('ascendancy'), asc || '', ascOaths);
  updateAscArt(asc);
  const weaponParts = (() => {
    const wName = weapon?.name || '';
    const oName = offhand?.name || '';
    if (wName && /^bow$/i.test(wName)) return [wName, oName || 'Quiver'];
    return [wName, oName].filter(Boolean);
  })();

  renderOathAwareText(
    document.getElementById('weapons'),
    weaponParts,
    wOaths
  );
  resetSecondaryWeaponSetUI(true);
  document.getElementById('defense')?.replaceChildren(document.createTextNode(pickedDefense?.name || ''));
  document.getElementById('defstrat')?.replaceChildren(document.createTextNode(pickedDefStrat?.name || ''));

  renderOathAwareText(
    document.getElementById('ailments'),
    ailmentSet.filter(Boolean).map(a => a.name),
    cOaths
  );

  renderOathAwareText(
    document.getElementById('tactics'),
    tacticSet.filter(Boolean).map(t => t.name),
    cOaths
  );

  updateAilmentOverlay(ailmentSet.filter(Boolean));



  // Balance aggregation
  const add=(a,b)=>({strength:(a.strength||0)+(b.strength||0), dexterity:(a.dexterity||0)+(b.dexterity||0), intelligence:(a.intelligence||0)+(b.intelligence||0)});
  const norm=(a)=>{ const t=(a.strength||0)+(a.dexterity||0)+(a.intelligence||0)||1e-6; return {strength:(a.strength||0)/t, dexterity:(a.dexterity||0)/t, intelligence:(a.intelligence||0)/t}; };
  const sumParts = [ norm(base), norm(weapon?.attributes||{}), norm(offhand?.attributes||{}), norm(pickedDefense?.attributes||{}), norm(pickedDefStrat?.attributes||{}) ].reduce((acc,a)=>add(acc,a), {strength:0,dexterity:0,intelligence:0});
  const ailAvg = (ailmentSet.filter(Boolean).map(a=>a.attributes||{}).map(norm).reduce((acc,a)=>add(acc,a), {strength:0,dexterity:0,intelligence:0}));
  const tacAvg = (tacticSet.filter(Boolean).map(a=>a.attributes||{}).map(norm).reduce((acc,a)=>add(acc,a), {strength:0,dexterity:0,intelligence:0}));
  const total = {strength: sumParts.strength+ailAvg.strength+tacAvg.strength, dexterity: sumParts.dexterity+ailAvg.dexterity+tacAvg.dexterity, intelligence: sumParts.intelligence+ailAvg.intelligence+tacAvg.intelligence};
  const T = (total.strength+total.dexterity+total.intelligence)||1e-6;
  const S=total.strength/T, D=total.dexterity/T, I=total.intelligence/T;
  const bar=document.getElementById('balance-bar');
  const grad=`linear-gradient(90deg, rgba(176,48,48,1) 0%, rgba(176,48,48,1) ${S*100}%, rgba(45,122,45,1) ${S*100}%, rgba(45,122,45,1) ${(S+D)*100}%, rgba(47,79,157,1) ${(S+D)*100}%, rgba(47,79,157,1) 100%)`;
  bar.style.setProperty('--balance-gradient', grad);
  bar.classList.add('glow');
  document.getElementById('balance-text').textContent = `Strength ${Math.round(S*100)}%  |  Dexterity ${Math.round(D*100)}%  |  Intelligence ${Math.round(I*100)}%`;


  // Build name + flavor (restored)
  const buildName = generateBuildName(clsName, asc, ailmentSet.filter(Boolean), tacticSet.filter(Boolean));
  const buildFlavor = generateFlavorLine(clsName, asc, ailmentSet.filter(Boolean), tacticSet.filter(Boolean));
  document.getElementById('build-name').textContent = buildName;
  document.getElementById('build-subtext').textContent = buildFlavor;
  const cohesionModeName = resolveCohesionMode(window.App?.state?.cohesionMode ?? currentMode);

  const baseSnapshot = {
    snapshotVersion: 1,
    className: clsName,
    ascendancy: asc || '',
    ascendancyName: asc || '',
    ascendancyId: ascendancyId ?? null,
    defense: pickedDefense?.name || '',
    defStrat: pickedDefStrat?.name || '',
    defStratObj: pickedDefStrat || null,
    weapon: weapon?.name || '',
    offhand: offhand?.name || '',
    weapon2: '',
    offhand2: '',
    tactics: tacticSet.filter(Boolean).map(t=>t.name).join(' & '),
    ailments: ailmentSet.filter(Boolean).map(a=>a.name).join(' & '),
    ailmentList: ailmentSet.filter(Boolean).map(a=>a.name),
    tacticList: tacticSet.filter(Boolean).map(t=>t.name),
    tacticSet: tacticSet.filter(Boolean),
    ailmentSet: ailmentSet.filter(Boolean),
    buildName,
    flavor: buildFlavor,
    attributes: { strength: S, dexterity: D, intelligence: I },
    rollAttr: { strength: S, dexterity: D, intelligence: I },
    defenseObj: pickedDefense || null,
    cohesionStatus: 'ok',
    cohesionModeName,
    recommendedSkills2: []
  };

  if (window.App && typeof window.App.mergeCurrentRoll === 'function') {
    window.App.mergeCurrentRoll(baseSnapshot);
  } else if (typeof window !== 'undefined') {
    window.__LAST_ROLL_META = { ...baseSnapshot };
  }


  // Stash the roll context for synergy scorer
  window.CURRENT_ROLL = {
          ascendancy: asc || '',
          ascendancyName: asc || '',
          ascendancyId: ascendancyId ?? null,
          ailmentSet: ailmentSet.filter(Boolean),
          tacticSet: tacticSet.filter(Boolean),
          defense: pickedDefense,
          defStrat: pickedDefStrat,
          weapon: weapon?.name || '',
          offhand: offhand?.name || '',
          weapon2: '',
          offhand2: '',
          rollAttr: { strength: S, dexterity: D, intelligence: I },
          tagProfile: null,
          cohesionModeName
        };

  // Skills (weapon-limited + synergy scoring)
  const skillSnapshot = rollRecommendedSkills(dataWrap, base, {weapon, offhand}, window.CURRENT_ROLL) || {};
  if (window.App && typeof window.App.mergeCurrentRoll === 'function') {
    window.App.mergeCurrentRoll({
      recommendedSkills: skillSnapshot.skills || [],
      recommendedPersistentBuff: skillSnapshot.persistentBuff || null,
      tagProfile: skillSnapshot.tagProfile || window.CURRENT_ROLL.tagProfile || null
    });
  }

  // Passive recommendations (pure, cohesion-aware)
  const passiveCtx = buildBuildContext();
  const passivesData = (dataWrap && dataWrap.passivesEnriched) || (window.DATA && window.DATA.passivesEnriched) || null;
  const passiveIndex = (dataWrap && dataWrap.passiveIndex) || (window.DATA && window.DATA.passiveIndex) || null;
  if (passiveCtx && passivesData && Array.isArray(passivesData.nodes)) {
    const ascendancyNodes = pickRecommendedAscendancyNodes(passivesData, passiveIndex, passiveCtx, 2);
    const keystones = pickRecommendedKeystones(passivesData, passiveIndex, passiveCtx, 2);
    const notables = pickRecommendedNotables(passivesData, passiveIndex, passiveCtx, 8);
    const passiveBundle = { ascendancyNodes, keystones, notables };

    if (window.App && typeof window.App.mergeCurrentRoll === 'function') {
      window.App.mergeCurrentRoll({ passives: passiveBundle });
    }
    if (window.CURRENT_ROLL && typeof window.CURRENT_ROLL === 'object') {
      window.CURRENT_ROLL.passives = passiveBundle;
    }
  }

  renderPassiveRecommendations(window.CURRENT_ROLL, dataWrap);

  // Uniques: trigger the synergy engine directly using the current roll snapshot
  try {
    const locks = getLockState();
    const current = window.App?.state?.currentRoll || window.CURRENT_ROLL || {};

    if (!locks.uniques) {
      if (typeof window.RandomancerRefreshUniques === 'function') {
        window.RandomancerRefreshUniques(window.CURRENT_ROLL);
      }
    } else {
      ensureUniqueSection();
      if (Array.isArray(current.recommendedUniques) && current.recommendedUniques.length && typeof window.RandomancerRenderUniquesFromNames === 'function') {
        window.RandomancerRenderUniquesFromNames(current.recommendedUniques);
      }
    }
  } catch (e) {
    console.warn('[Randomancer] uniques refresh failed', e);
  }

  // Reveal build output panels now that we have a roll
  const appEl = document.getElementById('app');
  if (appEl) appEl.dataset.hasRoll = 'true';

  syncLockUIFromState();

  // Ensure Summary view stays in sync with the latest roll snapshot (covers App.roll capture-phase funnel).
  try {
    const s = (window.App && window.App.state && window.App.state.currentRoll)
      ? window.App.state.currentRoll
      : (window.CURRENT_ROLL || null);
    if (s) renderSummaryFromSnapshot(s);
    // Run once more on next tick to capture late merges (uniques/passives/skills updates)
    setTimeout(() => {
      try {
        const s2 = (window.App && window.App.state && window.App.state.currentRoll)
          ? window.App.state.currentRoll
          : (window.CURRENT_ROLL || null);
        if (s2) renderSummaryFromSnapshot(s2);
      } catch {}
    }, 0);
  } catch {}

}

// ---------- roll button + weapon set wiring ----------
document.addEventListener('DOMContentLoaded', () => {
  const rollBtn = document.getElementById('roll');
  if (rollBtn) {
    const statusEl = rollBtn.querySelector('.roll-status');
    rollBtn.addEventListener('click', async () => {
      // Tiny loading hint if data is still warming up
      rollBtn.classList.add('is-loading');
      if (statusEl && !dataReady) {
        statusEl.textContent = 'Preparing the fates…';
      }

      try {
        const data = await ensureDataPreload();
        rollBuild(data);
        
        const ws2Toggle = document.getElementById('weapon-set2-toggle');
		if (ws2Toggle?.checked) {
		  try {
			await handleSecondaryWeaponSetSelection();
		  } catch (err) {
			console.error('[secondary weapons] roll failed:', err);
		  }
		}

        // Summary view: keep text updated immediately after each roll
        if (window.scheduleSummaryRefresh) window.scheduleSummaryRefresh();

        // Keep Summary view live on each reroll.
        // (This roll pipeline is the primary entrypoint; other roll funnels may not fire listeners.)
        try {
          const snap = (window.App && window.App.state && window.App.state.currentRoll)
            ? { ...window.App.state.currentRoll }
            : null;
          // Run once immediately and once on the next tick to catch any late merges.
          if (snap) renderSummaryFromSnapshot(snap);
          setTimeout(() => {
            try {
              const s2 = (window.App && window.App.state && window.App.state.currentRoll)
                ? { ...window.App.state.currentRoll }
                : null;
              if (s2) renderSummaryFromSnapshot(s2);
              if (typeof window.RandomancerUpdateBuildCodeUI === 'function') {
                window.RandomancerUpdateBuildCodeUI();
              }
            } catch {}
          }, 0);
        } catch {}
      } catch (err) {
        console.error('[Randomancer] roll failed:', err);
        if (statusEl) {
          statusEl.textContent = 'Something went wrong. Try again.';
        }
      } finally {
        // Clear the loading state once data has loaded or failed
        setTimeout(() => {
          rollBtn.classList.remove('is-loading');
          if (statusEl && dataReady) {
            statusEl.textContent = '';
          }
        }, 120);
      }
    });
  }

  const weaponSet2Btn = document.getElementById('weapon-set2-btn');
  if (weaponSet2Btn) {
    weaponSet2Btn.addEventListener('click', () => {
      handleSecondaryWeaponSetSelection().catch(err => {
        console.error('[secondary weapons] roll failed:', err);
      });
    });
  }

  const skillsTabs = document.getElementById('skills-tabs');
  if (skillsTabs) {
    skillsTabs.addEventListener('click', (event) => {
      const btn = event.target.closest('.skills-tab');
      if (!btn || btn.disabled) return;
      setActiveSkillsTab(btn.dataset.skillTab || '1');
    });
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('weapon-set2-toggle');
  if (!toggle) return;

  // Reflect existing roll state (if applicable)
  const current = window.App?.state?.currentRoll;
  if (current?.weapon2) {
    toggle.checked = true;
  }

  // ❌ No behavior on change
  toggle.addEventListener('change', () => {
    // Intentionally empty.
    // Toggle state is read during roll.
  });
});


export {
  handleSecondaryWeaponSetSelection,
  resetSecondaryWeaponSetUI,
  rollBuild,
  updateAilmentOverlay,
  updateAscArt
};
