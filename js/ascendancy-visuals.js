const ASCENDANCY_BASE_CLASSES = Object.freeze({
  'titan': 'warrior', 'warbringer': 'warrior', 'smith-of-kitava': 'warrior',
  'tactician': 'mercenary', 'witchhunter': 'mercenary', 'gemling-legionnaire': 'mercenary',
  'deadeye': 'ranger', 'pathfinder': 'ranger',
  'amazon': 'huntress', 'ritualist': 'huntress', 'spirit-walker': 'huntress',
  'blood-mage': 'witch', 'lich': 'witch', 'infernalist': 'witch', 'abyssal-lich': 'witch',
  'chronomancer': 'sorceress', 'stormweaver': 'sorceress', 'disciple-of-varashta': 'sorceress',
  'invoker': 'monk', 'acolyte-of-chayula': 'monk', 'martial-artist': 'monk',
  'shaman': 'druid', 'oracle': 'druid'
});

const ASCENDANCY_BACKGROUND_PATHS = Object.freeze(Object.fromEntries(
  Object.keys(ASCENDANCY_BASE_CLASSES).map((slug) => [slug, `/images/ascendancies/${slug}-blur.webp`])
));

const CLASS_ICON_PATHS = Object.freeze(Object.fromEntries(
  ['druid', 'huntress', 'mercenary', 'monk', 'ranger', 'sorceress', 'warrior', 'witch']
    .map((classSlug) => [classSlug, `/images/classes/${classSlug}.webp`])
));

function canonicalSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function getAscendancyBackgroundPath(ascendancy) {
  return ASCENDANCY_BACKGROUND_PATHS[canonicalSlug(ascendancy)] || '';
}

function getClassIconPath(className, ascendancy) {
  const classSlug = canonicalSlug(className) || ASCENDANCY_BASE_CLASSES[canonicalSlug(ascendancy)];
  return CLASS_ICON_PATHS[classSlug] || '';
}

let ambianceRequest = 0;
let activeLayer = 0;

function transitionAmbianceBackground(path) {
  const request = ++ambianceRequest;
  const host = document.getElementById('asc-art');
  if (!host) return Promise.resolve(false);
  if (!path) {
    host.classList.remove('show');
    delete host.dataset.ascPath;
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const preload = new Image();
    preload.onload = () => {
      if (request !== ambianceRequest) return resolve(false);
      const layers = host.querySelectorAll('.asc-art__layer');
      const nextLayer = layers[1 - activeLayer];
      const oldLayer = layers[activeLayer];
      if (!nextLayer || !oldLayer) return resolve(false);
      nextLayer.style.setProperty('--asc-layer-img', `url("${path}")`);
      nextLayer.classList.add('is-visible');
      oldLayer.classList.remove('is-visible');
      host.classList.add('show');
      host.dataset.ascPath = path;
      activeLayer = 1 - activeLayer;
      resolve(true);
    };
    preload.onerror = () => {
      if (request === ambianceRequest) host.classList.remove('show');
      resolve(false);
    };
    preload.src = path;
  });
}

function updateAscendancyAmbiance(ascendancy) {
  return transitionAmbianceBackground(getAscendancyBackgroundPath(ascendancy));
}

export {
  ASCENDANCY_BACKGROUND_PATHS,
  ASCENDANCY_BASE_CLASSES,
  CLASS_ICON_PATHS,
  canonicalSlug,
  getAscendancyBackgroundPath,
  getClassIconPath,
  transitionAmbianceBackground,
  updateAscendancyAmbiance
};
