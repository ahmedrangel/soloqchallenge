import { Router } from "itty-router";
import JsResponse from "./response";
import JsonResponse from "./jsonResponse";
import riotApi, { eloValues } from "./apis/riotApi";
import twitchApi from "./apis/twitchApi";
import { fixRank } from "./utils/helpers";

const router = Router();
const region = "lan";

router.post("/add", async (req, env) => {
  const _twitch = new twitchApi(env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET);
  const _riot = new riotApi(env.RIOT_KEY);
  const route = _riot.route(region);
  const cluster = _riot.cluster(region);
  try {
    const { riot_name, riot_tag, key, twitch, twitter } = await req.json();
    if (key === env.POST_KEY) {
      if (!riot_name || !riot_tag || !twitch) return new JsonResponse({ status: "Bad Request", status_code: 400 });
      // League of legends
      const { puuid } = await _riot.getAccountByRiotID(riot_name, riot_tag, cluster);
      const summoner = await _riot.getSummonerByPuuid(puuid, route);
      const lol_picture = summoner.profileIconId;
      const id_summoner = summoner.id;
      // Twitch
      const twitch_data = await _twitch.getUserByName(twitch);
      const twitch_login = twitch_data.login;
      const twitch_display = twitch_data.display_name;
      const twitch_picture = twitch_data.profile_image_url.replace("https://static-cdn.jtvnw.net/","");
      // Add DB
      await env.PARTICIPANTS.prepare(
        `
        INSERT OR IGNORE INTO participants (puuid, id_summoner, riot_name, riot_tag, lol_picture, twitch_login, twitch_display, twitch_picture, twitter)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).bind(puuid, id_summoner, riot_name, riot_tag, lol_picture, twitch_login, twitch_display, twitch_picture, twitter ? twitter : "").run();
      return new JsonResponse({ puuid, id_summoner, riot_name, riot_tag, lol_picture, twitch_login, twitch_display, twitch_picture, twitter: twitter ? twitter : ""});
    }
    return new JsonResponse({ status: "Forbidden", status_code: 403 });
  }
  catch (err) {
    return new JsonResponse({ status: "Bad Request", status_code: 400 });
  }
});

router.get("/participants", async (req, env) => {
  const { results } = await env.PARTICIPANTS.prepare("SELECT riot_name, riot_tag, lol_picture, twitch_login, twitch_display, twitch_picture, twitter, is_live, is_ingame, wins, losses, lp, elo, tier, position, position_change from participants").all();
  return new JsonResponse(results);
});

router.get("/update-test", async (req, env) => {
  const { results } = await env.PARTICIPANTS.prepare("SELECT id_summoner, twitch_login, position, position_change from participants").all();
  // const _twitch = new twitchApi(env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET);
  const _riot = new riotApi(env.RIOT_KEY);
  const route = _riot.route(region);
  // const cluster = _riot.cluster(region);
  const participants = [];
  for (const p of results) {
    const ranked_data = await _riot.getRankedDataBySummonerId(p.id_summoner, route);
    const soloq = ranked_data.filter(item => item.queueType === "RANKED_SOLO_5x5")[0];
    participants.push({ id_summoner: p.id_summoner, wins: soloq.wins, losses: soloq.losses, lp: soloq.leaguePoints, elo: soloq.tier, tier: soloq.rank, position: p.position, position_change: p.position_change });
    await env.PARTICIPANTS.prepare(`
      UPDATE participants SET wins = ?, losses = ?, lp = ?, elo = ?, tier = ? WHERE id_summoner = ?
    `).bind(soloq.wins, soloq.losses, soloq.leaguePoints, soloq.tier.toLowerCase(), fixRank(soloq.tier, soloq.rank), p.id_summoner).run();
  }

  const sorted = participants.sort((a, b) => {
    const eloComparison = eloValues[`${b.elo} ${b.tier}`] - eloValues[`${a.elo} ${a.tier}`];
    if (eloComparison !== 0) {
      // Si la comparación por eloValue no es igual, devuelve eso.
      return eloComparison;
    }
    return b.lp - a.lp;
  });

  let index = 0;
  for (const p of sorted) {
    const next_position = index + 1;
    const position_change = p.position - next_position;
    await env.PARTICIPANTS.prepare(`
      UPDATE participants SET position = ?, position_change = ? WHERE id_summoner = ?
    `).bind(next_position, position_change, p.id_summoner).run();
    index++;
  }
  return new JsonResponse({ status: 200, sorted });
});

router.all("*", () => new JsResponse("Not Found.", { status: 404 }));

export default {
  async fetch(req, env, ctx) {
    return router.handle(req, env, ctx);
  },
  async scheduled(event/*,env, ctx*/) {
    switch (event.cron) {
    case "*/5 * * * *":
      //
      break;
    }
  }
};
