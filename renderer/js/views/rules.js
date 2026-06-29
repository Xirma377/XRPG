import { el, clear, debounce } from '../util.js';
import { icon } from '../icons.js';
import { button, empty, segmented } from '../ui.js';
import { setMarkdown } from '../markdown.js';
import store from '../store.js';
import appState from '../state.js';
import shell from '../shell.js';
import router from '../router.js';
import { buildReferenceIndex, searchReference } from '../rules.js';
import { rollUnderProbability } from '../dice.js';

export async function render() {
  const sys = appState.system;
  shell.crumbs([{ label: 'Rules' }, { label: sys ? sys.name : '—' }]);
  shell.actions([button('Game Systems', { icon: 'layers', size: 'sm', onClick: () => router.go('systems') })]);

  if (!sys) {
    shell.render(el('div.view-pad', [empty('No game system selected', { icon: 'book', hint: 'Add or select a system to see its rules.', action: button('Manage systems', { variant: 'primary', onClick: () => router.go('systems') }) })]));
    return;
  }

  const index = buildReferenceIndex(sys);
  const categories = ['All', ...Array.from(new Set(index.map((i) => i.category)))];
  let activeCat = 'All';
  let query = '';

  const wrap = el('div.view-pad');

  // header
  const head = el('div.section-header');
  const title = el('div.section-title');
  title.appendChild(icon('book', 20));
  title.appendChild(el('h2', sys.name + ' — Rules'));
  head.appendChild(title);
  const searchBox = el('div.search-box');
  searchBox.appendChild(icon('search', 15));
  const sInput = el('input', { placeholder: 'Search rules, tables, monsters…' });
  searchBox.appendChild(sInput);
  head.appendChild(searchBox);
  wrap.appendChild(head);

  // dice summary banner
  if (sys.dice && sys.dice.summary) {
    wrap.appendChild(el('div.notice.mono', sys.dice.summary));
  }

  const layout = el('div.rules-layout', { style: { marginTop: '16px' } });

  // category sidebar
  const catCol = el('div.rules-cats');
  const catNodes = {};
  categories.forEach((cat) => {
    const c = el('div.rules-cat' + (cat === activeCat ? '.active' : ''));
    c.appendChild(el('span', cat));
    const count = cat === 'All' ? index.length : index.filter((i) => i.category === cat).length;
    c.appendChild(el('span.c', String(count)));
    c.addEventListener('click', () => { activeCat = cat; updateCats(); renderArticles(); });
    catNodes[cat] = c;
    catCol.appendChild(c);
  });
  // probability tool entry (roll-under only)
  if (sys.dice && sys.dice.resolution === 'roll-under') {
    const tool = el('div.rules-cat', { style: { marginTop: '14px' } });
    tool.appendChild(icon('target', 14));
    tool.appendChild(el('span', { style: { marginLeft: '6px' } }, 'Probability'));
    tool.addEventListener('click', showProbability);
    catCol.appendChild(tool);
  }
  layout.appendChild(catCol);

  const articleCol = el('div');
  layout.appendChild(articleCol);
  wrap.appendChild(layout);

  function updateCats() {
    for (const [cat, node] of Object.entries(catNodes)) node.classList.toggle('active', cat === activeCat);
  }

  function renderArticles() {
    clear(articleCol);
    let items = query ? searchReference(index, query) : index.slice();
    if (activeCat !== 'All') items = items.filter((i) => i.category === activeCat);

    if (!items.length) {
      articleCol.appendChild(empty('Nothing found', { icon: 'search', hint: 'Try a different search or category.' }));
      return;
    }

    // Cheat sheet highlight when on All with no query
    if (activeCat === 'All' && !query) {
      const cheat = index.find((i) => i.id === 'cheat-sheet');
      if (cheat) articleCol.appendChild(articleCard(cheat, true));
    }

    for (const item of items) {
      if (activeCat === 'All' && !query && item.id === 'cheat-sheet') continue;
      articleCol.appendChild(articleCard(item));
    }
  }

  function articleCard(item, highlight) {
    const card = el('div.rule-article' + (highlight ? '.cheat' : ''));
    card.appendChild(el('div.rcat', item.category));
    card.appendChild(el('h3', item.title));
    if (item.type === 'table' && item.table) {
      card.appendChild(renderTable(item.table));
    } else if (item.type === 'bestiary' && item.beast) {
      card.appendChild(renderBeast(item.beast));
    } else {
      const body = el('div.prose.selectable');
      setMarkdown(body, item.body);
      card.appendChild(body);
    }
    return card;
  }

  function renderTable(t) {
    const wrapT = el('div');
    if (t.desc) wrapT.appendChild(el('p.small.mute', t.desc));
    const table = el('table.data-table');
    const tb = el('tbody');
    (t.entries || []).forEach((e, i) => {
      const tr = el('tr');
      tr.appendChild(el('td', { style: { width: '36px', fontFamily: 'var(--font-mono)', color: 'var(--cool)' } }, String(i + 1)));
      tr.appendChild(el('td', e));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    wrapT.appendChild(table);
    return wrapT;
  }

  function renderBeast(b) {
    const wrapB = el('div');
    // Full stat line for the living (Brawn / Agility / Wits / Charm | VIT | CMP | DEF).
    if (b.stat) wrapB.appendChild(el('div.notice.mono', { style: { marginBottom: '8px' } }, b.stat));
    const stats = el('div.row.wrap.gap-2', { style: { marginBottom: '8px' } });
    if (b.defense) stats.appendChild(el('span.badge', 'Defense: ' + b.defense));
    if (b.attack != null) stats.appendChild(el('span.badge', 'Attack: ' + b.attack));
    if (b.damage) stats.appendChild(el('span.badge', 'Damage: ' + b.damage));
    if (b.body != null) stats.appendChild(el('span.badge', 'Body: ' + b.body));
    else if (b.hp) stats.appendChild(el('span.badge', b.hp));
    if (b.speed) stats.appendChild(el('span.badge', 'Speed: ' + b.speed));
    wrapB.appendChild(stats);
    if (b.bite) wrapB.appendChild(el('p.small', [el('b', 'Attack / Bite: '), b.bite]));
    if (b.drive) wrapB.appendChild(el('p.small', [el('b', 'Drive: '), b.drive]));
    if (b.tactics) wrapB.appendChild(el('p.small', [el('b', 'Tactics: '), b.tactics]));
    if (b.kill) wrapB.appendChild(el('p.small', [el('b', 'True kill: '), b.kill]));
    if (b.notes) wrapB.appendChild(el('p.prose', b.notes));
    return wrapB;
  }

  function showProbability() {
    activeCat = '__prob';
    updateCats();
    clear(articleCol);
    const card = el('div.rule-article');
    card.appendChild(el('div.rcat', 'Tool'));
    card.appendChild(el('h3', 'Probability — ' + (sys.dice.notation || '3d6') + ' roll-under'));
    const ctrl = el('div.row.gap-4', { style: { margin: '10px 0', flexWrap: 'wrap' } });
    const tInput = el('input.input', { type: 'number', value: 11, min: 3, max: 18, style: { width: '90px' } });
    ctrl.appendChild(el('label.field.inline', [el('span.field-label', 'Target'), tInput]));
    card.appendChild(ctrl);
    const result = el('div');
    card.appendChild(result);

    // full table
    const table = el('table.data-table', { style: { marginTop: '14px' } });
    const thead = el('thead'); const htr = el('tr');
    htr.appendChild(el('th', 'Target')); htr.appendChild(el('th', 'Chance ≤ target'));
    thead.appendChild(htr); table.appendChild(thead);
    const tb = el('tbody');
    for (let tgt = 4; tgt <= 17; tgt++) {
      const p = rollUnderProbability(sys.dice.notation || '3d6', tgt);
      const tr = el('tr');
      tr.appendChild(el('td', { style: { fontFamily: 'var(--font-mono)' } }, String(tgt)));
      const cell = el('td');
      const bar = el('div.prob-bar', { style: { maxWidth: '220px', display: 'inline-block', width: '160px', verticalAlign: 'middle', marginRight: '10px' } });
      bar.appendChild(el('span', { style: { width: Math.round(p * 100) + '%' } }));
      cell.appendChild(bar);
      cell.appendChild(el('span', { style: { fontFamily: 'var(--font-mono)' } }, Math.round(p * 100) + '%'));
      tr.appendChild(cell);
      tb.appendChild(tr);
    }
    table.appendChild(tb);

    function updateResult() {
      clear(result);
      const tgt = parseInt(tInput.value, 10) || 11;
      const p = rollUnderProbability(sys.dice.notation || '3d6', tgt);
      result.appendChild(el('div.huge.display', { style: { color: 'var(--accent)' } }, Math.round(p * 100) + '%'));
      result.appendChild(el('p.small.mute', `chance to roll ${tgt} or under on ${sys.dice.notation || '3d6'}`));
    }
    tInput.addEventListener('input', updateResult);
    updateResult();
    card.appendChild(table);
    articleCol.appendChild(card);
  }

  sInput.addEventListener('input', debounce(() => { query = sInput.value.trim(); if (activeCat === '__prob') activeCat = 'All'; updateCats(); renderArticles(); }, 120));

  renderArticles();
  shell.render(wrap);
}
