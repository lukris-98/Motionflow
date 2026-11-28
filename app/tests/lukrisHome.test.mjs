import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Minimal localStorage shim for Node unit tests
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => { memStore.set(k, String(v)); },
  removeItem: (k) => { memStore.delete(k); },
  clear: () => { memStore.clear(); }
};

import { CoreEngine, formatDurationCompact, formatResolutionLabel } from '../src/main/assets/www/js/home/coreEngine.js';
import { ProjectManager } from '../src/main/assets/www/js/home/projectManager.js';
import { AssetMetadataManager } from '../src/main/assets/www/js/home/assetMetadataManager.js';

test('Home Screen isolation: no heavy Video/Audio/Rendering engine imports on Home modules', () => {
  const homeDir = path.resolve('app/src/main/assets/www/js/home');
  const forbidden = [
    'audioEngine.js',
    'rendererEngine.js',
    'exportEngine.js',
    'timelineEngine.js',
    'trackerEngine.js',
    'stabilizerEngine.js',
    'bgRemovalEngine.js',
    'colorMatchEngine.js',
    'keyframeEngine.js'
  ];

  const walk = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
  };

  for (const file of walk(homeDir)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const eng of forbidden) {
      assert.ok(!src.includes(eng), `Home file ${file} must not import ${eng}`);
    }
  }
});

test('CoreEngine starts with zero dummy notifications/downloads and manages settings, profile, and formatters', () => {
  memStore.clear();
  localStorage.setItem('lukris_notifications_v1', JSON.stringify([{ id: 'notif_welcome', unread: true }]));
  localStorage.setItem('lukris_downloads_v1', JSON.stringify([{ id: 'dl_cinema_lut', name: 'Dummy' }]));

  const core = new CoreEngine();
  assert.equal(core.notifications.length, 0);
  assert.equal(core.downloads.length, 0);
  assert.equal(core.getUnreadNotificationsCount(), 0);

  assert.equal(core.settings.appearance.theme, 'dark');
  core.updateSettings({ appearance: { theme: 'light', compactSidebar: true }, general: { defaultFps: 60 } });
  assert.equal(core.settings.appearance.theme, 'light');
  assert.equal(core.settings.general.defaultFps, 60);

  core.updateProfile({ name: 'Lukris Editor' });
  assert.equal(core.profile.initials, 'LE');

  assert.equal(formatDurationCompact(75), '01:15');
  assert.equal(formatResolutionLabel(1920, 1080), '1920×1080');
});

test('ProjectManager starts empty with zero dummy projects, purges legacy demos, and supports full CRUD', async () => {
  memStore.clear();
  localStorage.setItem('lukris_projects_meta_v1', JSON.stringify([
    { id: 'old_demo_1', name: 'Neon Cyber Reel 2026' },
    { id: 'old_demo_2', name: 'LUKRIS Demo' }
  ]));

  const pm = new ProjectManager();
  await pm.init();

  const initialCounts = pm.getCounts();
  assert.equal(initialCounts.all, 0);
  assert.equal(initialCounts.favorites, 0);
  assert.equal(initialCounts.trash, 0);

  const created = await pm.createProject({
    name: 'Alpha Commercial',
    projectType: 'video',
    width: 1920,
    height: 1080,
    fps: 60,
    durationSec: 20
  });
  const createdImg = await pm.createProject({
    name: 'Zeta Poster',
    projectType: 'image',
    width: 1080,
    height: 1350,
    fps: 30,
    durationSec: 6
  });
  assert.equal(pm.getCounts().all, 2);

  await pm.renameProject(created.id, 'Alpha Commercial Final');
  assert.equal(pm.getById(created.id).name, 'Alpha Commercial Final');

  const dup = await pm.duplicateProject(created.id);
  assert.ok(dup.name.includes('(Copy)'));
  assert.equal(pm.getCounts().all, 3);

  await pm.toggleFavorite(created.id);
  assert.equal(pm.getById(created.id).favorite, true);

  const imageOnly = pm.queryProjects({ filterType: 'image' });
  assert.equal(imageOnly.length, 1);
  assert.equal(imageOnly[0].id, createdImg.id);

  const sortedByName = pm.queryProjects({ sortBy: 'name' });
  assert.equal(sortedByName[0].name, 'Alpha Commercial Final');

  await pm.moveToTrash(dup.id);
  assert.equal(pm.getCounts().trash, 1);
  assert.equal(pm.getCounts().all, 2);

  await pm.restoreFromTrash(dup.id);
  assert.equal(pm.getCounts().trash, 0);

  await pm.moveToTrash(dup.id);
  await pm.emptyTrash();
  assert.equal(pm.getCounts().trash, 0);
  assert.equal(pm.getCounts().all, 2);
});

test('AssetMetadataManager exposes real catalog counts and lazy-loads previews without dummy items', async () => {
  const am = new AssetMetadataManager();
  const cats = am.getCategoriesSummary();
  assert.equal(cats.length, 8);
  assert.equal(cats.find((c) => c.id === 'music').count, 0);
  assert.equal(cats.find((c) => c.id === 'shapes').count, 4);
  assert.equal(cats.find((c) => c.id === 'fonts').count, 4);
  assert.equal(am.getTemplatesSummary().length, 3);
  assert.equal(am.getAiToolsSummary().length, 6);

  const fx = await am.loadCategoryItems('videoEffects');
  assert.equal(fx.length, 16);
  const sfx = await am.loadCategoryItems('soundEffects');
  assert.equal(sfx.length, 16);
  const music = await am.loadCategoryItems('music');
  assert.deepEqual(music, []);
  const shapes = await am.loadCategoryItems('shapes');
  assert.equal(shapes.length, 4);
});

test('Editor app.js starts with an empty timeline on first open (no LUKRIS Demo seed)', () => {
  const appSrc = fs.readFileSync(path.resolve('app/src/main/assets/www/js/app.js'), 'utf8');
  assert.ok(!appSrc.includes("createEmptyProject('LUKRIS Demo'"));
  assert.ok(!appSrc.includes("bgShape.name = 'Accent Card'"));
  assert.ok(!appSrc.includes("title.name = 'LUKRIS Title'"));
});

test('120 FPS is supported in ProjectManager, ExportEngine, timecode, and UI options', async () => {
  memStore.clear();
  const pm = new ProjectManager();
  await pm.init();
  const proj120 = await pm.createProject({ name: 'ProMotion 120', fps: 120, durationSec: 5 });
  assert.equal(proj120.fps, 120);
  assert.equal(proj120.durationFrames, 600);

  const { ExportEngine } = await import('../src/main/assets/www/js/export/exportEngine.js');
  const exp = new ExportEngine(null, null);
  assert.ok(exp.getBitrateMbps('high', '1080p', 120) > exp.getBitrateMbps('high', '1080p', 60));

  const editorHtml = fs.readFileSync(path.resolve('app/src/main/assets/www/editor.html'), 'utf8');
  const indexHtml = fs.readFileSync(path.resolve('app/src/main/assets/www/index.html'), 'utf8');
  assert.ok(editorHtml.includes('<option value="120">'));
  assert.ok(editorHtml.includes('data-fps-idx="5">120</button>'));
  assert.ok(indexHtml.includes('<option value="120">'));
});

test('Dedicated CreditsPage renders Lukris copyright and is accessible via buttons', async () => {
  const { renderCreditsPage } = await import('../src/main/assets/www/js/home/pages/CreditsPage.js');
  const fakeEl = { innerHTML: '' };
  renderCreditsPage(fakeEl);
  assert.ok(fakeEl.innerHTML.includes('Dibuat oleh Lukris'));
  assert.ok(fakeEl.innerHTML.includes('&copy; 2026 Lukris'));
  assert.ok(fakeEl.innerHTML.includes('data-nav="home"'));

  const sidebarSrc = fs.readFileSync(path.resolve('app/src/main/assets/www/js/home/components/sidebar/Sidebar.js'), 'utf8');
  const headerSrc = fs.readFileSync(path.resolve('app/src/main/assets/www/js/home/components/header/TopHeader.js'), 'utf8');
  const homePageSrc = fs.readFileSync(path.resolve('app/src/main/assets/www/js/home/pages/HomePage.js'), 'utf8');
  const homeModSrc = fs.readFileSync(path.resolve('app/src/main/assets/www/js/home/homeModule.js'), 'utf8');

  assert.ok(sidebarSrc.includes('data-nav="credits"'));
  assert.ok(sidebarSrc.includes('./assets/lukris-logo.png'));
  assert.ok(headerSrc.includes('data-nav="credits"'));
  assert.ok(homePageSrc.includes('data-nav="credits"'));
  assert.ok(homeModSrc.includes("route === 'credits'"));

  const creditsSrc = fs.readFileSync(path.resolve('app/src/main/assets/www/js/home/pages/CreditsPage.js'), 'utf8');
  assert.ok(creditsSrc.includes('./assets/lukris-logo.png'));
  assert.ok(fs.existsSync(path.resolve('app/src/main/assets/www/assets/lukris-logo.png')));
});
