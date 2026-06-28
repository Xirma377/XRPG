// Shared shell handle so views can set breadcrumbs / topbar actions and navigate.
import { clear, appendChildren, el } from './util.js';
import { icon } from './icons.js';
import router from './router.js';

export const shell = {
  viewEl: null,
  crumbEl: null,
  actionsEl: null,

  mount(refs) { Object.assign(this, refs); },

  render(...nodes) {
    clear(this.viewEl);
    appendChildren(this.viewEl, nodes);
    this.viewEl.scrollTop = 0;
  },

  crumbs(items) {
    clear(this.crumbEl);
    items.forEach((it, i) => {
      if (i > 0) this.crumbEl.appendChild(el('span.sep', '/'));
      const c = el('span.crumb' + (i === items.length - 1 ? '.active' : ''), it.label);
      if (it.to && i !== items.length - 1) {
        c.style.cursor = 'pointer';
        c.addEventListener('click', () => router.go(...(Array.isArray(it.to) ? it.to : [it.to])));
      }
      this.crumbEl.appendChild(c);
    });
  },

  actions(nodes) {
    clear(this.actionsEl);
    if (nodes) appendChildren(this.actionsEl, nodes);
  },

  go(view, ...params) { router.go(view, ...params); },
};

export default shell;
