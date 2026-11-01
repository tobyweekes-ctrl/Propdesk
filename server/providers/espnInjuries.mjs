// ESPN's public NBA injury report (site.api.espn.com). One request covers the league.
import { fetchJson } from '../http.mjs';
import { normaliseInjuries, INJURY_URL } from '../data/injuries.mjs';

export { normaliseInjuries };

export const espnInjuryProvider = {
  name: 'ESPN',
  async load() {
    const { json } = await fetchJson(INJURY_URL, { minGapMs: 500 });
    return normaliseInjuries(json);
  },
};
