// Renderer-side auto-update client. Subscribes to main-process update events
// exactly once and re-broadcasts via an Emitter so views can react.
import { Emitter } from './util.js';

class Updates extends Emitter {
  constructor() {
    super();
    this.status = { type: 'idle' };
    if (window.xrpg && window.xrpg.updates && window.xrpg.updates.onEvent) {
      window.xrpg.updates.onEvent((e) => { this.status = e; this.emit('status', e); });
    }
  }
  async available() { try { return await window.xrpg.updates.available(); } catch { return false; } }
  async check() { try { return await window.xrpg.updates.check(); } catch (e) { return { ok: false, reason: e.message }; } }
  install() { try { return window.xrpg.updates.install(); } catch (e) {} }
}

export const updates = new Updates();
export default updates;
