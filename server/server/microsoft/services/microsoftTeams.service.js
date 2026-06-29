import axios from "axios";

import MicrosoftUser from "../models/microsoftUser.model";
import MicrosoftAuthService from "./microsoft.auth.service";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
// Refresh a bit before the token actually expires.
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Microsoft Teams message-delivery service.
 *
 * Resolves the connected Microsoft account, keeps its access token fresh
 * (refreshing + persisting via the stored refresh token), and exposes the
 * Graph calls needed to list teams/channels and send channel messages.
 */
export default class MicrosoftTeamsService {
  constructor(email) {
    this.email = email;          // optional; defaults to most-recent account
    this.user = null;
    this.auth = new MicrosoftAuthService();
  }

  /** Load the account and ensure a non-expired access token. */
  async #ensureAuth() {
    const query = this.email ? { email: this.email, active: true } : { active: true };
    const user = await MicrosoftUser.findOne(query).sort({ updatedAt: -1 });
    if (!user) {
      throw new Error(this.email
        ? `No connected Microsoft account for ${this.email}`
        : "No connected Microsoft account.");
    }
    this.user = user;

    const expiry = user.expiryDate ? new Date(user.expiryDate).getTime() : 0;
    const needsRefresh = !user.accessToken || !expiry || expiry <= Date.now() + EXPIRY_BUFFER_MS;
    if (needsRefresh) {
      const tokens = await this.auth.refreshTokens(user.refreshToken);
      user.accessToken = tokens.access_token;
      if (tokens.refresh_token) user.refreshToken = tokens.refresh_token; // MS rotates these
      if (tokens.id_token) user.idToken = tokens.id_token;
      if (tokens.scope) user.scope = tokens.scope;
      user.expiryDate = tokens.expiry_date;
      await MicrosoftUser.saveData(user);
    }
    return user.accessToken;
  }

  #client(token) {
    return axios.create({
      baseURL: GRAPH_BASE,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  }

  /** Teams the connected user is a member of. */
  async listTeams() {
    const token = await this.#ensureAuth();
    const { data } = await this.#client(token).get("/me/joinedTeams");
    return (data.value || []).map((t) => ({ id: t.id, displayName: t.displayName }));
  }

  /** Channels within a team. */
  async listChannels(teamId) {
    if (!teamId) throw new Error("teamId is required.");
    const token = await this.#ensureAuth();
    const { data } = await this.#client(token).get(`/teams/${teamId}/channels`);
    return (data.value || []).map((c) => ({
      id: c.id,
      displayName: c.displayName,
      membershipType: c.membershipType,
    }));
  }

  /** Teams + their channels in one call, for a destination picker. */
  async listTeamsWithChannels() {
    const teams = await this.listTeams();
    const out = [];
    for (const team of teams) {
      try {
        out.push({ ...team, channels: await this.listChannels(team.id) });
      } catch (err) {
        out.push({ ...team, channels: [], error: err.message });
      }
    }
    return out;
  }

  /**
   * Send a message to a Teams channel.
   * @param {{ teamId:string, channelId:string, message:string, isHtml?:boolean }} args
   */
  async sendChannelMessage({ teamId, channelId, message, isHtml = true }) {
    if (!teamId || !channelId) throw new Error("teamId and channelId are required.");
    if (!message) throw new Error("message is required.");
    const token = await this.#ensureAuth();
    const { data } = await this.#client(token).post(
      `/teams/${teamId}/channels/${channelId}/messages`,
      { body: { contentType: isHtml ? "html" : "text", content: message } }
    );
    return { id: data.id, webUrl: data.webUrl };
  }
}
