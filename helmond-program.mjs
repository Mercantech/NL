import { helmondDays } from "./helmond-program-data.mjs?v=20261116b";

const interfaceText = {
  da: {
    now: "Lige nu", next: "Næste aktivitet", noCurrent: "Ingen aktivitet med fast tid lige nu",
    noNext: "Ingen flere aktiviteter med fast tid i dette ugeprogram",
    show: "Vis aktiviteter", hide: "Skjul aktiviteter",
    unknown: "Tidspunkt ikke fastlagt", evening: "Aften", afternoonEvening: "Eftermiddag/aften", freeFrom: "Fra",
    empty: "Ingen planlagte aktiviteter.", breaks: "Faste pauser", breakNames: ["Formiddagspause", "Frokostpause", "Eftermiddagspause"],
    school: "Undervisning", project: "Projektarbejde", travel: "Transport", social: "Social aktivitet", free: "Fritid",
    required: "Obligatorisk", optional: "Valgfri", suggested: "Forslag", planned: "Planlagt", unconfirmed: "Ikke bekræftet",
  },
  en: {
    now: "Now", next: "Next activity", noCurrent: "No timed activity right now",
    noNext: "No more timed activities in this week's programme",
    show: "Show activities", hide: "Hide activities",
    unknown: "Time to be confirmed", evening: "Evening", afternoonEvening: "Afternoon/evening", freeFrom: "From",
    empty: "No planned activities.", breaks: "Regular breaks", breakNames: ["Morning break", "Lunch break", "Afternoon break"],
    school: "Lessons", project: "Project work", travel: "Transport", social: "Social activity", free: "Free time",
    required: "Required", optional: "Optional", suggested: "Suggestion", planned: "Scheduled", unconfirmed: "Unconfirmed",
  },
  nl: {
    now: "Nu", next: "Volgende activiteit", noCurrent: "Op dit moment geen activiteit met een vaste tijd",
    noNext: "Geen verdere activiteiten met een vaste tijd in dit weekprogramma",
    show: "Toon activiteiten", hide: "Verberg activiteiten",
    unknown: "Tijdstip nog niet vastgesteld", evening: "Avond", afternoonEvening: "Middag/avond", freeFrom: "Vanaf",
    empty: "Geen geplande activiteiten.", breaks: "Vaste pauzes", breakNames: ["Ochtendpauze", "Lunchpauze", "Middagpauze"],
    school: "Onderwijs", project: "Projectwerk", travel: "Vervoer", social: "Sociale activiteit", free: "Vrije tijd",
    required: "Verplicht", optional: "Optioneel", suggested: "Voorstel", planned: "Gepland", unconfirmed: "Onbevestigd",
  },
};

const locations = {
  terAA: "Ter AA · Keizerin Marialaan 2, 5702 NR Helmond",
  itSquare: "IT Square, Ter AA · Keizerin Marialaan 2, 5702 NR Helmond",
  station: "Station Helmond · Stationsplein, Helmond",
  eindhoven: "Eindhoven",
  strijp: "Strijp-S, Eindhoven",
  philips: "Philips Museum · Emmasingel 31, 5611 AZ Eindhoven",
  vught: "Nationaal Monument Kamp Vught · Lunettenlaan 600, 5263 NT Vught",
  bic: "Brainport Industries Campus · BIC 1, 5657 BX Eindhoven",
  stratum: "Stratumseind, Eindhoven",
};

const breakTimes = ["10:30–10:45", "12:45–13:15", "14:45–15:00"];
const amsterdamClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function mapLink(location) {
  const label = locations[location];
  const query = locations[location === "itSquare" ? "terAA" : location].replace(" · ", ", ");
  const link = element("a", "helmond-map", label);
  link.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function activityTime(activity, text) {
  if (activity.end) return activity.time + "–" + activity.end;
  if (activity.time) return activity.period === "freeFrom" ? text.freeFrom + " " + activity.time : activity.time;
  return activity.period ? text[activity.period] + " · " + text.unknown : text.unknown;
}

function activityRow(activity, language, text) {
  const row = element("li", "helmond-activity");
  const info = element("div", "helmond-info");
  const tags = element("div", "helmond-tags");
  tags.append(
    element("span", "helmond-tag is-" + activity.category, text[activity.category]),
    element("span", "helmond-tag is-" + activity.status, text[activity.status]),
  );
  info.append(element("strong", "", activity.title[language]), tags);
  if (activity.detail) info.append(element("p", "helmond-detail", activity.detail[language]));
  if (activity.location) info.append(mapLink(activity.location));
  row.append(element("span", "helmond-time", activityTime(activity, text)), info);
  return row;
}

const programme = document.querySelector("[data-helmond-programme]");
const breaks = document.querySelector("[data-helmond-breaks]");
const toggles = new Map(Array.from(document.querySelectorAll("[data-helmond-toggle]"),
  (button) => [button.getAttribute("aria-controls"), button]));
let refreshStatus;

function formatDate(day, options) {
  return new Intl.DateTimeFormat(window.SiteI18n.getLang(), { ...options, timeZone: "UTC" })
    .format(new Date(day + "T00:00:00Z"));
}

function setExpanded(panel, expanded) {
  const button = toggles.get(panel.id);
  const text = interfaceText[window.SiteI18n.getLang()];
  const label = expanded ? text.hide : text.show;
  const date = panel.id.slice("helmond-".length);
  button.setAttribute("aria-expanded", String(expanded));
  button.setAttribute("aria-label", label + " · " + formatDate(date, { day: "numeric", month: "long" }));
  button.textContent = label;
  panel.hidden = !expanded;
}

function openActivityLink(hash) {
  const target = document.getElementById(hash.slice(1));
  const panel = target?.closest(".helmond-day");
  if (!panel) return;
  setExpanded(panel, true);
  target.scrollIntoView({ block: "start" });
}

function renderProgramme() {
  const language = window.SiteI18n.getLang();
  const text = interfaceText[language];
  const status = element("div", "helmond-status");
  const now = element("div");
  const next = element("div");
  status.append(now, next);
  const timed = [];

  for (const day of helmondDays) {
    const panel = document.getElementById("helmond-" + day.date);
    const content = panel.firstElementChild;
    content.replaceChildren();
    if (day.detail) content.append(element("p", "helmond-day-note", day.detail[language]));
    if (day.activities.length === 0) {
      content.append(element("p", "helmond-day-note", text.empty));
    } else {
      const list = element("ol", "helmond-activities");
      for (const [index, activity] of day.activities.entries()) {
        const row = activityRow(activity, language, text);
        row.id = panel.id + "-aktivitet-" + (index + 1);
        if (activity.time) {
          timed.push({ day: day.date, activity, row, start: day.date + "T" + activity.time });
        }
        list.append(row);
      }
      content.append(list);
    }
    setExpanded(panel, !panel.hidden);
    toggles.get(panel.id).hidden = false;
  }

  const breakList = element("ul");
  breakTimes.forEach((time, index) => breakList.append(element("li", "", time + " · " + text.breakNames[index])));
  breaks.replaceChildren(element("summary", "", text.breaks), breakList);
  breaks.hidden = false;
  programme.replaceChildren(status);
  timed.sort((a, b) => a.start.localeCompare(b.start));

  function showStatus(panel, label, empty, entries, includeDate) {
    panel.replaceChildren(element("h4", "", label));
    if (!entries.length) panel.append(element("p", "", empty));
    for (const { day, activity, row } of entries) {
      const prefix = includeDate ? formatDate(day, { day: "numeric", month: "short" }) + " · " : "";
      const link = element("a", "", prefix + activityTime(activity, text) + " · " + activity.title[language]);
      link.href = "#" + row.id;
      panel.append(link);
    }
  }

  let previousStatus;
  refreshStatus = () => {
    const parts = Object.fromEntries(amsterdamClock.formatToParts(new Date()).map(({ type, value }) => [type, value]));
    const localDay = parts.year + "-" + parts.month + "-" + parts.day;
    const localTime = parts.hour + ":" + parts.minute;
    const moment = localDay + "T" + localTime;
    const current = timed.filter(({ day, activity, start }) => day === localDay &&
      (activity.end ? start <= moment && localTime < activity.end : start === moment));
    const nextStart = timed.find(({ start }) => start > moment)?.start;
    const upcoming = nextStart ? timed.filter(({ start }) => start === nextStart) : [];
    const signature = [...current.map(({ row }) => row.id), "|", ...upcoming.map(({ row }) => row.id)].join(",");
    if (signature === previousStatus) return;
    previousStatus = signature;

    for (const entry of timed) {
      if (current.includes(entry)) entry.row.setAttribute("aria-current", "true");
      else entry.row.removeAttribute("aria-current");
      entry.row.classList.toggle("is-next", upcoming.includes(entry));
    }
    showStatus(now, text.now, text.noCurrent, current, false);
    showStatus(next, text.next, text.noNext, upcoming, true);
  };
  refreshStatus();
}

renderProgramme();
for (const [id, button] of toggles) {
  const panel = document.getElementById(id);
  button.addEventListener("click", () => setExpanded(panel, panel.hidden));
}
programme.addEventListener("click", (event) => {
  const link = event.target.closest("a[href^='#helmond-']");
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  // Also reopen the panel when the fragment is already in the address bar.
  openActivityLink(link.hash);
});
window.addEventListener("hashchange", () => openActivityLink(window.location.hash));
document.addEventListener("site:langchange", renderProgramme);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshStatus();
});
window.setInterval(() => refreshStatus(), 15_000);

openActivityLink(window.location.hash);
