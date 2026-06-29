// Global application state: active system / campaign / session, persisted to settings.
import { Emitter } from './util.js';
import store from './store.js';
import { applyTheme } from './theme.js';

class AppState extends Emitter {
  constructor() {
    super();
    this.activeSystemId = null;
    this.activeCampaignId = null;
    this.activeSessionId = null;     // session currently being "run"
    this.settings = {};
  }

  async init() {
    this.settings = await store.getSettings();
    this.activeSystemId = this.settings.activeSystemId || null;
    this.activeCampaignId = this.settings.activeCampaignId || null;

    // fall back to STRAIN Z (flagship) then first available system
    const systems = store.all('rulesets');
    if (!this.activeSystemId || !store.get('rulesets', this.activeSystemId)) {
      this.activeSystemId = store.get('rulesets', 'sys_strainz') ? 'sys_strainz'
        : (systems[0] ? systems[0].id : null);
    }
    this.applyActiveTheme();
  }

  get system() { return this.activeSystemId ? store.get('rulesets', this.activeSystemId) : null; }
  get campaign() { return this.activeCampaignId ? store.get('campaigns', this.activeCampaignId) : null; }
  get session() { return this.activeSessionId ? store.get('sessions', this.activeSessionId) : null; }

  applyActiveTheme() { applyTheme(this.system); }

  async setSystem(id) {
    this.activeSystemId = id;
    await store.setSettings({ activeSystemId: id });
    this.applyActiveTheme();
    this.emit('system', id);
    this.emit('change');
  }

  async setCampaign(id) {
    this.activeCampaignId = id;
    const camp = store.get('campaigns', id);
    if (camp && camp.systemId && camp.systemId !== this.activeSystemId) {
      await this.setSystem(camp.systemId);
    }
    await store.setSettings({ activeCampaignId: id });
    this.emit('campaign', id);
    this.emit('change');
  }

  setSession(id) {
    this.activeSessionId = id;
    this.emit('session', id);
    this.emit('change');
  }

  // Merge a patch into settings (kept in sync with the persisted copy) and notify.
  async updateSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    await store.setSettings(patch);
    this.emit('settings', this.settings);
    this.emit('change');
  }
}

export const appState = new AppState();
export default appState;
