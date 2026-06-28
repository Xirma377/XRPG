// Hash-based router. Routes look like #/view or #/view/param.
import { Emitter } from './util.js';

class Router extends Emitter {
  constructor() {
    super();
    this.routes = new Map();
    this.current = null;
    window.addEventListener('hashchange', () => this._resolve());
  }

  register(name, handler) { this.routes.set(name, handler); }

  start(defaultRoute = 'dashboard') {
    this.default = defaultRoute;
    this._resolve();
  }

  parse() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [view, ...rest] = hash.split('/');
    return { view: view || this.default, params: rest.map(decodeURIComponent), raw: hash };
  }

  go(view, ...params) {
    const path = '#/' + [view, ...params.map(encodeURIComponent)].join('/');
    if (location.hash === path) this._resolve();
    else location.hash = path;
  }

  _resolve() {
    const { view, params } = this.parse();
    const handler = this.routes.get(view) || this.routes.get(this.default);
    this.current = { view, params };
    this.emit('navigate', view, params);
    if (handler) handler(...params);
  }
}

export const router = new Router();
export default router;
