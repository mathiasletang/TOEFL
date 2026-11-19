/**
 * Version of the HTTP API the web app expects. Raise it whenever the web app starts relying on a new
 * route or field, so a page served by an older server process says so instead of breaking.
 * 1 = before the Today page · 2 = Today page (week_days, road, official scores) · 3 = session mode progress.
 */
export const API_VERSION = 3;
