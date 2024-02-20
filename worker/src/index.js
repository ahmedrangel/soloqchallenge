import { Router } from "itty-router";
import JsResponse from "./response";
import JsonResponse from "./jsonResponse";
import twitchApi from "./apis/twitchApi";
import riotApi from "./apis/riotApi";
import { updateGeneralData } from "./crons/update-general-data";
import { updateAccountsData } from "./crons/update-accounts-data";

const router = Router();
const region = "lan";

router.post("/add", async (req, env) => {
  const _twitch = new twitchApi(env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET);
  const _riot = new riotApi(env.RIOT_KEY);
  const route = _riot.route(region);
  const cluster = _riot.cluster(region);
  try {
    const { riot_name, riot_tag, key, twitch, twitter, instagram } = await req.json();
    if (key === env.POST_KEY) {
      if (!riot_name || !riot_tag || !twitch) return new JsonResponse({ status: "Bad Request", status_code: 400 });
      // League of legends
      const { puuid } = await _riot.getAccountByRiotID(riot_name, riot_tag, cluster);
      const summoner = await _riot.getSummonerByPuuid(puuid, route);
      const lol_picture = summoner.profileIconId;
      const id_summoner = summoner.id;
      // Twitch
      const twitch_data = await _twitch.getUserByName(twitch);
      const twitch_id = twitch_data.id;
      const twitch_login = twitch_data.login;
      const twitch_display = twitch_data.display_name;
      const twitch_picture = twitch_data.profile_image_url.replace("https://static-cdn.jtvnw.net/","");
      // Add DB
      await env.PARTICIPANTS.prepare(
        `
        INSERT OR IGNORE INTO participants (puuid, id_summoner, riot_name, riot_tag, lol_picture, twitch_login, twitch_display, twitch_picture, twitter, instagram, twitch_id, control_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).bind(puuid, id_summoner, riot_name, riot_tag, lol_picture, twitch_login, twitch_display, twitch_picture, twitter ? twitter : "", instagram ? instagram : "", twitch_id, 1).run();
      return new JsonResponse({ puuid, id_summoner, riot_name, riot_tag, lol_picture, twitch_login, twitch_display, twitch_picture, twitter: twitter ? twitter : "", instagram: instagram ? instagram : ""});
    }
    return new JsonResponse({ status: "Forbidden", status_code: 403 });
  }
  catch (err) {
    return new JsonResponse({ status: "Bad Request", status_code: 400 });
  }
});

router.get("/participants", async (req, env) => {
  const { results } = await env.PARTICIPANTS.prepare("SELECT riot_name, riot_tag, lol_picture, twitch_login, twitch_display, twitch_picture, twitter, is_live, is_ingame, wins, losses, lp, elo, tier, position, position_change, instagram from participants").all();

  if (!results[0]) return null;

  const control = await env.PARTICIPANTS.prepare("SELECT last_updated FROM control WHERE id = ?").bind(1).first();
  const sorted = results.sort((a, b) => {
    if (!a.position || !b.position) {
      if (!a.position) return 1; // Colocar a 'a' al final
      if (!b.position) return -1; // Colocar a 'b' al final
    }
    return a.position - b.position;
  });

  const data = { participants: sorted, last_updated: control.last_updated };
  return new JsonResponse(data);
});

router.get("/update-general", async (req, env) => {
  return new JsonResponse(await updateGeneralData(env));
});

router.get("/update-accounts", async (req, env) => {
  return new JsonResponse(await updateAccountsData(env));
});

router.get("/reset-position-change", async (req, env) => {
  return new JsonResponse(await resetPositionChange(env));
});

router.all("*", () => new JsResponse("Not Found.", { status: 404 }));

export default {
  async fetch(req, env, ctx) {
    return router.handle(req, env, ctx);
  },
  async scheduled(event, env) {
    switch (event.cron) {
    case "*/10 * * * *":
      await updateGeneralData(env);
      break;
    case "0 6 * * *":
      await resetPositionChange(env);
      break;
    }
  }
};

